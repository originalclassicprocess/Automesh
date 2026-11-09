import { profileRegistrySnapshot, type ProfileRegistry } from '../core/profiles';
import { WebCryptoIdentity } from '../identity/webcrypto';
import { accountIdFromPublicKey } from '../addressing/account-id.js';
import { deriveProfileSeed } from './keys';

// A valid JSON registry is not proof that its addresses belong to this seed.
// Verify archived entries too; never import delegations from an old backup.
export async function verifyProfileRegistry(root: Uint8Array, scope: string, value: unknown,
  guard: () => void = () => {}): Promise<ProfileRegistry> {
  const registry = profileRegistrySnapshot(value), copy = new Uint8Array(root);
  if (copy.length !== 32) { copy.fill(0); throw new Error('invalid_profile_root'); }
  try {
    guard();
    const owner = new WebCryptoIdentity();
    try {
      await owner.fromSeed(copy); guard();
      if (await accountIdFromPublicKey(await owner.getPublicKeyBytes(), crypto.subtle) !== scope)
        throw new Error('profile_backup_owner_mismatch');
    } finally { owner.dispose(); }
    for (const profile of registry.profiles) {
      guard();
      const seed = profile.index === null ? copy.slice() : await deriveProfileSeed(copy, profile.index, crypto.subtle);
      const identity = new WebCryptoIdentity();
      try {
        await identity.fromSeed(seed); guard();
        if (await accountIdFromPublicKey(await identity.getPublicKeyBytes(), crypto.subtle) !== profile.accountId)
          throw new Error('profile_backup_address_mismatch');
      } finally { seed.fill(0); identity.dispose(); }
    }
    guard(); return registry;
  } finally { copy.fill(0); }
}

// Additive, idempotent import. Existing names, archives and grants win.
// Independently initialized devices with conflicting UUID/index mappings require
// explicit reconciliation, not an automatic merge or silent key replacement.
export function mergeProfileBackup(current: ProfileRegistry | undefined, imported: ProfileRegistry): ProfileRegistry {
  const incoming = profileRegistrySnapshot(imported);
  incoming.connections = [];
  if (!current) return incoming;
  const local = profileRegistrySnapshot(current);
  for (const profile of incoming.profiles) {
    const matches = local.profiles.filter(p => p.id === profile.id || p.accountId === profile.accountId || p.index === profile.index);
    if (matches.length) {
      if (matches.length !== 1 || matches[0].id !== profile.id || matches[0].accountId !== profile.accountId ||
          matches[0].index !== profile.index || matches[0].role !== profile.role) throw new Error('profile_backup_conflict');
    } else {
      if (profile.role === 'main' || profile.index !== null && profile.index < local.nextIndex)
        throw new Error('profile_backup_conflict');
      local.profiles.push(profile);
    }
  }
  local.nextIndex = Math.max(local.nextIndex, incoming.nextIndex);
  local.lastNow = Math.max(local.lastNow, incoming.lastNow);
  return profileRegistrySnapshot(local);
}
