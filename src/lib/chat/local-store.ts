import { normalizeRadioReception } from '$lib/radio/reception';
import { isValidAccountId } from '$lib/addressing/bech32m.js';
import type { ChatEntry, SavedChats } from './session-chats';
import { MAX_FILE_BYTES, normalizeFileOffer } from './file-transfer';
import { normalizeAutoLockMinutes } from './session-settings';
import { normalizeNetworkSettings, type NetworkSettings } from '$lib/transport/network-settings';
import { requireStorageEpoch, storageEpoch } from '$lib/application/storage-reset';
import { MESSAGE_ID, normalizeMessageDetails } from './message-details';
import { restoreOfflineState, type OfflineState } from '$lib/node/offline-state';
import { restoreCourierState, type CourierState } from '$lib/node/courier-state';
import { normalizeMediaLibrary, type MediaLibrary } from './media-library';
import { normalizeAvatar, normalizePeerAvatars } from './avatar';
import { normalizeCallRecord, recoverCallRecord, callRecordLabel } from '$lib/calls/history';
import { normalizeDeviceSettings, type DeviceSettings } from '$lib/devices/settings';
import { isDeliveryIssue, isDeliveryErrorCode } from '$lib/application/delivery-issues';
import { normalizeEphemeralState } from './ephemeral';
import { normalizeRadioState, radioDeliveries, type RadioAccountState } from '$lib/radio/account-state';
import { normalizeNativeChannels,type NativeChannels } from '$lib/radio/native-channels';

export type LocalChatData = {
  meshtastic?:NativeChannels;
  radioState?: RadioAccountState;
  deviceSettings?: DeviceSettings;
  mediaLibrary?: MediaLibrary;
  selfNickname: string;
  selfAvatar?: string;
  peerAvatars?: Record<string, string>;
  seedBackupVerified?: boolean;
  readReceiptsEnabled: boolean;
  autoLockMinutes: number;
  autoReceiveFilesEnabled?: boolean;
  autoPlayVideoEnabled?: boolean;
  cleanImageMetadataEnabled?: boolean;
  allowForwardAttribution?: boolean;
  networkSettings?: NetworkSettings;
  offlineState?: OfflineState;
  courierState?: CourierState;
  peerReadPreferences: Record<string, boolean>;
  aliases: Record<string, string>;
  declaredNames: Record<string, string>;
  peerPublicKeys: Record<string, string>;
  chats: SavedChats;
};

export type SealedRecord = {
  accountId: string;
  iv: Uint8Array;
  cipher: ArrayBuffer;
  // Local retry marker only, never an authorization or remote trust anchor.
  restoreId?: string;
};
// A lock/write snapshot must not retain Svelte proxies or live mutable arrays.
// This schema contains JSON data only; never CryptoKeys or binary file buffers.
export function snapshotLocalChatData(data: LocalChatData): LocalChatData {
  return JSON.parse(JSON.stringify(data));
}
export type SealedFileRecord = SealedRecord & { id: string; key: string };

const dbName = 'mesh-autonomy-local-chats';
const storeName = 'accounts';
const fileStoreName = 'files';
const textEncoder = new TextEncoder();

function toBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export async function deriveChatStoreKey(identitySeed: Uint8Array, accountId: string): Promise<CryptoKey> {
  const input = toBuffer(identitySeed);
  let material: CryptoKey;
  try { material = await crypto.subtle.importKey('raw', input, 'HKDF', false, ['deriveKey']); }
  finally { new Uint8Array(input).fill(0); }
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: toBuffer(textEncoder.encode('MeshAutonomy local chat storage v1')),
      info: toBuffer(textEncoder.encode(accountId)),
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName, { keyPath: 'accountId' });
      if (!request.result.objectStoreNames.contains(fileStoreName)) {
        request.result.createObjectStore(fileStoreName, { keyPath: 'key' }).createIndex('accountId', 'accountId');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('chat_store_open_failed'));
  });
}

async function readRecord(accountId: string): Promise<SealedRecord | undefined> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readonly');
      const request = transaction.objectStore(storeName).get(accountId);
      request.onsuccess = () => resolve(request.result as SealedRecord | undefined);
      request.onerror = () => reject(request.error ?? new Error('chat_store_read_failed'));
    });
  } finally {
    db.close();
  }
}

