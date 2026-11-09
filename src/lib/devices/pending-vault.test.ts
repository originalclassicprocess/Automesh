import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { createPendingDeviceVault, openPendingDeviceVault } from './pending-vault';
import { createPendingDeviceBrowser, clearPendingDeviceStorage, PENDING_DEVICE_DATABASE } from './pending-browser';
import { createIndexedDbCoreRecords, CORE_DATABASE_NAME } from '../core-storage/indexeddb';
import type { CoreRecordStore, SealedCoreRecord } from '../core/durable-state';
import { createDeviceProof, approveDeviceRequest, verifyDeviceProof } from './enrollment';
import { WebCryptoIdentity } from '../identity/webcrypto';
import { accountIdFromPublicKey } from '../addressing/account-id.js';
import { MemoryReplayStore, type CoreEnvironment } from '../core/ports';
import { beginStorageReset } from '../application/storage-reset';
import { createDeviceInvitation } from './links';

const PASSWORD = 'Only-public-test-password-2026';
let factory: IDBFactory, environment: CoreEnvironment, now: number;
let records: Map<string, SealedCoreRecord>, driver: CoreRecordStore;
const guard = () => {};
beforeEach(() => {
  now = 1800000000000; factory = new IDBFactory(); records = new Map();
  environment = { subtle: crypto.subtle, now: () => now, newId: () => crypto.randomUUID() };
  driver = { async read(scope) { const value = records.get(scope); return value && structuredClone(value); },
    async compareAndSwap(scope, revision, next) {
      if ((records.get(scope)?.revision ?? null) !== revision) return false;
      records.set(scope, structuredClone(next)); return true;
    } };
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value) });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const options = () => ({ records: driver, environment, guard });
const browser = (extra = {}) => createPendingDeviceBrowser({ trusted: true, factory, environment, isCurrent: () => true, ...extra });

