import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { createBrowserCoreState } from './browser';
import { deriveCoreStorageKey } from './key';
import { clearAllCoreStorage, createIndexedDbCoreRecords } from './indexeddb';
import { beginStorageReset, storageEpoch, requireStorageEpoch } from '../application/storage-reset';
import { WebCryptoIdentity } from '../identity/webcrypto';
import { accountIdFromPublicKey } from '../addressing/account-id.js';
import { createCore, type SealedCoreRecord } from '../core';

const NOW = 1_800_000_000_000;
let bobId: string, aliceId: string, key: CryptoKey, seed: Uint8Array, factory: IDBFactory;
beforeAll(async () => {
  const alice = new WebCryptoIdentity(), bob = new WebCryptoIdentity();
  seed = new Uint8Array(32); seed[31] = 1; await alice.fromSeed(seed);
  aliceId = await accountIdFromPublicKey(await alice.getPublicKeyBytes());
  seed[31] = 2; await bob.fromSeed(seed); bobId = await accountIdFromPublicKey(await bob.getPublicKeyBytes());
  key = await deriveCoreStorageKey(seed, bobId);
});
beforeEach(() => {
  factory = new IDBFactory(); const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => { values.set(k, v); } });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const open = (accountId = bobId) => createBrowserCoreState({ accountId, key, trusted: true, factory,
  environment: { subtle: crypto.subtle, now: () => NOW, newId: () => crypto.randomUUID() } });
const entry = (revision = 1): SealedCoreRecord => ({ schema: 1, revision, iv: new Uint8Array(12), cipher: new ArrayBuffer(16) });

