import { requireStorageEpoch, storageEpoch } from '$lib/application/storage-reset';
import { passwordPolicyError } from './password-policy';
const encoder = new TextEncoder();
let volatileVault: string | null = null;
let revision = 0;
const MAX_VAULT_CHARS = 64 * 1024;
const MAX_PLAINTEXT_BYTES = 8 * 1024;
const aadFor = (version: 2 | 3) => encoder.encode(`Automesh local vault v${version}:PBKDF2-SHA256-${version === 3 ? 600000 : 300000}:AES-256-GCM`);

function snapshot() {
  return { revision, volatileVault, persistent: localStorage.getItem('vault'), epoch: storageEpoch() };
}
function isCurrent(state: ReturnType<typeof snapshot>): boolean {
  return state.revision === revision && state.volatileVault === volatileVault &&
    state.persistent === localStorage.getItem('vault');
}
function requireCurrent(state: ReturnType<typeof snapshot>): void {
  requireStorageEpoch(state.epoch);
  if (!isCurrent(state)) throw new Error('vault_changed_during_operation');
}
function validBytes(value: unknown, min: number, max = min): value is number[] {
  return Array.isArray(value) && value.length >= min && value.length <= max &&
    value.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255);
}

function toBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength
  ) as ArrayBuffer;
}

function getRandomBytes(length: number) {

  const arr = new Uint8Array(length);

  crypto.getRandomValues(arr);

  return arr;
}

async function deriveKey(
  pin: string,
  salt: Uint8Array,
  iterations: 300000 | 600000 = 600000
) {

  const passwordBytes = encoder.encode(pin);
  const passwordBuffer = toBuffer(passwordBytes);
  try {
    const keyMaterial =
      await crypto.subtle.importKey(
        'raw',
        passwordBuffer,
        { name: 'PBKDF2' },
        false,
        ['deriveKey']
      );

    return await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: toBuffer(salt),
        iterations,
        hash: 'SHA-256'
      },
      keyMaterial,
      {
        name: 'AES-GCM',
        length: 256
      },
      false,
      ['encrypt', 'decrypt']
    );
  } finally { passwordBytes.fill(0); new Uint8Array(passwordBuffer).fill(0); }
}

export async function saveVault(
  mnemonic: Uint8Array,
  pin: string,
  metadata?: unknown,
  trusted = true
) {
  if (!mnemonic.length || mnemonic.length > 512) throw new Error('invalid_vault_seed_size');
  const state = snapshot();
  const plaintext = encoder.encode(JSON.stringify({ mnemonic: Array.from(mnemonic), metadata: metadata ?? null }));
  if (plaintext.length > MAX_PLAINTEXT_BYTES) { plaintext.fill(0); throw new Error('vault_too_large'); }
  const input = toBuffer(plaintext);
  try {
    const salt = getRandomBytes(16);

    const iv = getRandomBytes(12);

    const key =
      await deriveKey(pin, salt);

    const cipher =
      await crypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv: toBuffer(iv),
          additionalData: toBuffer(aadFor(3))
        },
        key,
        input
      );

    const data = {
      version: 3,

      cipher:
        Array.from(
          new Uint8Array(cipher)
        ),

      iv: Array.from(iv),

      salt: Array.from(salt)
    };

    const serialized = JSON.stringify(data);
    requireCurrent(state);
    if (trusted) {
      localStorage.setItem('vault', serialized);
      volatileVault = null;
    } else {
      volatileVault = serialized;
      localStorage.removeItem('vault');
    }
    sessionStorage.removeItem('vault');
    if (trusted) localStorage.setItem('trustedDevice', 'true');
    else localStorage.removeItem('trustedDevice');
    revision++;
  } finally { plaintext.fill(0); new Uint8Array(input).fill(0); }
}

export function hasVault(): boolean {
  return Boolean(volatileVault || localStorage.getItem('vault'));
}

export function discardTransientVaultOnStartup(): void {
  // sessionStorage may survive browser session restore after a crash. A new
  // page runtime must not reopen an untrusted session without the seed.
  volatileVault = null;
  revision++;
  sessionStorage.removeItem('vault');
}

export function isTrustedDevice(): boolean {
  // Vaults created before this setting existed were always stored persistently.
  return Boolean(localStorage.getItem('vault')) && localStorage.getItem('trustedDevice') !== 'false';
}

export function setVaultPersistence(trusted: boolean): void {
  const raw = volatileVault ?? localStorage.getItem('vault');
  if (!raw) throw new Error('vault_not_found');
  if (trusted) {
    localStorage.setItem('vault', raw);
    volatileVault = null;
    localStorage.setItem('trustedDevice', 'true');
  } else {
    volatileVault = raw;
    localStorage.removeItem('vault');
    localStorage.removeItem('trustedDevice');
  }
  sessionStorage.removeItem('vault');
  revision++;
}

export async function changeVaultPassword(oldPassword: string, newPassword: string, trusted: boolean): Promise<boolean> {
  const error = passwordPolicyError(newPassword);
  if (error) throw new Error(error);
  const state = snapshot();
  const existing = await loadVault(oldPassword);
  if (!existing) return false;
  try {
    requireCurrent(state);
    await saveVault(existing.mnemonic, newPassword, existing.metadata, trusted);
    return true;
  } finally {
    existing.mnemonic.fill(0);
  }
}

export async function loadVault(
  pin: string
): Promise<{
  mnemonic: Uint8Array;
  metadata: unknown;
  legacy?: boolean;
} | null> {

  const state = snapshot();
  const raw = state.volatileVault ?? state.persistent;

  if (!raw) {
    return null;
  }

  let decrypted: Uint8Array | undefined;
  try {
    if (raw.length > MAX_VAULT_CHARS) return null;
    const data = JSON.parse(raw);
    if (!data || (data.version !== 1 && data.version !== 2 && data.version !== 3) ||
        !validBytes(data.salt, 16) || !validBytes(data.iv, 12) ||
        !validBytes(data.cipher, 17, data.version === 1 ? 528 : MAX_PLAINTEXT_BYTES + 16)) return null;

    const salt =
      new Uint8Array(data.salt);

    const iv =
      new Uint8Array(data.iv);

    const cipher =
      new Uint8Array(data.cipher);

    const key =
      await deriveKey(pin, salt, data.version === 3 ? 600000 : 300000);

    decrypted = new Uint8Array(await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: toBuffer(iv),
          ...(data.version !== 1 ? { additionalData: toBuffer(aadFor(data.version)) } : {})
        },
        key,
        toBuffer(cipher)
      ));
    requireCurrent(state);
    // Old vaults remain readable; the unlock workflow rewrites only after
    // successful authentication. KDF cost is fixed by version, never by input.
    if (data.version === 1) return { mnemonic: decrypted.slice(), metadata: data.metadata ?? null, legacy: true };
    const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decrypted));
    if (!payload || !validBytes(payload.mnemonic, 1, 512)) return null;
    return { mnemonic: new Uint8Array(payload.mnemonic), metadata: payload.metadata ?? null, ...(data.version === 2 ? { legacy: true } : {}) };

  } catch {

    return null;
  } finally { decrypted?.fill(0); }
}

export function clearVault() {
  revision++;
  volatileVault = null;
  localStorage.removeItem('vault');
  sessionStorage.removeItem('vault');
  localStorage.removeItem('trustedDevice');
}
