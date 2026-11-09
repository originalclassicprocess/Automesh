// Independent local DEVICE key and owner-signed binding, never an account
// mnemonic/root. Used by the separate linked-device login/workspace.
import { WebCryptoIdentity } from '../identity/webcrypto';
import type { IdentityProvider } from '../identity/identity';
import { accountIdFromPublicKey } from '../addressing/account-id.js';
import { isValidAccountId } from '../addressing/bech32m.js';
import { canonicalJson } from '../core/canonical';
import type { SignedObject } from '../core/objects';
import { checkedTime, type CoreEnvironment } from '../core/ports';
import { validateSealedCoreRecord, type CoreRecordStore, type SealedCoreRecord } from '../core/durable-state';
import { passwordPolicyError } from '../vault/password-policy';
import { createDeviceRequestForSigner, verifyDeviceRequest } from './enrollment';
import { deviceComparisonCode } from './enrollment';
import { verifyDeviceApproval, type DeviceApproval } from './approval';
import { verifyDeviceInvitation } from './links';
import { requireDeviceAuthority } from './startup';

const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
const MAX_BYTES = 64 * 1024, ITERATIONS = 600000;
const buffer = (value: Uint8Array) => new Uint8Array(value).buffer as ArrayBuffer;
const hex = (value: Uint8Array) => [...value].map(b => b.toString(16).padStart(2, '0')).join('');
const unhex = (value: string) => Uint8Array.from(value.match(/../g)!, pair => parseInt(pair, 16));
const deny = (): never => { throw new Error('device_vault_invalid'); };
const exact = (value: object, keys: string[]) => Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
type DeviceState = { schema: 1; status: 'pending' | 'linked'; deviceKey: string; request: SignedObject; approval?: DeviceApproval; invitation?: SignedObject };
type State = DeviceState |
  { schema: 1; status: 'cancelled' };
type Options = { records: CoreRecordStore; environment: CoreEnvironment; guard(): void };
export type PendingDeviceVault = {
  readonly storageKey: CryptoKey;
  readonly deviceId: string;
  readonly request: SignedObject;
  readonly expired: boolean;
  readonly signer: IdentityProvider;
  readonly owner: string | null;
  readonly approval: DeviceApproval | null;
  readonly invitation: SignedObject | null;
  setInvitation(value: unknown): Promise<void>;
  link(approval: unknown, expectedOwner: string, comparisonCode: string): Promise<void>;
  cancel(): Promise<void>;
  close(): void;
};

