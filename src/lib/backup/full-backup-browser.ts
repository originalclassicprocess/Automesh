import { accountFromMnemonic } from '$lib/application/account';
import { deriveProfileSeed } from '$lib/profiles/keys';
import { readProfilesForBackup } from '$lib/profiles/backup-browser';
import { verifyProfileRegistry } from '$lib/profiles/backup';
import { deriveChatStoreKey, snapshotLocalStorage, openSealedChatData, openSealedFileData,
  sealChatData, sealLocalFileData, insertEmptyLocalStorage, type LocalStorageSnapshot } from '$lib/chat/local-store';
import { MAX_FULL_BACKUP_BYTES, referencedBackupFiles, disposeFullBackup, restoredChatData,
  type BackupProfile, type FullBackupContents } from './full-backup';
import type { ProfileRegistry } from '$lib/core/profiles';
import { WebCryptoIdentity } from '$lib/identity/webcrypto';
import { accountIdFromPublicKey } from '$lib/addressing/account-id.js';

async function keysFor(root: Uint8Array, owner: string, registry: ProfileRegistry | undefined, guard: () => void) {
  const identity = new WebCryptoIdentity();
  try {
    await identity.fromSeed(root); guard();
    if (await accountIdFromPublicKey(await identity.getPublicKeyBytes()) !== owner) throw new Error('backup_wrong_account');
  } finally { identity.dispose(); }
  if (registry) await verifyProfileRegistry(root, owner, registry, guard);
  const keys = new Map<string, CryptoKey>();
  keys.set(owner, await deriveChatStoreKey(root, owner)); guard();
  for (const profile of registry?.profiles ?? []) {
    if (keys.has(profile.accountId)) continue;
    const seed = profile.index === null ? root.slice() : await deriveProfileSeed(root, profile.index, crypto.subtle);
    try { keys.set(profile.accountId, await deriveChatStoreKey(seed, profile.accountId)); guard(); }
    finally { seed.fill(0); }
  }
  return keys;
}

export async function captureFullBackup(seed: Uint8Array, owner: string, guard: () => void, onlyAccountId?: string): Promise<{ registry?: ProfileRegistry; profiles: BackupProfile[] }> {
  const account = await accountFromMnemonic(new TextDecoder('utf-8', { fatal: true }).decode(seed));
  const profiles: BackupProfile[] = [];
  try {
    guard(); if (account.accountId !== owner) throw new Error('backup_wrong_account');
    const registry = await readProfilesForBackup(seed, owner, () => { try { guard(); return true; } catch { return false; } }); guard();
    const keys = await keysFor(account.identitySeed, owner, registry, guard);
    if (onlyAccountId) {
      if (!keys.has(onlyAccountId)) throw new Error('backup_wrong_account');
      for (const id of keys.keys()) if (id !== onlyAccountId) keys.delete(id);
    }
    const snapshot = await snapshotLocalStorage([...keys.keys()], MAX_FULL_BACKUP_BYTES, guard);
    for (const record of snapshot.accounts) {
      const key = keys.get(record.accountId)!;
      const data = await openSealedChatData(key, record.accountId, record); guard();
      const files = new Map<string, Uint8Array>(); profiles.push({ accountId: record.accountId, data, files });
      const referenced = referencedBackupFiles(data);
      for (const file of snapshot.files.filter(f => f.accountId === record.accountId && referenced.has(f.id))) {
        const bytes = await openSealedFileData(key, record.accountId, file.id, file);
        files.set(file.id, bytes); guard();
      }
    }
    if (!profiles.length) throw new Error('backup_empty');
    guard(); return { registry, profiles };
  } catch (error) { disposeFullBackup({ profiles } as FullBackupContents); throw error; }
  finally { account.identitySeed.fill(0); account.provider.dispose(); }
}

export async function restoreFullBackup(full: FullBackupContents, root: Uint8Array, owner: string,
  registry: ProfileRegistry | undefined, guard: () => void): Promise<void> {
  const keys = await keysFor(root, owner, registry, guard);
  const snapshot: LocalStorageSnapshot = { accounts: [], files: [] };
  for (const profile of full.profiles) {
    const key = keys.get(profile.accountId); if (!key) throw new Error('backup_wrong_account');
    snapshot.accounts.push(await sealChatData(key, profile.accountId, restoredChatData(profile))); guard();
    for (const [id, bytes] of profile.files) { snapshot.files.push(await sealLocalFileData(key, profile.accountId, id, bytes)); guard(); }
  }
  guard(); await insertEmptyLocalStorage(snapshot, guard, full.backupId); guard();
}
