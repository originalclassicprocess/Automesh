import { createEncryptedBackup, openEncryptedBackup, type OpenedBackup } from '$lib/vault/encrypted-backup';
import { normalizeLocalChatData, type LocalChatData } from '$lib/chat/local-store';
import { libraryFileId, imageKind } from '$lib/chat/media-library';
import { sha256Hex } from '$lib/chat/file-transfer';
import { accountIdFromPublicKey } from '$lib/addressing/account-id.js';
import { profileRegistrySnapshot, type ProfileRegistry } from '$lib/core/profiles';
import { normalizeNetworkSettings } from '$lib/transport/network-settings';

// No compression or executable archive paths. Bounded binary payload with an
// authenticated encrypted manifest. Metadata/seed/addresses are not public.
export const MAX_FULL_BACKUP_BYTES = 128 * 1024 * 1024;
const MAX_META = 16 * 1024 * 1024, MAX_FILES = 10000;
const MAGIC = new TextEncoder().encode('AMFULL01');
const AAD = new TextEncoder().encode('Automesh full backup v1:PBKDF2-SHA256-600000:AES-256-GCM');
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
const buffer = (value: Uint8Array) => new Uint8Array(value).buffer as ArrayBuffer;
const invalid = (): never => { throw new Error('backup_invalid'); };
export type BackupProfile = { accountId: string; data: LocalChatData; files: Map<string, Uint8Array> };
export type BackupSummary = { profiles: number; contacts: number; messages: number; files: number; missingFiles: number };
export type FullBackupContents = { profiles: BackupProfile[]; summary: BackupSummary; language?: 'en' | 'ru'; selectedProfileId?: string; createdAt: string; backupId: string };
export type OpenedFullBackup = OpenedBackup & { full: FullBackupContents };
type FileDescription = { id: string; size: number; hash: string };

async function passwordKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  if (password.length < 8 || password.length > 1024) throw new Error('backup_password_short');
  const input = encoder.encode(password);
  try {
    const material = await crypto.subtle.importKey('raw', buffer(input), 'PBKDF2', false, ['deriveKey']);
    return await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', iterations: 600000, salt: buffer(salt) },
      material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  } finally { input.fill(0); }
}

export function referencedBackupFiles(data: LocalChatData): Map<string, { size: number; hash: string }> {
  const result = new Map<string, { size: number; hash: string }>();
  const reference = (id: string, value: { size: number; hash: string }) => {
    const old = result.get(id); if (old && (old.size !== value.size || old.hash !== value.hash)) invalid();
    result.set(id,value);
  };
  for (const peer of data.chats.order) for (const message of data.chats.byPeer[peer].messages) {
    if (message.file && !message.fileDeleted && !message.details?.ephemeral) reference(`${peer}:${message.file.id}`, { size: message.file.size, hash: message.file.sha256 });
  }
  for (const asset of data.mediaLibrary?.assets ?? []) reference(libraryFileId(asset.id), { size: asset.size, hash: asset.hash });
  return result;
}

// Archive user data/settings, never prekeys, relay credentials or pending jobs.
export function portableChatData(value: LocalChatData): LocalChatData {
  const { offlineState: _offline, courierState: _courier, radioState: _radio, ...rest } = normalizeLocalChatData(value);
  for (const peer of rest.chats.order) rest.chats.byPeer[peer].messages = rest.chats.byPeer[peer].messages.filter(message => !message.details?.ephemeral && !message.details?.ephemeralOpened);
  for (const peer of rest.chats.order) for (const message of rest.chats.byPeer[peer].messages) {
    delete message.deviceCopies; delete message.deviceCopyDelivery;
    delete message.radioDelivery;
    delete message.radioSuppressed;
    delete message.radioNoticeDismissed;
  }
  // Retain public node references, not their receiving keys/jobs/authorization.
  const known = [...(rest.networkSettings?.managedNodes ?? [])];
  for (const node of [_offline?.node, _courier?.node]) if (node && !known.some(n => n.nodeId === node.nodeId && n.url === node.url))
    known.push({ url: node.url, nodeId: node.nodeId, name: 'Нода доставки' });
  if (known.length) rest.networkSettings = normalizeNetworkSettings({ ...rest.networkSettings, managedNodes: known });
  return rest;
}

export function disposeFullBackup(full: FullBackupContents | undefined): void {
  for (const profile of full?.profiles ?? []) { for (const bytes of profile.files.values()) bytes.fill(0); profile.files.clear(); }
  if (full) full.profiles.length = 0;
}