async function writeRecord(record: SealedRecord, epoch: string | null): Promise<void> {
  const db = await openDatabase();
  try {
    requireStorageEpoch(epoch);
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite');
      transaction.objectStore(storeName).put(record);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('chat_store_write_failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('chat_store_write_aborted'));
    });
  } finally {
    db.close();
  }
}

export async function deleteLocalChatData(accountId: string): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction([storeName, fileStoreName], 'readwrite');
      transaction.objectStore(storeName).delete(accountId);
      const cursor = transaction.objectStore(fileStoreName).index('accountId').openKeyCursor(IDBKeyRange.only(accountId));
      cursor.onsuccess = () => {
        const item = cursor.result;
        if (item) { transaction.objectStore(fileStoreName).delete(item.primaryKey); item.continue(); }
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('chat_store_delete_failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('chat_store_delete_aborted'));
    });
  } finally {
    db.close();
  }
}

function cleanName(value: unknown): string {
  return typeof value === 'string' && value.length <= 32 && !/[\u0000-\u001f\u007f]/.test(value)
    ? value.trim()
    : '';
}

function cleanNames(value: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const [accountId, name] of Object.entries(value)) {
    if (isValidAccountId(accountId)) result[accountId] = cleanName(name);
  }
  return result;
}

function cleanPublicKeys(value: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const [accountId, publicKey] of Object.entries(value)) {
    if (isValidAccountId(accountId) && typeof publicKey === 'string' && /^04[0-9a-f]{128}$/.test(publicKey)) {
      result[accountId] = publicKey;
    }
  }
  return result;
}

function cleanReadPreferences(value: unknown): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const [accountId, enabled] of Object.entries(value)) {
    if (isValidAccountId(accountId) && typeof enabled === 'boolean') result[accountId] = enabled;
  }
  return result;
}