describe('independent pending device vault (not live enrollment)', () => {
  it('resumes an encrypted pinned invitation without typing the owner/node again, and rejects owner replacement', async () => {
    const owner = new WebCryptoIdentity(), attacker = new WebCryptoIdentity(); await owner.create(); await attacker.create();
    const authority = { url: 'https://node.example.test', nodeId: 'a'.repeat(32), publicKey: '04' + 'b'.repeat(128) };
    let first = await createPendingDeviceVault('Pending browser', PASSWORD, options()); const id = first.deviceId;
    try {
      const invitation = await createDeviceInvitation(authority, 'Private nickname', owner, environment);
      await first.setInvitation(invitation);
      expect(new TextDecoder().decode(new Uint8Array(records.get(id)!.cipher))).not.toContain('Private nickname');
      first.close(); first = await openPendingDeviceVault(id, PASSWORD, options());
      expect(first.invitation).toEqual(invitation);
      await expect(first.setInvitation(await createDeviceInvitation(authority, 'Other', attacker, environment))).rejects.toThrow('owner_mismatch');
      await expect(first.setInvitation(await createDeviceInvitation({ ...authority, nodeId: 'c'.repeat(32) }, 'Same owner', owner, environment))).rejects.toThrow('migration');
      expect(first.invitation).toEqual(invitation);
    } finally { first.close(); owner.dispose(); attacker.dispose(); }
  });
  it('persists an independent device signer and exact request across reload, with no owner seed input', async () => {
    const first = await createPendingDeviceVault('My computer', PASSWORD, options());
    const request = first.request, id = first.deviceId, data = new TextEncoder().encode('proof');
    expect(JSON.stringify(request)).not.toMatch(/deviceKey|mnemonic|seed|password|privateKey/);
    expect(new TextDecoder().decode(new Uint8Array(records.get(id)!.cipher))).not.toContain('My computer');
    expect(records.get(id)!.revision).toBe(1); first.close();
    await expect(first.signer.sign(data)).rejects.toThrow('closed');
    const reopened = await openPendingDeviceVault(id, PASSWORD, options());
    try {
      expect(reopened.request).toEqual(request); expect(reopened.expired).toBe(false);
      const signature = await reopened.signer.sign(data);
      expect(await reopened.signer.verify(data, signature)).toBe(true);
      await expect(reopened.signer.create()).rejects.toThrow();
      await expect(reopened.signer.fromSeed(new Uint8Array(32))).rejects.toThrow();
      const copied = reopened.request; (copied.record.body as Record<string, unknown>).label = 'Changed';
      expect(reopened.request).toEqual(request);
    } finally { reopened.close(); }
  });
  it('proves possession after reopening without ever sending the account recovery secret to the new device', async () => {
    const vault = await createPendingDeviceVault('Second device', PASSWORD, options());
    const request = vault.request, id = vault.deviceId; vault.close();
    const owner = new WebCryptoIdentity(); await owner.create();
    const ownerId = await accountIdFromPublicKey(await owner.getPublicKeyBytes());
    const grant = await approveDeviceRequest(request, owner, { owner: ownerId, epoch: 0, expiresAt: now + 60000, approved: true },
      environment, new MemoryReplayStore());
    const reopened = await openPendingDeviceVault(id, PASSWORD, options());
    try {
      expect(id).not.toBe(ownerId);
      const proof = await createDeviceProof(grant, reopened.signer, ownerId, 'a'.repeat(64), environment);
      await verifyDeviceProof(proof, grant, { owner: ownerId, device: id, epoch: 0, isRevoked: async () => false,
        recipient: ownerId, challenge: 'a'.repeat(64) }, environment, new MemoryReplayStore());
    } finally { reopened.close(); owner.dispose(); }
  });
  it('rejects wrong passwords and ciphertext, salt, IV, scope or revision substitution', async () => {
    const vault = await createPendingDeviceVault('Phone', PASSWORD, options());
    const id = vault.deviceId, original = structuredClone(records.get(id)!); vault.close();
    await expect(openPendingDeviceVault(id, 'Different-test-password', options())).rejects.toThrow('password_or_corrupt');
    for (const field of ['cipher', 'salt', 'iv', 'revision']) {
      const changed = structuredClone(original);
      if (field === 'revision') changed.revision++;
      else if (field === 'iv') changed.iv[0] ^= 1;
      else new Uint8Array(changed.cipher)[field === 'salt' ? 0 : 24] ^= 1;
      records.set(id, changed);
      await expect(openPendingDeviceVault(id, PASSWORD, options())).rejects.toThrow('password_or_corrupt');
    }
    const other = await createPendingDeviceVault('Other phone', PASSWORD, options());
    records.set(other.deviceId, original);
    await expect(openPendingDeviceVault(other.deviceId, PASSWORD, options())).rejects.toThrow('password_or_corrupt');
    other.close();
  });
  it('preserves an expired request for inspection but never makes it valid again by reload', async () => {
    const vault = await createPendingDeviceVault('Phone', PASSWORD, options());
    const id = vault.deviceId; vault.close(); now += 11 * 60000;
    const reopened = await openPendingDeviceVault(id, PASSWORD, options());
    const owner = new WebCryptoIdentity(); await owner.create();
    try {
      expect(reopened.expired).toBe(true);
      const ownerId = await accountIdFromPublicKey(await owner.getPublicKeyBytes());
      await expect(approveDeviceRequest(reopened.request, owner, { owner: ownerId, epoch: 0, expiresAt: now + 1000, approved: true },
        environment, new MemoryReplayStore())).rejects.toThrow();
    } finally { reopened.close(); owner.dispose(); }
  });
  it('cancels locally with an encrypted tombstone, refuses stale cancellation and reopening', async () => {
    const first = await createPendingDeviceVault('Phone', PASSWORD, options());
    const stale = await openPendingDeviceVault(first.deviceId, PASSWORD, options());
    await first.cancel(); expect(records.get(first.deviceId)!.revision).toBe(2);
    await expect(openPendingDeviceVault(first.deviceId, PASSWORD, options())).rejects.toThrow('cancelled');
    await expect(stale.cancel()).rejects.toThrow('conflict');
    await expect(stale.signer.sign(new Uint8Array(1))).rejects.toThrow('closed');
  });
  it('refuses unsafe passwords, missing storage, oversized/corrupt records and lost initialize races', async () => {
    await expect(createPendingDeviceVault('Phone', 'short', options())).rejects.toThrow('password_policy');
    const vault = await createPendingDeviceVault('Phone', PASSWORD, options()); vault.close();
    const record = records.get(vault.deviceId)!; record.cipher = new ArrayBuffer(65537);
    await expect(openPendingDeviceVault(vault.deviceId, PASSWORD, options())).rejects.toThrow('invalid');
    records.clear(); await expect(openPendingDeviceVault(vault.deviceId, PASSWORD, options())).rejects.toThrow('missing');
    await expect(createPendingDeviceVault('Phone', PASSWORD, { ...options(), records: { ...driver, compareAndSwap: async () => false } })).rejects.toThrow('conflict');
  });
  it('fails closed if the session is locked while key derivation is in flight', async () => {
    let current = true, release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => release = resolve), started = new Promise<void>(resolve => entered = resolve);
    const derive = crypto.subtle.deriveKey.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, 'deriveKey').mockImplementation(async (...args) => { entered(); await gate; return derive(...args); });
    const pending = createPendingDeviceVault('Phone', PASSWORD, { ...options(), guard: () => { if (!current) throw new Error('locked'); } });
    const denied = expect(pending).rejects.toThrow('locked');
    await started; current = false; release(); await denied; expect(records.size).toBe(0);
  });
  it('does not return a signer if cancellation wins while reopening is deriving its key', async () => {
    const vault = await createPendingDeviceVault('Phone', PASSWORD, options());
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => release = resolve), started = new Promise<void>(resolve => entered = resolve);
    const derive = crypto.subtle.deriveKey.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, 'deriveKey').mockImplementation(async (...args) => { entered(); await gate; return derive(...args); });
    const reopening = openPendingDeviceVault(vault.deviceId, PASSWORD, options());
    const denied = expect(reopening).rejects.toThrow('conflict');
    await started; await vault.cancel(); release(); await denied;
    expect(records.get(vault.deviceId)!.revision).toBe(2);
  });
  it('closes the signer if a lock happens while a signature is in flight', async () => {
    const vault = await createPendingDeviceVault('Phone', PASSWORD, options());
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => release = resolve), started = new Promise<void>(resolve => entered = resolve);
    const sign = crypto.subtle.sign.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, 'sign').mockImplementation(async (...args) => { entered(); await gate; return sign(...args); });
    const pending = vault.signer.sign(new Uint8Array([1]));
    const denied = expect(pending).rejects.toThrow();
    await started; vault.close(); release(); await denied;
  });
});