export async function validateBackupProfiles(profiles: BackupProfile[], allowed: Set<string>, guard: () => void): Promise<BackupSummary> {
  if (!Array.isArray(profiles) || !profiles.length || profiles.length > 257) invalid();
  const seen = new Set<string>(); const summary = { profiles: profiles.length, contacts: 0, messages: 0, files: 0, missingFiles: 0 };
  let bytes = 0;
  for (const profile of profiles) {
    guard();
    if (!allowed.has(profile.accountId) || seen.has(profile.accountId) || !(profile.files instanceof Map)) invalid();
    seen.add(profile.accountId); profile.data = portableChatData(profile.data);
    const data = profile.data;
    if (data.chats.order.length > 10000) invalid();
    summary.contacts += data.chats.order.length;
    for (const [peer, publicKey] of Object.entries(data.peerPublicKeys)) {
      if (await accountIdFromPublicKey(Uint8Array.from(publicKey.match(/../g)!, x => parseInt(x, 16))) !== peer) invalid(); guard();
    }
    for (const peer of data.chats.order) for (const message of data.chats.byPeer[peer].messages) {
      if (++summary.messages > 100000 || message.from !== (message.direction === 'incoming' ? peer : profile.accountId)) invalid();
    }
    const referenced = referencedBackupFiles(data);
    for (const [id, expected] of referenced) {
      const file = profile.files.get(id);
      if (!file) { summary.missingFiles++; continue; }
      if (file.length !== expected.size || await sha256Hex(file) !== expected.hash) throw new Error('backup_file_corrupt');
      guard();
    }
    for (const [id, file] of profile.files) {
      if (!referenced.has(id) || !(file instanceof Uint8Array) || ++summary.files > MAX_FILES) invalid();
      bytes += file.length; if (bytes > MAX_FULL_BACKUP_BYTES) throw new Error('backup_too_large');
    }
    for (const asset of data.mediaLibrary?.assets ?? []) {
      const file = profile.files.get(libraryFileId(asset.id));
      if (file && imageKind(file) !== asset.mime) throw new Error('backup_file_corrupt');
    }
  }
  return summary;
}

export async function createFullBackup(options: { seed: Uint8Array; password: string; accountId: string; nickname: string;
  registry?: ProfileRegistry; profiles: BackupProfile[]; selectedProfileId?: string; language?: 'en' | 'ru'; guard?: () => void }): Promise<{ file: Blob; summary: BackupSummary; backupId: string }> {
  const guard = options.guard ?? (() => {}); guard();
  const registry = options.registry ? profileRegistrySnapshot(options.registry) : undefined, selectedProfileId = options.selectedProfileId;
  if (selectedProfileId && !registry?.profiles.some(p=>p.id===selectedProfileId && !p.archived)) invalid();
  const identity = await createEncryptedBackup(options.seed, options.password, options.accountId, options.nickname, registry); guard();
  const allowed = new Set([options.accountId, ...(registry?.profiles.map(p => p.accountId) ?? [])]);
  const summary = await validateBackupProfiles(options.profiles, allowed, guard);
  const descriptions = [];
  for (const profile of options.profiles) {
    const files: FileDescription[] = [];
    for (const [id, bytes] of profile.files) { files.push({ id, size: bytes.length, hash: await sha256Hex(bytes) }); guard(); }
    descriptions.push({ accountId: profile.accountId, data: profile.data, files });
  }
  const backupId = crypto.randomUUID();
  const meta = encoder.encode(JSON.stringify({ format: 'automesh-full-backup', version: 1, backupId, createdAt: new Date().toISOString(),
    identity, profiles: descriptions, ...(selectedProfileId ? { selectedProfileId } : {}), ...(options.language ? { language: options.language } : {}) }));
  const total = 4 + meta.length + options.profiles.reduce((sum, p) => sum + [...p.files.values()].reduce((s, b) => s + b.length, 0), 0);
  if (meta.length > MAX_META || total + 52 > MAX_FULL_BACKUP_BYTES) { meta.fill(0); throw new Error('backup_too_large'); }
  const plain = new Uint8Array(total); new DataView(plain.buffer).setUint32(0, meta.length); plain.set(meta, 4); meta.fill(0);
  let offset = 4 + new DataView(plain.buffer).getUint32(0);
  for (const profile of options.profiles) for (const bytes of profile.files.values()) { plain.set(bytes, offset); offset += bytes.length; }
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  try {
    const key = await passwordKey(options.password, salt); guard();
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buffer(iv), additionalData: buffer(AAD) }, key, plain.buffer);
    guard(); return { file: new Blob([buffer(MAGIC), buffer(salt), buffer(iv), cipher], { type: 'application/octet-stream' }), summary, backupId };
  } finally { plain.fill(0); }
}