function cleanMessages(value: unknown): ChatEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter((message): message is ChatEntry =>
    message && typeof message === 'object' &&
    typeof message.id === 'string' && message.id.length <= 128 &&
    typeof message.text === 'string' &&
    typeof message.from === 'string' && isValidAccountId(message.from) &&
    Number.isFinite(message.timestamp) &&
    (message.direction === 'incoming' || message.direction === 'outgoing'),
  ).map((message) => {
    const observedCall = normalizeCallRecord(message.localCall);
    const localCall = observedCall ? recoverCallRecord(observedCall, Date.now()) : null;
    const delivery = message.delivery === 'saving' && message.direction === 'outgoing' ? 'queued' : message.direction === 'outgoing' &&
      (message.delivery === 'queued' || message.delivery === 'sending' || message.delivery === 'sent' || message.delivery === 'stored' || message.delivery === 'delivered' || message.delivery === 'read')
      ? message.delivery : undefined;
    return {
      id: message.id,
      ...(message.importedFromDevice === true && message.restoredFromBackup === true ? { importedFromDevice: true } : {}),
      ...(Array.isArray(message.deviceCopies) ? { deviceCopies: [...new Set(message.deviceCopies.filter((kind: unknown): kind is 'own' | 'peer' => kind === 'own' || kind === 'peer'))] } : {}),
      ...(message.deviceCopyDelivery === 'stored' || message.deviceCopyDelivery === 'delivered' ? { deviceCopyDelivery: message.deviceCopyDelivery } : {}),
      text: localCall ? callRecordLabel(localCall) : message.text,
      from: message.from,
      timestamp: message.timestamp,
      direction: message.direction,
      ...(message.restoredFromBackup === true ? { restoredFromBackup: true } : {}),
      ...(message.deviceMessage === true ? { deviceMessage: true } : {}),
      ...(localCall ? { localCall, readState: 'skipped' as const } : {}),
      ...(normalizeMessageDetails(message.details) ? { details: normalizeMessageDetails(message.details)! } : {}),
      ...(message.details?.ephemeral && normalizeEphemeralState(message.ephemeralState) ? { ephemeralState: normalizeEphemeralState(message.ephemeralState) } : {}),
      ...(isValidAccountId(message.courierVia) ? { courierVia: message.courierVia } : {}),
      ...(Array.isArray(message.forwardedTo) ? { forwardedTo: [...new Set(message.forwardedTo.filter(isValidAccountId))] } : {}),
      ...(delivery ? { delivery } : {}),
      ...(['canceling','canceled','expired'].includes(message.nodeQueue ?? '') && message.direction === 'outgoing' && !['delivered','read'].includes(delivery ?? '') ? {nodeQueue: message.nodeQueue as 'canceling'|'canceled'|'expired', ...(message.nodeQueueDismissed === true ? {nodeQueueDismissed: true} : {})} : {}),
      ...(isDeliveryIssue(message.deliveryIssue) ? { deliveryIssue: message.deliveryIssue } : {}),
      ...(isDeliveryErrorCode(message.deliveryError) ? { deliveryError: message.deliveryError } : {}),
      ...(message.directFallback === true ? { directFallback: true } : {}),
      ...(radioDeliveries.includes(message.radioDelivery!) ? { radioDelivery: ['queued','transmitting','awaiting'].includes(message.radioDelivery!) ? 'retry' as const : message.radioDelivery } : {}),
      ...(normalizeRadioReception(message.radioReception) ? {radioReception:normalizeRadioReception(message.radioReception)} : {}),
      ...(message.radioSuppressed === true ? {radioSuppressed:true} : {}),
      ...(message.radioNoticeDismissed === true ? {radioNoticeDismissed:true} : {}),
      ...(message.direction === 'incoming' &&
        (message.readState === 'waiting' || message.readState === 'pending' || message.readState === 'sent' || message.readState === 'skipped')
        ? { readState: message.readState } : {}),
      ...(normalizeFileOffer(message.file) ? { file: normalizeFileOffer(message.file)! } : {}),
      ...(normalizeFileOffer(message.file) &&
        (message.fileStatus === 'queued' || message.fileStatus === 'offered' || message.fileStatus === 'receiving' ||
        message.fileStatus === 'sending' || message.fileStatus === 'ready' || message.fileStatus === 'failed' ||
        message.fileStatus === 'rejected' || message.fileStatus === 'canceled') ? { fileStatus: message.fileStatus } : {}),
      ...(normalizeFileOffer(message.file) && typeof message.fileProgress === 'number' && Number.isSafeInteger(message.fileProgress) &&
        message.fileProgress >= 0 && message.fileProgress <= MAX_FILE_BYTES ? { fileProgress: message.fileProgress } : {}),
      ...(normalizeFileOffer(message.file) && message.fileAccepted === true ? { fileAccepted: true } : {}),
      ...(normalizeFileOffer(message.file) && message.fileDeleted === true ? { fileDeleted: true } : {}),
    };
  });
}

