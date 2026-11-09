import { mnemonicToSeed, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { deriveIdentitySeed } from '$lib/identity/namespace';
import { WebCryptoIdentity } from '$lib/identity/webcrypto';
import { getAccountId } from '$lib/addressing/address';
import { bytesToHex } from '$lib/message/encoding';
import { profileRegistrySnapshot, type ProfileRegistry } from '$lib/core/profiles';
import { verifyProfileRegistry } from '$lib/profiles/backup';
import type { FullBackupContents } from '$lib/backup/full-backup';

export const MAX_BACKUP_BYTES = 128 * 1024;
const ITERATIONS = 600_000;
const encoder = new TextEncoder();
const aadFor = (version: 1 | 2) => encoder.encode(`Automesh account backup v${version}:PBKDF2-SHA256-600000:AES-256-GCM`);
const toBuffer = (bytes: Uint8Array) => new Uint8Array(bytes).buffer as ArrayBuffer;
const encode = (bytes: Uint8Array) => {
  let text = '';
  for (let offset = 0; offset < bytes.length; offset += 4096) text += String.fromCharCode(...bytes.subarray(offset, offset + 4096));
  return btoa(text);
};
export interface OpenedBackup { seed: Uint8Array; accountId: string; nickname: string; profiles?: ProfileRegistry; full?: FullBackupContents }
function decode(value: unknown, length?: number): Uint8Array {
  if (typeof value !== 'string' || value.length > MAX_BACKUP_BYTES || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error('backup_invalid');
  const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  if (encode(bytes) !== value || (length !== undefined && bytes.length !== length)) throw new Error('backup_invalid');
  return bytes;
}

async function keyFor(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const bytes = encoder.encode(password);
  const input = toBuffer(bytes);
  try {
    const material = await crypto.subtle.importKey('raw', input, 'PBKDF2', false, ['deriveKey']);
    return await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt: toBuffer(salt) },
      material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  } finally { bytes.fill(0); new Uint8Array(input).fill(0); }
}

async function idFor(phrase: string): Promise<string> {
  const master = await mnemonicToSeed(phrase);
  let derived: Uint8Array | undefined;
  const identity = new WebCryptoIdentity();
  try {
    derived = await deriveIdentitySeed(master);
    const result = await identity.fromSeed(derived);
    return await getAccountId(bytesToHex(result.publicKey));
  } finally { identity.dispose(); master.fill(0); derived?.fill(0); }
}

async function checkedProfiles(phrase: string, accountId: string, value: unknown): Promise<ProfileRegistry> {
  const master = await mnemonicToSeed(phrase);
  let root: Uint8Array | undefined;
  try { root = await deriveIdentitySeed(master); return await verifyProfileRegistry(root, accountId, value); }
  finally { master.fill(0); root?.fill(0); }
}

function cleanNickname(nickname: unknown): string {
  if (typeof nickname !== 'string' || nickname.length > 32 || /[\u0000-\u001f\u007f]/.test(nickname)) throw new Error('backup_invalid');
  return nickname.trim();
}

export async function createEncryptedBackup(seed: Uint8Array, password: string, accountId: string, nickname = '', profiles?: ProfileRegistry): Promise<string> {
  if (password.length < 8) throw new Error('backup_password_short');
  const snapshot = profiles === undefined ? undefined : profileRegistrySnapshot(profiles);
  const phrase = new TextDecoder('utf-8', { fatal: true }).decode(seed);
  if (!validateMnemonic(phrase, wordlist) || await idFor(phrase) !== accountId) throw new Error('backup_account_mismatch');
  const verifiedProfiles = snapshot ? await checkedProfiles(phrase, accountId, snapshot) : undefined;
  const version = verifiedProfiles ? 2 : 1;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = encoder.encode(JSON.stringify({ version, derivation: 'mesh/identity/v1',
    seed: phrase, accountId, nickname: cleanNickname(nickname), createdAt: new Date().toISOString(),
    ...(verifiedProfiles ? { profiles: verifiedProfiles } : {}) }));
  if (plaintext.length > (version === 1 ? 4080 : 66 * 1024 - 16)) { plaintext.fill(0); throw new Error('backup_too_large'); }
  const input = toBuffer(plaintext);
  try {
    const key = await keyFor(password, salt);
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: toBuffer(iv), additionalData: toBuffer(aadFor(version)), tagLength: 128 }, key, input);
    return JSON.stringify({ format: 'automesh-account-backup', version,
      kdf: 'PBKDF2-SHA256', iterations: ITERATIONS, encryption: 'AES-256-GCM',
      salt: encode(salt), iv: encode(iv), ciphertext: encode(new Uint8Array(cipher)) });
  } finally { plaintext.fill(0); new Uint8Array(input).fill(0); }
}

export async function openEncryptedBackup(serialized: string, password: string, expectedAccountId = ''): Promise<OpenedBackup> {
  if (encoder.encode(serialized).byteLength > MAX_BACKUP_BYTES) throw new Error('backup_too_large');
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(serialized); } catch { throw new Error('backup_invalid'); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.format !== 'automesh-account-backup' ||
      (raw.version !== 1 && raw.version !== 2) || raw.kdf !== 'PBKDF2-SHA256' || raw.iterations !== ITERATIONS || raw.encryption !== 'AES-256-GCM' ||
      Object.keys(raw).sort().join(',') !== 'ciphertext,encryption,format,iterations,iv,kdf,salt,version') throw new Error('backup_invalid');
  const version = raw.version;
  if (version === 1 && encoder.encode(serialized).byteLength > 16 * 1024) throw new Error('backup_too_large');
  const salt = decode(raw.salt, 16);
  const iv = decode(raw.iv, 12);
  const cipher = decode(raw.ciphertext);
  if (cipher.length < 17 || cipher.length > (version === 1 ? 4096 : 66 * 1024)) throw new Error('backup_invalid');
  let bytes: Uint8Array;
  try {
    const key = await keyFor(password, salt);
    bytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: toBuffer(iv), additionalData: toBuffer(aadFor(version)), tagLength: 128 }, key, toBuffer(cipher)));
  } catch { throw new Error('backup_cannot_decrypt'); }
  try {
    const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!payload || payload.version !== version || payload.derivation !== 'mesh/identity/v1' ||
        typeof payload.seed !== 'string' || payload.seed.length > 512 || !validateMnemonic(payload.seed, wordlist) ||
        typeof payload.accountId !== 'string' || await idFor(payload.seed) !== payload.accountId ||
        typeof payload.createdAt !== 'string' || !Number.isFinite(Date.parse(payload.createdAt))) throw new Error('backup_invalid');
    if (expectedAccountId && payload.accountId !== expectedAccountId) throw new Error('backup_wrong_account');
    if (Object.keys(payload).sort().join(',') !== (version === 1 ? 'accountId,createdAt,derivation,nickname,seed,version' : 'accountId,createdAt,derivation,nickname,profiles,seed,version')) throw new Error('backup_invalid');
    const profiles = version === 2 ? await checkedProfiles(payload.seed, payload.accountId, payload.profiles) : undefined;
    return { seed: encoder.encode(payload.seed), accountId: payload.accountId, nickname: cleanNickname(payload.nickname), ...(profiles ? { profiles } : {}) };
  } finally { bytes.fill(0); }
}

export function backupFileName(nickname = '', date = new Date()): string {
  const safe = nickname.normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '_')
    .trim().replace(/[. ]+$/g, '').slice(0, 40);
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return `Automesh${safe ? `-${safe}` : ''}-${day}.automesh`;
}
