import { isValidAccountId } from '$lib/addressing/bech32m.js';
import { normalizeLocalChatData, type LocalChatData } from '$lib/chat/local-store';
import { sha256Hex } from '$lib/chat/file-transfer';
import { MAX_FULL_BACKUP_BYTES, validateBackupProfiles, disposeFullBackup,
  type BackupProfile, type FullBackupContents } from './full-backup';

// Independent data format: never calls the identity/seed backup serializer.
const MAGIC = new TextEncoder().encode('AMDATA01');
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
const AAD = encoder.encode('Automesh data backup v1:PBKDF2-SHA256-600000:AES-256-GCM');
const MAX_META = 16 * 1024 * 1024, MAX_FILES = 10000;
const bytes = (value: Uint8Array) => new Uint8Array(value).buffer as ArrayBuffer;
const invalid = (): never => { throw new Error('backup_invalid'); };
const exact = (value: unknown, names: string[]): value is Record<string, any> => !!value && typeof value === 'object' &&
  !Array.isArray(value) && Object.keys(value).sort().join(',') === [...names].sort().join(',');
const DATA_FIELDS = ['selfNickname', 'selfAvatar', 'peerAvatars', 'selfLinks', 'peerLinks', 'mediaLibrary', 'readReceiptsEnabled',
  'autoLockMinutes', 'autoReceiveFilesEnabled', 'autoPlayVideoEnabled', 'cleanImageMetadataEnabled',
  'allowForwardAttribution', 'peerReadPreferences', 'aliases', 'declaredNames', 'peerPublicKeys', 'chats', 'meshtastic'] as const;
export type DataBackupContents = FullBackupContents & { accountId: string };

// Explicit allowlist, not "remove seed": prevents new credential fields from
// silently entering this format as the application grows.
export function dataOnlyChatData(input: LocalChatData): LocalChatData {
  const normalized = normalizeLocalChatData(input), result: Record<string, unknown> = {};
  for (const field of DATA_FIELDS) if (normalized[field] !== undefined) result[field] = normalized[field];
  const data = result as LocalChatData;
  for (const peer of data.chats.order) {
    const conversation = data.chats.byPeer[peer];
    conversation.messages = conversation.messages.filter(m => !m.details?.ephemeral && !m.details?.ephemeralOpened);
    // Historical copies must never start a device transaction or replay mail.
    for (const message of conversation.messages) {
      delete message.deviceMessage; delete message.courierVia; delete message.directFallback;
      delete message.deliveryIssue; delete message.deliveryError;
      delete message.deviceCopies; delete message.deviceCopyDelivery;
      delete message.radioDelivery;
      delete message.radioSuppressed;
      delete message.radioNoticeDismissed;
    }
  }
  return data;
}

async function passwordKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  if (password.length < 8 || password.length > 1024) throw new Error('backup_password_short');
  const input = encoder.encode(password);
  try {
    const material = await crypto.subtle.importKey('raw', bytes(input), 'PBKDF2', false, ['deriveKey']);
    return await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', iterations: 600000, salt: bytes(salt) },
      material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  } finally { input.fill(0); }
}

export function isDataBackup(header: Uint8Array): boolean {
  return header.length >= MAGIC.length && MAGIC.every((value, index) => header[index] === value);
}

export async function createDataBackup(options: { accountId: string; password: string; profile: BackupProfile;
  language?: 'en' | 'ru'; guard?: () => void }): Promise<{ file: Blob; summary: FullBackupContents['summary']; backupId: string }> {
  const guard = options.guard ?? (() => {}); guard();
  if (!isValidAccountId(options.accountId) || options.profile.accountId !== options.accountId) throw new Error('backup_wrong_account');
  const profile = { ...options.profile, data: dataOnlyChatData(options.profile.data) };
  const summary = await validateBackupProfiles([profile], new Set([options.accountId]), guard);
  profile.data = dataOnlyChatData(profile.data);
  const files = [];
  for (const [id, file] of profile.files) { files.push({ id, size: file.length, hash: await sha256Hex(file) }); guard(); }
  const backupId = crypto.randomUUID();
  const metadata = encoder.encode(JSON.stringify({ format: 'automesh-data-backup', version: 1, accountId: options.accountId,
    backupId, createdAt: new Date().toISOString(), data: profile.data, files,
    ...(options.language ? { language: options.language } : {}) }));
  const length = 4 + metadata.length + [...profile.files.values()].reduce((sum, file) => sum + file.length, 0);
  if (metadata.length > MAX_META || length + 52 > MAX_FULL_BACKUP_BYTES) { metadata.fill(0); throw new Error('backup_too_large'); }
  const plain = new Uint8Array(length); new DataView(plain.buffer).setUint32(0, metadata.length); plain.set(metadata, 4); metadata.fill(0);
  let offset = 4 + new DataView(plain.buffer).getUint32(0);
  for (const file of profile.files.values()) { plain.set(file, offset); offset += file.length; }
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  try {
    const key = await passwordKey(options.password, salt); guard();
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: bytes(iv), additionalData: bytes(AAD) }, key, plain.buffer);
    guard(); return { file: new Blob([bytes(MAGIC), bytes(salt), bytes(iv), cipher], { type: 'application/octet-stream' }), summary, backupId };
  } finally { plain.fill(0); }
}

