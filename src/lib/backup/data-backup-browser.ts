import { normalizeLocalChatData, snapshotLocalStorage, openSealedChatData, sealChatData, sealLocalFileData,
  replaceObservedLocalStorage, type LocalChatData, type LocalStorageSnapshot } from '$lib/chat/local-store';
import { MAX_FULL_BACKUP_BYTES, restoredChatData, validateBackupProfiles } from './full-backup';
import { dataOnlyChatData, type DataBackupContents } from './data-backup';
import { storageEpoch, requireStorageEpoch } from '$lib/application/storage-reset';

export function dataDestinationEmpty(data: LocalChatData, accountId: string): boolean {
  return !data.chats.order.some(peer => {
    const conversation = data.chats.byPeer[peer];
    return conversation.messages.length || conversation.deletedIds?.length ||
      peer !== accountId && conversation.contact !== 'new';
  }) && !Object.keys(data.aliases).length && !Object.keys(data.peerPublicKeys).length &&
    !(data.mediaLibrary?.assets.length) && !(data.mediaLibrary?.packs.length) &&
    !data.meshtastic?.channels.some(channel=>channel.messages.length);
}

// The caller supplies a key from the authenticated active profile, never from
// the archive. No seed, device certificate or network permission is imported.
export async function restoreDataBackupToStore(full: DataBackupContents, key: CryptoKey, accountId: string,
  isCurrent: () => void): Promise<LocalChatData> {
  const epoch = storageEpoch();
  const guard = () => { isCurrent(); requireStorageEpoch(epoch); };
  guard();
  if (full.accountId !== accountId || full.profiles.length !== 1 || full.profiles[0].accountId !== accountId) throw new Error('backup_wrong_account');
  const profile = { ...full.profiles[0], data: dataOnlyChatData(full.profiles[0].data) };
  await validateBackupProfiles([profile], new Set([accountId]), guard); guard();
  const current = await snapshotLocalStorage([accountId], MAX_FULL_BACKUP_BYTES, guard);
  const observed = current.accounts[0];
  const baseline = observed ? await openSealedChatData(key, accountId, observed) : normalizeLocalChatData({}); guard();
  if (!dataDestinationEmpty(baseline, accountId)) throw new Error('backup_destination_not_empty');
  const data = { ...restoredChatData(profile),
    ...(baseline.seedBackupVerified !== undefined ? { seedBackupVerified: baseline.seedBackupVerified } : {}),
    ...(baseline.networkSettings ? { networkSettings: baseline.networkSettings } : {}),
    ...(baseline.deviceSettings ? { deviceSettings: baseline.deviceSettings } : {}),
    ...(baseline.radioState ? { radioState: baseline.radioState } : {}),
    ...(baseline.offlineState ? { offlineState: baseline.offlineState } : {}),
    ...(baseline.courierState ? { courierState: baseline.courierState } : {}) };
  const snapshot: LocalStorageSnapshot = { accounts: [await sealChatData(key, accountId, data)], files: [] }; guard();
  for (const [id, bytes] of profile.files) { snapshot.files.push(await sealLocalFileData(key, accountId, id, bytes)); guard(); }
  await replaceObservedLocalStorage(snapshot, observed, guard);
  // Commit is final: do not report a completed import as cancelled after it.
  return data;
}