function aad(deviceId: string, revision: number) {
  return encoder.encode(JSON.stringify(['Automesh pending device vault prototype v1', deviceId, revision,
    'PBKDF2-SHA256-600000', 'AES-256-GCM']));
}
function passwordInput(password: string) {
  if (typeof password !== 'string' || password.length > 512 || passwordPolicyError(password))
    throw new Error('device_vault_password_policy');
}
async function passwordKey(password: string, salt: Uint8Array, environment: CoreEnvironment) {
  passwordInput(password); const bytes = encoder.encode(password);
  try {
    const material = await environment.subtle.importKey('raw', buffer(bytes), 'PBKDF2', false, ['deriveKey']);
    return await environment.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt: buffer(salt) },
      material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  } finally { bytes.fill(0); }
}
async function seal(state: State, deviceId: string, revision: number, key: CryptoKey, salt: Uint8Array, options: Options) {
  options.guard(); const plain = encoder.encode(canonicalJson(state));
  if (plain.length > MAX_BYTES - 32) { plain.fill(0); deny(); }
  try {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = new Uint8Array(await options.environment.subtle.encrypt({ name: 'AES-GCM', iv,
      additionalData: aad(deviceId, revision) }, key, plain));
    options.guard(); const cipher = new Uint8Array(16 + encrypted.length);
    cipher.set(salt); cipher.set(encrypted, 16);
    return { schema: 1 as const, revision, iv, cipher: cipher.buffer };
  } finally { plain.fill(0); }
}
function snapshot(record: SealedCoreRecord): SealedCoreRecord {
  validateSealedCoreRecord(record);
  if (record.cipher.byteLength < 32 || record.cipher.byteLength > MAX_BYTES) deny();
  return { schema: 1, revision: record.revision, iv: new Uint8Array(record.iv), cipher: record.cipher.slice(0) };
}
async function validateState(value: unknown, deviceId: string, options: Options): Promise<State> {
  const state = value as State;
  if (!state || typeof state !== 'object' || state.schema !== 1) deny();
  if (state.status === 'cancelled' && exact(state, ['schema', 'status'])) return state;
  if ((state.status !== 'pending' && state.status !== 'linked') || !exact(state, [...(state.status === 'linked'
    ? ['schema', 'status', 'deviceKey', 'request', 'approval'] : ['schema', 'status', 'deviceKey', 'request']), ...(state.invitation ? ['invitation'] : [])]) ||
    typeof state.deviceKey !== 'string' || !/^[a-f0-9]{64}$/.test(state.deviceKey)) return deny();
  // Validate an expired saved request cryptographically at its issuance time.
  // Actual approval ALWAYS uses the real current clock in enrollment.ts.
  const issued = state.request?.record?.createdAt;
  if (!Number.isSafeInteger(issued) || issued < 0 || issued > checkedTime(options.environment.now)) deny();
  const request = await verifyDeviceRequest(state.request, { ...options.environment, now: () => issued });
  if (request.record.author !== deviceId) deny();
  if (state.invitation) {
    const at = state.invitation.record?.createdAt;
    if (!Number.isSafeInteger(at) || at > checkedTime(options.environment.now)) deny();
    const context = await verifyDeviceInvitation(state.invitation, { ...options.environment, now: () => at });
    if (state.approval && state.approval.certificate.record.author !== context.owner) deny();
  }
  if (state.status === 'linked') {
    const approval = state.approval, at = approval?.membership?.record?.createdAt;
    if (!approval || !Number.isSafeInteger(at) || at! > checkedTime(options.environment.now)) return deny();
    const historical = { ...options.environment, now: () => at! };
    const owner = approval.certificate.record.author;
    await verifyDeviceApproval(approval, request, owner, await deviceComparisonCode(owner, request,
      { ...options.environment, now: () => issued }), historical);
  }
  return { ...state, request };
}
async function session(deviceId: string, state: DeviceState, signer: WebCryptoIdentity,
  revision: number, salt: Uint8Array, initialKey: CryptoKey, options: Options): Promise<PendingDeviceVault> {
  const secret = unhex(state.deviceKey);
  let storageKey: CryptoKey;
  try {
    const material = await options.environment.subtle.importKey('raw', buffer(secret), 'HKDF', false, ['deriveKey']);
    storageKey = await options.environment.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256',
      salt: encoder.encode('Automesh independent device storage v2'), info: encoder.encode(deviceId) },
      material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); options.guard();
  } finally { secret.fill(0); }
  let key: CryptoKey | null = initialKey, busy = false;
  let currentRevision = revision;
  const close = () => { key = null; signer.dispose(); };
  const guard = () => {
    if (!key) throw new Error('device_vault_closed');
    try { options.guard(); } catch (error) { close(); throw error; }
  };
  // The handle has no fromSeed/create escape hatch and checks session lifetime
  // after asynchronous signing. Callers cannot repurpose the persisted key.
  const deviceSigner: IdentityProvider = Object.freeze({
    create: async () => deny(), fromSeed: async () => deny(),
    async sign(bytes: Uint8Array) { guard(); const result = await signer.sign(bytes); guard(); return result; },
    async verify(bytes: Uint8Array, signature: Uint8Array) { guard(); const result = await signer.verify(bytes, signature); guard(); return result; },
    async getPublicKeyBytes() { guard(); const result = await signer.getPublicKeyBytes(); guard(); return result; },
    dispose: close
  });
  // Do not retain the raw scalar or mutable signed request in the handle.
  const requestJson = canonicalJson(state.request); state.deviceKey = '';
  return Object.freeze({ deviceId, get storageKey() { guard(); return storageKey; }, get request() { guard(); return JSON.parse(requestJson) as SignedObject; },
    get expired() { guard(); return state.request.record.expiresAt! <= checkedTime(options.environment.now); },
    signer: deviceSigner, close,
    get owner() { guard(); return state.approval?.certificate.record.author ?? null; },
    get approval() { guard(); return state.approval ? JSON.parse(canonicalJson(state.approval)) as DeviceApproval : null; },
    get invitation() { guard(); return state.invitation ? JSON.parse(canonicalJson(state.invitation)) as SignedObject : null; },
    async setInvitation(value: unknown) {
      guard(); if (busy || state.status === 'linked') throw new Error('device_vault_busy'); busy = true;
      let plaintext: Uint8Array | undefined, decoded: DeviceState | undefined;
      try {
        const captured = JSON.parse(canonicalJson(value)) as SignedObject;
        const context = await verifyDeviceInvitation(captured, options.environment); guard();
        const saved = await options.records.read(deviceId); guard();
        if (!saved || saved.revision !== currentRevision) throw new Error('device_vault_conflict');
        const record = snapshot(saved), cipher = new Uint8Array(record.cipher);
        plaintext = new Uint8Array(await options.environment.subtle.decrypt({ name: 'AES-GCM', iv: buffer(record.iv),
          additionalData: aad(deviceId, record.revision) }, key!, buffer(cipher.subarray(16)))); guard();
        const loaded = await validateState(JSON.parse(decoder.decode(plaintext)), deviceId, options); guard();
        if (loaded.status !== 'pending') throw new Error('device_vault_busy'); decoded = loaded;
        if (loaded.invitation) {
          const prior = await verifyDeviceInvitation(loaded.invitation, { ...options.environment, now: () => loaded.invitation!.record.createdAt });
          if (prior.owner !== context.owner) throw new Error('device_owner_mismatch');
          if (prior.authority) { if (!context.authority) throw new Error('device_directory_migration_required'); requireDeviceAuthority(prior.authority, context.authority); }
        }
        decoded.invitation = captured;
        const next = await seal(decoded, deviceId, currentRevision + 1, key!, salt, { ...options, guard }); guard();
        if (!await options.records.compareAndSwap(deviceId, currentRevision, next)) throw new Error('device_vault_conflict');
        guard(); currentRevision++; state.invitation = captured;
      } finally { plaintext?.fill(0); if (decoded) decoded.deviceKey = ''; busy = false; }
    },
    async link(value: unknown, expectedOwner: string, comparisonCode: string) {
      guard(); if (busy) throw new Error('device_vault_busy'); busy = true;
      let plaintext: Uint8Array | undefined, decoded: DeviceState | undefined;
      try {
        const approval = await verifyDeviceApproval(value, JSON.parse(requestJson), expectedOwner, comparisonCode, options.environment); guard();
        const saved = await options.records.read(deviceId); guard();
        if (!saved || saved.revision !== currentRevision) throw new Error('device_vault_conflict');
        const record = snapshot(saved), cipher = new Uint8Array(record.cipher);
        plaintext = new Uint8Array(await options.environment.subtle.decrypt({ name: 'AES-GCM', iv: buffer(record.iv),
          additionalData: aad(deviceId, record.revision) }, key!, buffer(cipher.subarray(16)))); guard();
        const loaded = await validateState(JSON.parse(decoder.decode(plaintext)), deviceId, options); guard();
        if (loaded.status === 'cancelled') throw new Error('device_vault_cancelled'); decoded = loaded;
        if (loaded.invitation) {
          const context = await verifyDeviceInvitation(loaded.invitation, { ...options.environment, now: () => loaded.invitation!.record.createdAt });
          if (context.owner !== expectedOwner) throw new Error('device_owner_mismatch');
          const directory = (approval.membership.record.body as unknown as { directory?: import('./membership').DirectoryAuthority }).directory;
          if (context.authority) { if (!directory) throw new Error('device_directory_migration_required'); requireDeviceAuthority(context.authority, directory); }
        }
        if (decoded.status === 'linked' && canonicalJson(decoded.approval) !== canonicalJson(approval)) throw new Error('device_vault_already_linked');
        // The signed approval now contains the owner/node binding. Do not keep
        // a pending-only extension in linked records: older clients can still
        // read their established vault after an application rollback.
        decoded.status = 'linked'; decoded.approval = approval; delete decoded.invitation;
        const next = await seal(decoded, deviceId, currentRevision + 1, key!, salt, { ...options, guard }); guard();
        if (!await options.records.compareAndSwap(deviceId, currentRevision, next)) throw new Error('device_vault_conflict');
        guard(); currentRevision++; state.status = 'linked'; state.approval = approval; delete state.invitation;
      } finally { plaintext?.fill(0); if (decoded) decoded.deviceKey = ''; busy = false; }
    },
    async cancel() {
      if (state.status === 'linked') throw new Error('device_remote_revocation_required');
      guard(); if (busy) throw new Error('device_vault_busy'); busy = true;
      try {
        const next = await seal({ schema: 1, status: 'cancelled' }, deviceId, currentRevision + 1, key!, salt,
          { ...options, guard });
        guard(); if (!await options.records.compareAndSwap(deviceId, currentRevision, next)) throw new Error('device_vault_conflict');
        guard();
      } finally { close(); }
    }
  });
}