function cleanData(value: unknown): LocalChatData {
  if (!value || typeof value !== 'object') throw new Error('chat_store_invalid_data');
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1) throw new Error('chat_store_unsupported_version');
  const chats: SavedChats = { order: [], byPeer: {} };
  const rawChats = raw.chats as Record<string, unknown> | undefined;
  const rawOrder = rawChats?.order;
  const rawPeers = rawChats?.byPeer as Record<string, { messages?: unknown; contact?: unknown; blockedFrom?: unknown; deletedIds?: unknown }> | undefined;
  if (Array.isArray(rawOrder) && rawPeers && typeof rawPeers === 'object') {
    for (const peer of rawOrder) {
      if (typeof peer !== 'string' || !isValidAccountId(peer) || chats.byPeer[peer]) continue;
      chats.order.push(peer);
      const messages = cleanMessages(rawPeers[peer]?.messages);
      const contact = rawPeers[peer]?.contact;
      const blockedFrom = rawPeers[peer]?.blockedFrom;
      chats.byPeer[peer] = {
        messages,
        ...(Array.isArray(rawPeers[peer]?.deletedIds) ? { deletedIds: [...new Set((rawPeers[peer].deletedIds as unknown[]).filter((id): id is string => typeof id === 'string' && MESSAGE_ID.test(id)))] } : {}),
        contact: contact === 'new' || contact === 'outgoing' || contact === 'pending' || contact === 'accepted' || contact === 'blocked'
          ? contact : messages.length ? 'accepted' : 'new',
        ...(blockedFrom === 'new' || blockedFrom === 'outgoing' || blockedFrom === 'pending' || blockedFrom === 'accepted'
          ? { blockedFrom } : {}),
      };
    }
  }
  return {
    ...(raw.deviceSettings !== undefined ? { deviceSettings: normalizeDeviceSettings(raw.deviceSettings) } : {}),
    ...(raw.radioState !== undefined ? { radioState: normalizeRadioState(raw.radioState) } : {}),
    ...(raw.meshtastic !== undefined ? {meshtastic:normalizeNativeChannels(raw.meshtastic)}:{}),
    selfNickname: cleanName(raw.selfNickname),
    ...(raw.selfAvatar !== undefined ? { selfAvatar: normalizeAvatar(raw.selfAvatar) ?? '' } : {}),
    ...(raw.peerAvatars !== undefined ? { peerAvatars: normalizePeerAvatars(raw.peerAvatars) } : {}),
    ...(raw.mediaLibrary !== undefined ? { mediaLibrary: normalizeMediaLibrary(raw.mediaLibrary) } : {}),
    ...(typeof raw.seedBackupVerified === 'boolean' ? { seedBackupVerified: raw.seedBackupVerified } : {}),
    readReceiptsEnabled: raw.readReceiptsEnabled === true,
    autoLockMinutes: normalizeAutoLockMinutes(raw.autoLockMinutes),
    ...(typeof raw.autoReceiveFilesEnabled === 'boolean' ? { autoReceiveFilesEnabled: raw.autoReceiveFilesEnabled } : {}),
    ...(typeof raw.autoPlayVideoEnabled === 'boolean' ? { autoPlayVideoEnabled: raw.autoPlayVideoEnabled } : {}),
    ...(typeof raw.cleanImageMetadataEnabled === 'boolean' ? { cleanImageMetadataEnabled: raw.cleanImageMetadataEnabled } : {}),
    ...(typeof raw.allowForwardAttribution === 'boolean' ? { allowForwardAttribution: raw.allowForwardAttribution } : {}),
    ...(raw.networkSettings ? { networkSettings: normalizeNetworkSettings(raw.networkSettings) } : {}),
    ...(raw.offlineState !== undefined ? { offlineState: restoreOfflineState(raw.offlineState) } : {}),
    ...(raw.courierState !== undefined ? { courierState: restoreCourierState(raw.courierState) } : {}),
    peerReadPreferences: cleanReadPreferences(raw.peerReadPreferences),
    aliases: cleanNames(raw.aliases),
    declaredNames: cleanNames(raw.declaredNames),
    peerPublicKeys: cleanPublicKeys(raw.peerPublicKeys),
    chats,
  };
}

// Reuse the durable schema for portable archives; no live transport objects.
export function normalizeLocalChatData(value: unknown): LocalChatData {
  return cleanData({ ...(value as object), version: 1 });
}

export type LocalStorageSnapshot = { accounts: SealedRecord[]; files: SealedFileRecord[] };
// One read transaction: history and file inventory are from the same disk snapshot.
export async function snapshotLocalStorage(accountIds: readonly string[], maxBytes: number,
  guard: () => void = () => {}, includeFile: (file: SealedFileRecord) => boolean = () => true): Promise<LocalStorageSnapshot> {
  if (!accountIds.length || accountIds.length > 257 || accountIds.some(id => !isValidAccountId(id))) throw new Error('backup_invalid');
  const allowed = new Set(accountIds), result: LocalStorageSnapshot = { accounts: [], files: [] };
  const db = await openDatabase(); let total = 0;
  try {
    guard();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([storeName, fileStoreName], 'readonly');
      const include = (record: SealedRecord | undefined, file: boolean) => {
        guard(); if (!record) return;
        if (!allowed.has(record.accountId)) throw new Error('backup_wrong_account');
        if (file && !includeFile(record as SealedFileRecord)) return;
        total += record.cipher.byteLength + record.iv.byteLength;
        if (total > maxBytes) throw new Error('backup_too_large');
        if (file) result.files.push(record as SealedFileRecord); else result.accounts.push(record);
      };
      for (const accountId of allowed) {
        const account = tx.objectStore(storeName).get(accountId);
        account.onsuccess = () => { try { include(account.result, false); } catch (error) { reject(error); tx.abort(); } };
        const request = tx.objectStore(fileStoreName).index('accountId').openCursor(IDBKeyRange.only(accountId));
        request.onsuccess = () => {
          const cursor = request.result; if (!cursor) return;
          try { include(cursor.value, true); cursor.continue(); }
          catch (error) { reject(error); tx.abort(); }
        };
      }
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('backup_storage_aborted'));
    });
    guard(); return result;
  } finally { db.close(); }
}

