import { UUID_PATTERN } from '../core/objects';
import { profileRegistrySnapshot, type ProfileRegistry } from '../core/profiles';
import { validateSealedCoreRecord, type CoreRecordStore } from '../core/durable-state';

// A device-local preference, not an authorization. Full backups may carry it as
// an explicit optional hint; account-only/profile-list backups do not.
export function resolveProfileSelection(registry: ProfileRegistry | null, selected?: string): string | undefined {
  if (!registry) {
    if (selected) throw new Error('profile_registry_missing');
    return undefined;
  }
  const snapshot = profileRegistrySnapshot(registry);
  if (selected) {
    const target = snapshot.profiles.find(p => p.id === selected);
    // Never fall back to publishing the old/root address after deletion/archive.
    return target && !target.archived ? target.id : snapshot.profiles.find(p => p.role === 'main')!.id;
  }
  return snapshot.profiles.find(p => p.index === null && !p.archived)?.id
    ?? snapshot.profiles.find(p => p.role === 'personal' && !p.archived)?.id
    ?? snapshot.profiles.find(p => p.role === 'main')!.id;
}

// An old saved aggregate selection is not a communicating profile. Preserve
// invalid/archived-selection fail-closed behavior; do not silently revive it.
export function resolveCommunicationProfileSelection(registry: ProfileRegistry | null, selected?: string): string | undefined {
  const id = resolveProfileSelection(registry, selected);
  if (registry && selected && registry.profiles.some(p => p.id === selected && p.role === 'main'))
    return registry.profiles.find(p => !p.archived && p.role === 'personal')?.id
      ?? registry.profiles.find(p => !p.archived && p.role !== 'main')?.id ?? id;
  return id;
}

export function createProfileSelectionStore(options: {
  scope: string; key: CryptoKey; records: CoreRecordStore; guard(): void;
}) {
  const { scope, records, guard } = options;
  const key = options.key;
  if (key.type !== 'secret' || key.extractable || key.algorithm.name !== 'AES-GCM' ||
      (key.algorithm as AesKeyAlgorithm).length !== 256 || !key.usages.includes('encrypt') || !key.usages.includes('decrypt'))
    throw new Error('invalid_profile_selection_key');
  const aad = (revision: number) => new TextEncoder().encode(JSON.stringify(['Automesh private profile selection v1', scope, revision]));
  async function read() {
    guard(); const sealed = await records.read(scope); guard();
    if (!sealed) return { revision: null, id: undefined };
    validateSealedCoreRecord(sealed);
    if (sealed.cipher.byteLength > 256) throw new Error('invalid_profile_selection');
    const bytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(sealed.iv),
      additionalData: aad(sealed.revision) }, key, sealed.cipher.slice(0)));
    try {
      guard(); const id = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (!UUID_PATTERN.test(id)) throw new Error('invalid_profile_selection');
      return { revision: sealed.revision, id };
    } finally { bytes.fill(0); }
  }
  return {
    read: async () => (await read()).id,
    async save(id: string) {
      if (!UUID_PATTERN.test(id)) throw new Error('invalid_profile_selection');
      for (let retry = 0; retry < 16; retry++) {
        const previous = await read(), revision = (previous.revision ?? 0) + 1;
        if (!Number.isSafeInteger(revision)) throw new Error('profile_revision_exhausted');
        const iv = crypto.getRandomValues(new Uint8Array(12)), bytes = new TextEncoder().encode(id);
        let cipher: ArrayBuffer;
        try { cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(revision) }, key, bytes); }
        finally { bytes.fill(0); }
        guard();
        if (await records.compareAndSwap(scope, previous.revision, { schema: 1, revision, iv, cipher })) { guard(); return; }
        guard();
      }
      throw new Error('profile_storage_contention');
    },
  };
}