describe('IndexedDB core adapter', () => {
  it('persists claims and policies across closing/reopening independent adapters', async () => {
    const first = open();
    await first.replayStore.claim('a', NOW + 60_000, NOW);
    await first.policyStore.initialize({ issuer: aliceId, recipient: bobId, resource: 'document:123', epoch: 1, validUntil: NOW + 60_000 });
    await first.policyStore.apply({ issuer: aliceId, recipient: bobId, resource: 'document:123', epoch: 2, validUntil: NOW + 60_000, sequence: 1, revoked: [] });
    first.close();
    const reopened = open();
    expect(await reopened.replayStore.claim('a', NOW + 60_000, NOW)).toBe(false);
    expect(await reopened.policyStore.read(aliceId, 'document:123')).toEqual({ epoch: 2, validUntil: NOW + 60_000 });
  });
  it('rejects duplicate signed operations across two hosts sharing durable storage', async () => {
    const identity = new WebCryptoIdentity(); await identity.fromSeed(seed);
    const opts = { environment: { subtle: crypto.subtle, now: () => NOW, newId: () => crypto.randomUUID() } };
    const object = await createCore({ ...opts, identity }).signObject({ kind: 'task', audience: [bobId], body: { task: 'test' }, expiresAt: NOW + 60_000 });
    const a = createCore({ ...opts, replayStore: open().replayStore }), b = createCore({ ...opts, replayStore: open().replayStore });
    const policy = { author: bobId, recipient: bobId, kind: 'task' as const };
    const results = await Promise.allSettled([a.acceptOnce(object, policy), b.acceptOnce(object, policy)]);
    expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(1);
    await expect(createCore({ ...opts, replayStore: open().replayStore }).acceptOnce(object, policy)).rejects.toThrow('object_replay');
  });
  it('atomically admits one same-revision CAS, without overwriting the winner', async () => {
    const a = createIndexedDbCoreRecords(factory, () => {}), b = createIndexedDbCoreRecords(factory, () => {});
    const writes = await Promise.all([a.compareAndSwap(bobId, null, entry()), b.compareAndSwap(bobId, null, entry())]);
    expect(writes.filter(Boolean)).toHaveLength(1); expect((await a.read(bobId))?.revision).toBe(1);
    expect(await b.compareAndSwap(bobId, null, entry())).toBe(false);
    await expect(b.compareAndSwap(bobId, 1, entry(3))).rejects.toThrow('invalid_core_revision');
  });
  it('snapshots mutable buffers before asynchronous opens', async () => {
    const records = createIndexedDbCoreRecords(factory, () => {}), next = entry(); next.iv[0] = 5;
    const pending = records.compareAndSwap(bobId, null, next); next.iv.fill(9); new Uint8Array(next.cipher).fill(9);
    expect(await pending).toBe(true); const stored = await records.read(bobId);
    expect(stored?.iv[0]).toBe(5); expect(new Uint8Array(stored!.cipher)[0]).toBe(0);
  });
  it('propagates quota errors, aborts writes and leaves earlier claims intact', async () => {
    await open().replayStore.claim('a', NOW + 60_000, NOW);
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new DOMException('disk quota', 'QuotaExceededError'); });
    await expect(open().replayStore.claim('b', NOW + 60_000, NOW)).rejects.toThrow('disk quota');
    put.mockRestore(); expect(await open().replayStore.claim('a', NOW + 60_000, NOW)).toBe(false);
    expect(await open().replayStore.claim('b', NOW + 60_000, NOW)).toBe(true);
  });
  it('does not report success when put succeeded but the transaction aborted', async () => {
    const original = IDBObjectStore.prototype.put;
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(this: IDBObjectStore, ...args: Parameters<typeof original>) {
      const request = original.apply(this, args);
      request.addEventListener('success', () => this.transaction.abort()); return request;
    });
    await expect(open().replayStore.claim('a', NOW + 60_000, NOW)).rejects.toThrow();
    put.mockRestore(); expect(await open().replayStore.claim('a', NOW + 60_000, NOW)).toBe(true);
  });
  it('fails closed when storage is unavailable, closed, or session is untrusted', async () => {
    const databaseOpen = vi.spyOn(factory, 'open');
    expect(() => createBrowserCoreState({ accountId: bobId, key, factory, trusted: false })).toThrow('core_storage_requires_trusted_session');
    expect(databaseOpen).not.toHaveBeenCalled();
    vi.stubGlobal('indexedDB', undefined);
    expect(() => createBrowserCoreState({ accountId: bobId, key, trusted: true })).toThrow('core_storage_unavailable');
    const records = createIndexedDbCoreRecords(factory, () => {}); records.close();
    await expect(records.read(bobId)).rejects.toThrow('core_storage_closed');
  });
  it('clears every account and prevents old sessions from resurrecting data after emergency reset', async () => {
    const old = open(), other = open(aliceId);
    await old.replayStore.claim('old', NOW + 60_000, NOW); await other.replayStore.claim('other', NOW + 60_000, NOW);
    beginStorageReset(); await clearAllCoreStorage(factory);
    await expect(old.replayStore.claim('old', NOW + 60_000, NOW)).rejects.toThrow('storage_reset_during_operation');
    await expect(other.replayStore.claim('other', NOW + 60_000, NOW)).rejects.toThrow('storage_reset_during_operation');
    const records = createIndexedDbCoreRecords(factory, () => {});
    expect(await records.read(bobId)).toBeUndefined(); expect(await records.read(aliceId)).toBeUndefined();
    // A genuinely new session starts fresh after explicit total erasure.
    expect(await open().replayStore.claim('old', NOW + 60_000, NOW)).toBe(true);
  });
  it('checks the epoch inside a pending transaction, not just before opening', async () => {
    const epoch = storageEpoch(); let checks = 0;
    const records = createIndexedDbCoreRecords(factory, () => {
      checks++; if (checks === 5) beginStorageReset(); requireStorageEpoch(epoch);
    });
    await expect(records.compareAndSwap(bobId, null, entry())).rejects.toThrow('storage_reset_during_operation');
    expect(await createIndexedDbCoreRecords(factory, () => {}).read(bobId)).toBeUndefined();
  });
  it('does not repopulate storage if erasure occurs while encrypting', async () => {
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
    const original = crypto.subtle.encrypt.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, 'encrypt').mockImplementation(async (...args) => { entered(); await gate; return original(...args); });
    const old = open(), pending = old.replayStore.claim('a', NOW + 60_000, NOW);
    const rejected = expect(pending).rejects.toThrow('storage_reset_during_operation');
    await started; beginStorageReset(); await clearAllCoreStorage(factory); release(); await rejected;
    expect(await createIndexedDbCoreRecords(factory, () => {}).read(bobId)).toBeUndefined();
  });
});

describe('core storage key separation', () => {
  it('derives reproducible nonextractable keys scoped to purpose and account, without modifying the caller seed', async () => {
    const input = new Uint8Array(seed), before = input.slice();
    const repeated = await deriveCoreStorageKey(input, bobId), wrongAccount = await deriveCoreStorageKey(input, aliceId);
    const iv = new Uint8Array(12), plain = new TextEncoder().encode('known-vector');
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
    expect(new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, repeated, encrypted))).toEqual(plain);
    await expect(crypto.subtle.decrypt({ name: 'AES-GCM', iv }, wrongAccount, encrypted)).rejects.toThrow();
    expect(repeated.extractable).toBe(false); expect(input).toEqual(before);
    const material = await crypto.subtle.importKey('raw', input, 'HKDF', false, ['deriveKey']);
    const historyKey = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256',
      salt: new TextEncoder().encode('MeshAutonomy local chat storage v1'), info: new TextEncoder().encode(bobId) },
      material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await expect(crypto.subtle.decrypt({ name: 'AES-GCM', iv }, historyKey, encrypted)).rejects.toThrow();
  });
  it('rejects invalid seed length and scope', async () => {
    await expect(deriveCoreStorageKey(new Uint8Array(31), bobId)).rejects.toThrow('invalid_core_key_input');
    await expect(deriveCoreStorageKey(seed, 'invalid')).rejects.toThrow('invalid_core_key_input');
  });
});