describe('isolated browser pending-device storage', () => {
  it('survives adapter reload in a separate database and never writes root/core storage', async () => {
    const first = browser(), vault = await first.create('Test computer', PASSWORD), request = vault.request;
    const id = vault.deviceId; first.close();
    const second = browser(), reopened = await second.open(id, PASSWORD);
    expect(reopened.request).toEqual(request); second.close();
    expect(await createIndexedDbCoreRecords(factory, guard).read(id)).toBeUndefined();
    expect((await factory.databases()).map(db => db.name)).toContain(PENDING_DEVICE_DATABASE);
    expect(CORE_DATABASE_NAME).not.toBe(PENDING_DEVICE_DATABASE);
  });
  it('requires a trusted current session and closes all device signers on lock', async () => {
    expect(() => browser({ trusted: false })).toThrow('trusted');
    expect(() => browser({ factory: undefined })).toThrow('unavailable');
    const host = browser(), vault = await host.create('Phone', PASSWORD); host.close();
    await expect(vault.signer.sign(new Uint8Array(1))).rejects.toThrow('closed');
    await expect(host.open(vault.deviceId, PASSWORD)).rejects.toThrow();
  });
  it('treats a quota failure or transaction abort as failure, never success', async () => {
    const host = browser();
    const original = IDBObjectStore.prototype.put;
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError'); });
    await expect(host.create('Phone', PASSWORD)).rejects.toThrow('quota'); put.mockRestore();
    const abort = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(this: IDBObjectStore, ...args: Parameters<typeof original>) {
      const request = original.apply(this, args); request.addEventListener('success', () => this.transaction.abort()); return request;
    });
    await expect(host.create('Phone', PASSWORD)).rejects.toThrow(); abort.mockRestore(); host.close();
    const raw = factory.open(PENDING_DEVICE_DATABASE, 1);
    await new Promise<void>((resolve, reject) => { raw.onerror = () => reject(raw.error); raw.onsuccess = () => resolve(); });
    const db = raw.result, count = db.transaction('profiles').objectStore('profiles').count();
    const total = await new Promise<number>((resolve, reject) => { count.onerror = () => reject(count.error); count.onsuccess = () => resolve(count.result); });
    expect(total).toBe(0); db.close();
  });
  it('does not recreate device keys after global reset or use a stale browser session', async () => {
    const host = browser(), vault = await host.create('Phone', PASSWORD), id = vault.deviceId;
    beginStorageReset(); await clearPendingDeviceStorage(factory);
    await expect(vault.signer.sign(new Uint8Array(1))).rejects.toThrow('storage_reset');
    await expect(host.create('Phone', PASSWORD)).rejects.toThrow('storage_reset'); host.close();
    const next = browser(); await expect(next.open(id, PASSWORD)).rejects.toThrow('missing'); next.close();
  });
  it('checks the session inside the actual IDB write transaction', async () => {
    let current = true;
    const original = IDBObjectStore.prototype.get;
    const read = vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function(this: IDBObjectStore, ...args: Parameters<typeof original>) {
      const request = original.apply(this, args);
      request.addEventListener('success', () => { current = false; }); return request;
    });
    const host = browser({ isCurrent: () => current });
    await expect(host.create('Phone', PASSWORD)).rejects.toThrow('session_changed');
    read.mockRestore(); host.close();
  });
});