export async function createPendingDeviceVault(label: string, password: string, options: Options): Promise<PendingDeviceVault> {
  options = { ...options, environment: { ...options.environment } };
  passwordInput(password); options.guard();
  const signer = new WebCryptoIdentity(), scalar = crypto.getRandomValues(new Uint8Array(32));
  try {
    await signer.fromSeed(scalar); options.guard();
    const request = await createDeviceRequestForSigner(label, signer, options.environment); options.guard();
    const deviceId = request.record.author, salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await passwordKey(password, salt, options.environment); options.guard();
    const state: DeviceState = { schema: 1, status: 'pending', deviceKey: hex(scalar), request };
    const next = await seal(state, deviceId, 1, key, salt, options); options.guard();
    if (!await options.records.compareAndSwap(deviceId, null, next)) throw new Error('device_vault_conflict');
    options.guard(); return await session(deviceId, state, signer, 1, salt, key, options);
  } catch (error) { signer.dispose(); throw error; }
  finally { scalar.fill(0); }
}

export async function openPendingDeviceVault(deviceId: string, password: string, options: Options): Promise<PendingDeviceVault> {
  options = { ...options, environment: { ...options.environment } };
  if (!isValidAccountId(deviceId)) deny();
  passwordInput(password); options.guard();
  const saved = await options.records.read(deviceId); options.guard();
  if (!saved) throw new Error('device_vault_missing');
  const record = snapshot(saved), cipher = new Uint8Array(record.cipher), salt = cipher.slice(0, 16);
  const key = await passwordKey(password, salt, options.environment); options.guard();
  let plain: Uint8Array;
  try {
    plain = new Uint8Array(await options.environment.subtle.decrypt({ name: 'AES-GCM', iv: buffer(record.iv),
      additionalData: aad(deviceId, record.revision) }, key, buffer(cipher.subarray(16))));
  } catch { throw new Error('device_vault_password_or_corrupt'); }
  let state: State;
  try { options.guard(); state = await validateState(JSON.parse(decoder.decode(plain)), deviceId, options); options.guard(); }
  finally { plain.fill(0); }
  if (state.status === 'cancelled') throw new Error('device_vault_cancelled');
  const scalar = unhex(state.deviceKey), signer = new WebCryptoIdentity();
  try {
    await signer.fromSeed(scalar); options.guard();
    if (await accountIdFromPublicKey(await signer.getPublicKeyBytes(), options.environment.subtle) !== deviceId) deny();
    // Do not expose a signer from a record cancelled/replaced during slow KDF.
    const current = await options.records.read(deviceId); options.guard();
    if (!current || canonicalRecord(snapshot(current)) !== canonicalRecord(record)) throw new Error('device_vault_conflict');
    options.guard(); return await session(deviceId, state, signer, record.revision, salt, key, options);
  } catch (error) { signer.dispose(); throw error; }
  finally { scalar.fill(0); state.deviceKey = ''; }
}

function canonicalRecord(record: SealedCoreRecord) {
  return `${record.revision}:${hex(record.iv)}:${hex(new Uint8Array(record.cipher))}`;
}