// Restore never overwrites an existing profile or races a newly created record.
// All accounts and attachments are inserted together, or none are inserted.
export async function insertEmptyLocalStorage(snapshot: LocalStorageSnapshot, guard: () => void, restoreId?: string): Promise<void> {
  const epoch = storageEpoch(), db = await openDatabase();
  try {
    guard(); requireStorageEpoch(epoch);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([storeName, fileStoreName], 'readwrite');
      let pending = snapshot.accounts.length, alreadyImported = 0;
      if (!pending) { tx.abort(); reject(new Error('backup_invalid')); return; }
      const fail = (error: unknown) => { reject(error); tx.abort(); };
      for (const account of snapshot.accounts) {
        const request = tx.objectStore(storeName).get(account.accountId);
        request.onsuccess = () => {
          try {
            guard(); requireStorageEpoch(epoch);
            if (request.result) {
              if (!restoreId || request.result.restoreId !== restoreId) throw new Error('backup_destination_not_empty');
              alreadyImported++;
            }
            if (--pending) return;
            // Resume the exact previously committed archive after a crash
            // before vault/profile setup, without rewriting any existing bytes.
            if (alreadyImported === snapshot.accounts.length) return;
            if (alreadyImported) throw new Error('backup_destination_not_empty');
            for (const record of snapshot.accounts) tx.objectStore(storeName).add({ ...record, ...(restoreId ? { restoreId } : {}) });
            for (const record of snapshot.files) tx.objectStore(fileStoreName).add(record);
          } catch (error) { fail(error); }
        };
      }
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('backup_restore_aborted'));
    });
  } finally { db.close(); }
}

// Data-only recovery may replace an empty, already initialized history record.
// Compare the exact observed ciphertext INSIDE the transaction: a concurrent
// message/settings write must abort recovery, never get overwritten.
export async function replaceObservedLocalStorage(snapshot: LocalStorageSnapshot, observed: SealedRecord | undefined,
  guard: () => void): Promise<void> {
  if (snapshot.accounts.length !== 1 || snapshot.files.some(file => file.accountId !== snapshot.accounts[0].accountId)) throw new Error('backup_invalid');
  const next = snapshot.accounts[0], epoch = storageEpoch(), db = await openDatabase();
  if (observed && observed.accountId !== next.accountId) { db.close(); throw new Error('backup_wrong_account'); }
  const equal = (left: ArrayBuffer | Uint8Array, right: ArrayBuffer | Uint8Array) => {
    const a = new Uint8Array(left), b = new Uint8Array(right);
    return a.length === b.length && a.every((value, index) => value === b[index]);
  };
  try {
    guard(); requireStorageEpoch(epoch);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([storeName, fileStoreName], 'readwrite');
      const request = tx.objectStore(storeName).get(next.accountId);
      request.onsuccess = () => {
        try {
          guard(); requireStorageEpoch(epoch);
          const current = request.result as SealedRecord | undefined;
          if (!!current !== !!observed || current && observed &&
            (!equal(current.iv, observed.iv) || !equal(current.cipher, observed.cipher))) throw new Error('backup_destination_changed');
          tx.objectStore(storeName).put(next);
          for (const file of snapshot.files) tx.objectStore(fileStoreName).add(file);
        } catch (error) { reject(error); tx.abort(); }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('backup_restore_aborted'));
    });
  } finally { db.close(); }
}