export async function openDataBackup(file: Blob, password: string, expectedAccountId = '', guard: () => void = () => {}): Promise<DataBackupContents> {
  if (file.size > MAX_FULL_BACKUP_BYTES) throw new Error('backup_too_large');
  if (file.size < 56) invalid();
  const header = new Uint8Array(await file.slice(0, 36).arrayBuffer()); guard();
  if (!isDataBackup(header)) invalid();
  const key = await passwordKey(password, header.slice(8, 24)); guard();
  let plain: Uint8Array;
  try { plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(header.slice(24, 36)), additionalData: bytes(AAD) }, key, await file.slice(36).arrayBuffer())); }
  catch { throw new Error('backup_cannot_decrypt'); }
  const profiles: BackupProfile[] = [];
  try {
    guard(); if (plain.length < 4) invalid();
    const size = new DataView(plain.buffer).getUint32(0);
    if (size < 2 || size > MAX_META || size + 4 > plain.length) invalid();
    const meta = JSON.parse(decoder.decode(plain.subarray(4, 4 + size)));
    if (!exact(meta, ['format', 'version', 'accountId', 'backupId', 'createdAt', 'data', 'files', ...(meta?.language !== undefined ? ['language'] : [])]) ||
      meta.format !== 'automesh-data-backup' || meta.version !== 1 || !isValidAccountId(meta.accountId) ||
      typeof meta.backupId !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(meta.backupId) ||
      typeof meta.createdAt !== 'string' || !Number.isFinite(Date.parse(meta.createdAt)) ||
      !meta.data || typeof meta.data !== 'object' || Array.isArray(meta.data) ||
      Object.keys(meta.data).some(name => !(DATA_FIELDS as readonly string[]).includes(name)) ||
      !Array.isArray(meta.files) || meta.files.length > MAX_FILES ||
      meta.language !== undefined && !['en', 'ru'].includes(meta.language)) invalid();
    if (expectedAccountId && meta.accountId !== expectedAccountId) throw new Error('backup_wrong_account');
    const profile = { accountId: meta.accountId, data: dataOnlyChatData(meta.data), files: new Map<string, Uint8Array>() };
    profiles.push(profile); let offset = 4 + size;
    for (const entry of meta.files) {
      if (!exact(entry, ['id', 'size', 'hash']) || typeof entry.id !== 'string' || entry.id.length > 180 || profile.files.has(entry.id) ||
        !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > plain.length - offset ||
        typeof entry.hash !== 'string' || !/^[a-f0-9]{64}$/.test(entry.hash)) invalid();
      const file = plain.slice(offset, offset + entry.size); profile.files.set(entry.id, file); offset += entry.size;
      if (await sha256Hex(file) !== entry.hash) throw new Error('backup_file_corrupt'); guard();
    }
    if (offset !== plain.length) invalid();
    const summary = await validateBackupProfiles(profiles, new Set([meta.accountId]), guard);
    profile.data = dataOnlyChatData(profile.data); guard();
    return { accountId: meta.accountId, profiles, summary, createdAt: meta.createdAt, backupId: meta.backupId,
      ...(meta.language ? { language: meta.language } : {}) };
  } catch (error) { disposeFullBackup({ profiles } as FullBackupContents); throw error; }
  finally { plain.fill(0); }
}