export function isFullBackup(bytes: Uint8Array): boolean { return bytes.length >= MAGIC.length && MAGIC.every((v, i) => bytes[i] === v); }
export async function openFullBackup(file: Blob, password: string, expectedAccountId = '', guard: () => void = () => {}): Promise<OpenedFullBackup> {
  if (file.size > MAX_FULL_BACKUP_BYTES) throw new Error('backup_too_large');
  if (file.size < 56) invalid();
  const header = new Uint8Array(await file.slice(0, 36).arrayBuffer()); guard();
  if (!isFullBackup(header)) invalid();
  const key = await passwordKey(password, header.slice(8, 24)); guard();
  let plain: Uint8Array;
  try { plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buffer(header.slice(24, 36)), additionalData: buffer(AAD) }, key, await file.slice(36).arrayBuffer())); }
  catch { throw new Error('backup_cannot_decrypt'); }
  let identity: OpenedBackup | undefined; const profiles: BackupProfile[] = [];
  try {
    guard(); const length = new DataView(plain.buffer).getUint32(0);
    if (length > MAX_META || length < 2 || 4 + length > plain.length) invalid();
    const meta = JSON.parse(decoder.decode(plain.subarray(4, 4 + length)));
    if (!meta || meta.format !== 'automesh-full-backup' || meta.version !== 1 || typeof meta.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(meta.createdAt)) || typeof meta.identity !== 'string' || !Array.isArray(meta.profiles) ||
      meta.profiles.length < 1 || meta.profiles.length > 257 || typeof meta.backupId !== 'string' || !/^[a-f0-9-]{36}$/.test(meta.backupId) ||
      Object.keys(meta).some(k => !['format','version','backupId','createdAt','identity','profiles','language','selectedProfileId'].includes(k)) ||
      meta.language !== undefined && meta.language !== 'en' && meta.language !== 'ru') invalid();
    identity = await openEncryptedBackup(meta.identity, password, expectedAccountId); guard();
    if (meta.selectedProfileId !== undefined && (typeof meta.selectedProfileId !== 'string' ||
      !identity.profiles?.profiles.some(p=>p.id===meta.selectedProfileId && !p.archived))) invalid();
    let offset = 4 + length, count = 0;
    for (const entry of meta.profiles) {
      if (!entry || typeof entry.accountId !== 'string' || !entry.data || typeof entry.data !== 'object' || !Array.isArray(entry.files) ||
        Object.keys(entry).sort().join(',') !== 'accountId,data,files') invalid();
      const files = new Map<string, Uint8Array>();
      profiles.push({ accountId: entry.accountId, data: entry.data, files });
      for (const desc of entry.files) {
        if (++count > MAX_FILES || !desc || typeof desc.id !== 'string' || desc.id.length > 180 || files.has(desc.id) ||
          !Number.isSafeInteger(desc.size) || desc.size < 0 || desc.size > plain.length - offset || typeof desc.hash !== 'string' ||
          !/^[a-f0-9]{64}$/.test(desc.hash) || Object.keys(desc).sort().join(',') !== 'hash,id,size') invalid();
        const bytes = plain.slice(offset, offset + desc.size); files.set(desc.id, bytes); offset += desc.size;
        if (await sha256Hex(bytes) !== desc.hash) throw new Error('backup_file_corrupt'); guard();
      }
    }
    if (offset !== plain.length) invalid();
    const summary = await validateBackupProfiles(profiles, new Set([identity.accountId, ...(identity.profiles?.profiles.map(p => p.accountId) ?? [])]), guard);
    guard(); return { ...identity, full: { profiles, summary, backupId: meta.backupId, createdAt: meta.createdAt,
      ...(meta.selectedProfileId ? { selectedProfileId: meta.selectedProfileId } : {}), ...(meta.language ? { language: meta.language } : {}) } };
  } catch (error) { identity?.seed.fill(0); disposeFullBackup({ profiles } as FullBackupContents); throw error; }
  finally { plain.fill(0); }
}

// Restore is data recovery, NOT replay of old transport operations.
export function restoredChatData(profile: BackupProfile): LocalChatData {
  const data = portableChatData(profile.data);
  if (data.networkSettings) data.networkSettings = { ...data.networkSettings, signalingEnabled: false,
    nodes: data.networkSettings.nodes.map(n => ({ ...n, enabled: false })),
    internetNodes: data.networkSettings.internetNodes?.map(n => ({ ...n, enabled: false })) };
  // Public authority pins are recovery hints, not permission to contact an
  // imported endpoint. Device HTTP operates independently of signaling.
  if (data.deviceSettings) data.deviceSettings = { ...data.deviceSettings, enabled: false, allowCached: false };
  for (const peer of data.chats.order) for (const message of data.chats.byPeer[peer].messages) {
    message.restoredFromBackup = true;
    if (message.direction === 'outgoing' && !['delivered', 'read'].includes(message.delivery ?? '')) delete message.delivery;
    if (message.direction === 'incoming' && message.readState !== 'sent') message.readState = 'skipped';
    if (message.file && !message.fileDeleted) {
      message.fileStatus = profile.files.has(`${peer}:${message.file.id}`) ? 'ready' : 'canceled';
      message.fileAccepted = false; message.fileProgress = profile.files.get(`${peer}:${message.file.id}`)?.length ?? 0;
    }
  }
  return data;
}