export async function openSealedChatData(key: CryptoKey, accountId: string, record: SealedRecord): Promise<LocalChatData> {
  if (record.accountId !== accountId) throw new Error('chat_store_account_mismatch');
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toBuffer(new Uint8Array(record.iv)), additionalData: toBuffer(textEncoder.encode(accountId)) },
    key,
    record.cipher,
  );
  try { return cleanData(JSON.parse(new TextDecoder().decode(plaintext))); }
  finally { new Uint8Array(plaintext).fill(0); }
}

export async function sealChatData(key: CryptoKey, accountId: string, data: LocalChatData): Promise<SealedRecord> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = textEncoder.encode(JSON.stringify({ version: 1, ...data }));
  const input = toBuffer(plaintext);
  try {
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toBuffer(iv), additionalData: toBuffer(textEncoder.encode(accountId)) },
    key,
    input,
  );
  return { accountId, iv, cipher };
  } finally { plaintext.fill(0); new Uint8Array(input).fill(0); }
}

export async function loadLocalChatData(key: CryptoKey, accountId: string): Promise<LocalChatData | null> {
  const record = await readRecord(accountId);
  return record ? openSealedChatData(key, accountId, record) : null;
}

export async function saveLocalChatData(key: CryptoKey, accountId: string, data: LocalChatData): Promise<void> {
  const epoch = storageEpoch();
  await writeRecord(await sealChatData(key, accountId, data), epoch);
}

export async function saveLocalSessionData(
  key: CryptoKey, accountId: string, data: LocalChatData, files: ReadonlyMap<string, Uint8Array>,
): Promise<void> {
  const epoch = storageEpoch();
  const chatRecord = await sealChatData(key, accountId, data);
  const fileRecords: SealedFileRecord[] = [];
  for (const [id, bytes] of files) fileRecords.push(await sealLocalFileData(key, accountId, id, bytes));
  const db = await openDatabase();
  try {
    requireStorageEpoch(epoch);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([storeName, fileStoreName], 'readwrite');
      tx.objectStore(storeName).put(chatRecord);
      const fileStore = tx.objectStore(fileStoreName);
      for (const record of fileRecords) fileStore.put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('session_store_write_failed'));
      tx.onabort = () => reject(tx.error ?? new Error('session_store_write_aborted'));
    });
  } finally { db.close(); }
}

function fileKey(accountId: string, id: string): string { return `${accountId}:${id}`; }
function fileAad(accountId: string, id: string): ArrayBuffer {
  return toBuffer(textEncoder.encode(JSON.stringify(['MeshAutonomy local file v1', accountId, id])));
}

export async function sealLocalFileData(key: CryptoKey, accountId: string, id: string, bytes: Uint8Array): Promise<SealedFileRecord> {
  if (bytes.byteLength > MAX_FILE_BYTES) throw new Error('file_too_large');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toBuffer(iv), additionalData: fileAad(accountId, id) }, key, toBuffer(bytes));
  return { key: fileKey(accountId, id), accountId, id, iv, cipher };
}

export async function openSealedFileData(key: CryptoKey, accountId: string, id: string, record: SealedFileRecord): Promise<Uint8Array> {
  if (record.accountId !== accountId || record.id !== id || record.key !== fileKey(accountId, id))
    throw new Error('file_store_account_mismatch');
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toBuffer(new Uint8Array(record.iv)), additionalData: fileAad(accountId, id) }, key, record.cipher);
  if (plain.byteLength > MAX_FILE_BYTES) throw new Error('file_store_oversized');
  return new Uint8Array(plain);
}

export async function saveLocalFileData(key: CryptoKey, accountId: string, id: string, bytes: Uint8Array): Promise<void> {
  const epoch = storageEpoch();
  const record = await sealLocalFileData(key, accountId, id, bytes);
  const db = await openDatabase();
  try {
    requireStorageEpoch(epoch);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(fileStoreName, 'readwrite');
      tx.objectStore(fileStoreName).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('file_store_write_failed'));
      tx.onabort = () => reject(tx.error ?? new Error('file_store_write_aborted'));
    });
  } finally { db.close(); }
}

export async function loadLocalFileData(key: CryptoKey, accountId: string, id: string): Promise<Uint8Array | null> {
  const db = await openDatabase();
  let record: SealedFileRecord | undefined;
  try {
    record = await new Promise((resolve, reject) => {
      const tx = db.transaction(fileStoreName, 'readonly');
      const request = tx.objectStore(fileStoreName).get(fileKey(accountId, id));
      request.onsuccess = () => resolve(request.result as SealedFileRecord | undefined);
      request.onerror = () => reject(request.error ?? new Error('file_store_read_failed'));
    });
  } finally { db.close(); }
  if (!record) return null;
  return openSealedFileData(key, accountId, id, record);
}

export async function deleteLocalFileData(accountId: string, id: string): Promise<void> {
  await deleteLocalFiles(accountId, [id]);
}

export async function deleteLocalFiles(accountId: string, ids?: readonly string[]): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(fileStoreName, 'readwrite');
      const store = tx.objectStore(fileStoreName);
      if (ids) for (const id of ids) store.delete(fileKey(accountId, id));
      else {
        const request = store.index('accountId').openKeyCursor(IDBKeyRange.only(accountId));
        request.onsuccess = () => { const cursor = request.result; if (cursor) { store.delete(cursor.primaryKey); cursor.continue(); } };
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('file_store_delete_failed'));
      tx.onabort = () => reject(tx.error ?? new Error('file_store_delete_aborted'));
    });
  } finally { db.close(); }
}

export type StorageInventory = {
  historyBytes: number; otherAccountBytes: number; allFileBytes: number;
  files: Array<{ id: string; bytes: number }>;
};
// Ciphertext sizes only; never decrypt other accounts, vaults or key material.
export async function inspectChatStorage(accountId: string): Promise<StorageInventory> {
  const db = await openDatabase();
  const result: StorageInventory = { historyBytes: 0, otherAccountBytes: 0, allFileBytes: 0, files: [] };
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([storeName, fileStoreName], 'readonly');
      for (const name of [storeName, fileStoreName]) {
        const request = tx.objectStore(name).openCursor();
        request.onsuccess = () => {
          const cursor = request.result; if (!cursor) return;
          const record = cursor.value as SealedFileRecord;
          const size = record.cipher.byteLength + record.iv.byteLength;
          if (name === fileStoreName) {
            result.allFileBytes += size;
            if (record.accountId === accountId) result.files.push({ id: record.id, bytes: size });
            else result.otherAccountBytes += size;
          } else if (record.accountId === accountId) result.historyBytes += size;
          else result.otherAccountBytes += size;
          cursor.continue();
        };
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('storage_inspection_failed'));
      tx.onabort = () => reject(tx.error ?? new Error('storage_inspection_aborted'));
    });
    return result;
  } finally { db.close(); }
}

export async function clearAllChatStorage(): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([storeName, fileStoreName], 'readwrite');
      tx.objectStore(storeName).clear(); tx.objectStore(fileStoreName).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('storage_reset_failed'));
      tx.onabort = () => reject(tx.error ?? new Error('storage_reset_aborted'));
    });
  } finally { db.close(); }
}

// Publish the cleaned snapshot and remove its file bytes in the same transaction.
export async function saveChatDataWithFileDeletion(key: CryptoKey, accountId: string, data: LocalChatData, ids?: readonly string[]): Promise<void> {
  const epoch = storageEpoch();
  const record = await sealChatData(key, accountId, data);
  const db = await openDatabase();
  try {
    requireStorageEpoch(epoch);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([storeName, fileStoreName], 'readwrite');
      tx.objectStore(storeName).put(record);
      const store = tx.objectStore(fileStoreName);
      if (ids) for (const id of ids) store.delete(fileKey(accountId, id));
      else {
        const request = store.index('accountId').openKeyCursor(IDBKeyRange.only(accountId));
        request.onsuccess = () => { const cursor = request.result; if (cursor) { store.delete(cursor.primaryKey); cursor.continue(); } };
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('storage_cleanup_failed'));
      tx.onabort = () => reject(tx.error ?? new Error('storage_cleanup_aborted'));
    });
  } finally { db.close(); }
}
