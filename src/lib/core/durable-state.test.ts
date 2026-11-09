import { beforeAll, describe, expect, it } from 'vitest';
import { createCore, type CoreEnvironment, type PolicyAnchor, type PolicyUpdate } from './index';
import { createDurableCoreState, type CoreRecordStore, type SealedCoreRecord } from './durable-state';
import { WebCryptoIdentity } from '../identity/webcrypto';
import { accountIdFromPublicKey } from '../addressing/account-id.js';

const NOW = 1_800_000_000_000;
const ID = '12345678-1234-4234-8234-123456789abc';
const SECOND_ID = '22345678-1234-4234-8234-123456789abc';
let alice: WebCryptoIdentity, aliceId: string, bobId: string, key: CryptoKey;
beforeAll(async () => {
  alice = new WebCryptoIdentity(); const bob = new WebCryptoIdentity();
  const seed = new Uint8Array(32); seed[31] = 1; await alice.fromSeed(seed);
  seed[31] = 2; await bob.fromSeed(seed); seed.fill(0);
  aliceId = await accountIdFromPublicKey(await alice.getPublicKeyBytes());
  bobId = await accountIdFromPublicKey(await bob.getPublicKeyBytes());
  key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
});
function fixture(capacity = 8) {
  const entries = new Map<string, SealedCoreRecord>();
  const records: CoreRecordStore = {
    async read(scope) { return structuredClone(entries.get(scope)); },
    async compareAndSwap(scope, revision, next) {
      if ((entries.get(scope)?.revision ?? null) !== revision) return false;
      entries.set(scope, structuredClone(next)); return true;
    },
  };
  let now = NOW;
  const environment: CoreEnvironment = { subtle: crypto.subtle, now: () => now, newId: () => crypto.randomUUID() };
  const reopen = (scope = bobId, storageKey = key) => createDurableCoreState({ scope, key: storageKey, records,
    environment, randomBytes: n => crypto.getRandomValues(new Uint8Array(n)), claimCapacity: capacity });
  return { entries, records, environment, reopen, setNow: (value: number) => { now = value; } };
}
const anchor = (): PolicyAnchor => ({ issuer: aliceId, recipient: bobId, resource: 'document:123', epoch: 1, validUntil: NOW + 60_000 });
const update = (sequence = 1, epoch = 1, revoked = [ID]): PolicyUpdate => ({ ...anchor(), sequence, epoch, revoked });
const context = () => ({ issuer: aliceId, subject: bobId, resource: 'document:123', action: 'read' as const });

describe('durable encrypted replay state', () => {
  it('rejects repeats after closing/recreating the adapter', async () => {
    const f = fixture(), first = f.reopen();
    expect(await first.replayStore.claim('operation', NOW + 60_000, NOW)).toBe(true); first.close();
    expect(await f.reopen().replayStore.claim('operation', NOW + 60_000, NOW)).toBe(false);
  });
  it('atomically admits only one of simultaneous claims from independent instances', async () => {
    const f = fixture();
    const results = await Promise.all(Array.from({ length: 8 }, () => f.reopen().replayStore.claim('same', NOW + 60_000, NOW)));
    expect(results.filter(Boolean)).toHaveLength(1);
  });
  it('preserves distinct claims under concurrent writes without lost updates', async () => {
    const f = fixture();
    await Promise.all(Array.from({ length: 8 }, (_, i) => f.reopen().replayStore.claim(String(i), NOW + 60_000, NOW)));
    for (let i = 0; i < 8; i++) expect(await f.reopen().replayStore.claim(String(i), NOW + 60_000, NOW)).toBe(false);
  });
  it('fails closed at capacity, never evicts live claims, and reclaims expired slots', async () => {
    const f = fixture(1), store = f.reopen().replayStore;
    await store.claim('a', NOW + 10, NOW);
    await expect(store.claim('b', NOW + 20, NOW)).rejects.toThrow('replay_capacity');
    expect(await store.claim('a', NOW + 10, NOW)).toBe(false);
    f.setNow(NOW + 10); expect(await store.claim('b', NOW + 20, NOW + 10)).toBe(true);
  });
  it('does not resurrect expired operations after wall-clock rollback', async () => {
    const f = fixture(), store = f.reopen().replayStore;
    await store.claim('old', NOW + 10, NOW);
    f.setNow(NOW + 10); await store.claim('new', NOW + 100, NOW + 10);
    f.setNow(NOW);
    await expect(f.reopen().replayStore.claim('old', NOW + 10, NOW)).rejects.toThrow('invalid_replay_claim');
    expect(await f.reopen().replayStore.claim('new', NOW + 100, NOW)).toBe(false);
  });
  it('isolates accounts even with the same supplied key and claim identifier', async () => {
    const f = fixture(); await f.reopen().replayStore.claim('same', NOW + 20, NOW);
    expect(await f.reopen(aliceId).replayStore.claim('same', NOW + 20, NOW)).toBe(true);
    f.entries.set(aliceId, structuredClone(f.entries.get(bobId)!));
    await expect(f.reopen(aliceId).replayStore.claim('other', NOW + 20, NOW)).rejects.toThrow();
  });
  it('encrypts claim identifiers and permission data, with fresh nonces on writes', async () => {
    const f = fixture(), state = f.reopen();
    await state.replayStore.claim('private-operation-label', NOW + 60_000, NOW);
    const first = structuredClone(f.entries.get(bobId)!);
    await state.policyStore.initialize(anchor());
    const second = f.entries.get(bobId)!;
    expect(first.iv).not.toEqual(second.iv);
    const text = new TextDecoder().decode(second.cipher);
    for (const secret of ['private-operation-label', aliceId, 'document:123']) expect(text).not.toContain(secret);
    expect(Object.keys(second).sort()).toEqual(['cipher', 'iv', 'revision', 'schema']);
  });
  it('rejects corrupted ciphertext, wrong key, revision tampering and unknown schema without resetting', async () => {
    const f = fixture(); await f.reopen().replayStore.claim('a', NOW + 20, NOW);
    const original = structuredClone(f.entries.get(bobId)!);
    for (const corrupt of [() => { new Uint8Array(f.entries.get(bobId)!.cipher)[0] ^= 1; },
      () => { f.entries.get(bobId)!.revision++; }, () => { f.entries.get(bobId)!.schema = 2 as 1; }]) {
      f.entries.set(bobId, structuredClone(original)); corrupt();
      const corrupted = structuredClone(f.entries.get(bobId));
      await expect(f.reopen().replayStore.claim('b', NOW + 20, NOW)).rejects.toThrow();
      expect(f.entries.get(bobId)).toEqual(corrupted);
    }
    f.entries.set(bobId, original);
    const other = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await expect(f.reopen(bobId, other).replayStore.claim('a', NOW + 20, NOW)).rejects.toThrow();
    expect(await f.reopen().replayStore.claim('a', NOW + 20, NOW)).toBe(false);
  });
  it('rejects authenticated but invalid plaintext schemas', async () => {
    const f = fixture(), iv = crypto.getRandomValues(new Uint8Array(12));
    f.entries.set(bobId, { schema: 1, revision: 1, iv,
      cipher: await crypto.subtle.encrypt({ name: 'AES-GCM', iv,
        additionalData: new TextEncoder().encode(JSON.stringify(['Automesh encrypted core state v1', bobId, 1])) }, key,
        new TextEncoder().encode(JSON.stringify({ schema: 2, lastNow: NOW, claims: [], policies: [] }))) });
    await expect(f.reopen().replayStore.claim('a', NOW + 20, NOW)).rejects.toThrow('core_state_corrupt');
  });
  it('propagates storage failures and bounded contention, without success or fallback', async () => {
    const f = fixture();
    f.records.read = async () => { throw new Error('storage_denied'); };
    await expect(f.reopen().replayStore.claim('a', NOW + 20, NOW)).rejects.toThrow('storage_denied');
    f.records.read = async () => undefined;
    f.records.compareAndSwap = async () => { throw new Error('quota_exceeded'); };
    await expect(f.reopen().replayStore.claim('a', NOW + 20, NOW)).rejects.toThrow('quota_exceeded');
    let tries = 0; f.records.compareAndSwap = async () => { tries++; return false; };
    await expect(f.reopen().replayStore.claim('a', NOW + 20, NOW)).rejects.toThrow('core_state_contention');
    expect(tries).toBe(16); expect(f.entries.size).toBe(0);
  });
  it('does not write after close while awaiting a driver read', async () => {
    const f = fixture(); let release!: () => void;
    f.records.read = () => new Promise(resolve => { release = () => resolve(undefined); });
    const state = f.reopen(), pending = state.replayStore.claim('a', NOW + 20, NOW);
    const rejected = expect(pending).rejects.toThrow('core_state_closed'); state.close(); release(); await rejected;
    expect(f.entries.size).toBe(0);
    await expect(state.policyStore.read(aliceId, 'document:123')).rejects.toThrow('core_state_closed');
  });
  it('does not release a committed result after close during a driver commit', async () => {
    const f = fixture(), state = f.reopen(), cas = f.records.compareAndSwap;
    f.records.compareAndSwap = async (...args) => { const result = await cas(...args); state.close(); return result; };
    await expect(state.replayStore.claim('a', NOW + 20, NOW)).rejects.toThrow('core_state_closed');
    f.records.compareAndSwap = cas;
    // A committed operation may safely remain consumed, but is never reported as allowed.
    expect(await f.reopen().replayStore.claim('a', NOW + 20, NOW)).toBe(false);
  });
  it('rejects unsafe bounds, extractable keys and malformed claims', async () => {
    const f = fixture(), store = f.reopen().replayStore;
    for (const [id, expiry, now] of [['', NOW + 20, NOW], ['a', NOW, NOW], ['a', NOW + 20, NaN], ['a', 1.5, 0]] as const)
      await expect(store.claim(id, expiry, now)).rejects.toThrow('invalid_replay_claim');
    expect(() => fixture(0).reopen()).toThrow('invalid_durable_core_options');
    const extractable = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    expect(() => f.reopen(bobId, extractable)).toThrow('invalid_durable_core_options');
  });
});

describe('persisted trusted permission policy', () => {
  it('requires an explicit anchor; network updates cannot create trusted owners', async () => {
    const f = fixture(), state = f.reopen();
    await expect(state.policyStore.read(aliceId, 'document:123')).rejects.toThrow('policy_unavailable');
    expect(await state.policyStore.isRevoked(aliceId, 'document:123', 1, ID)).toBe(true);
    await expect(state.policyStore.apply(update())).rejects.toThrow('policy_unavailable');
    await expect(state.policyStore.initialize({ ...anchor(), recipient: aliceId })).rejects.toThrow('policy_scope_mismatch');
    await state.policyStore.initialize(anchor());
    await expect(state.policyStore.initialize(anchor())).rejects.toThrow('policy_already_initialized');
  });
  it('persists revocations across reopening and rejects old policy sequences', async () => {
    const f = fixture(), state = f.reopen(); await state.policyStore.initialize(anchor());
    await state.policyStore.apply(update(2)); state.close();
    const next = f.reopen().policyStore;
    expect(await next.isRevoked(aliceId, 'document:123', 1, ID)).toBe(true);
    await expect(next.apply(update(1, 1, []))).rejects.toThrow('stale_policy_update');
    await expect(next.apply(update(3, 0, []))).rejects.toThrow('stale_policy_update');
  });
  it('accepts identical/reordered retries but denies same-sequence conflicting policy', async () => {
    const state = fixture().reopen(); await state.policyStore.initialize(anchor());
    const value = update(); await state.policyStore.apply(value);
    const reversed = Object.fromEntries(Object.entries(value).reverse()) as unknown as PolicyUpdate;
    await expect(state.policyStore.apply(reversed)).resolves.toBeUndefined();
    await expect(state.policyStore.apply(update(1, 1, []))).rejects.toThrow('conflicting_policy_update');
  });
  it('cannot un-revoke by omission; higher epochs invalidate all previous grants', async () => {
    const state = fixture().reopen(); await state.policyStore.initialize(anchor());
    await state.policyStore.apply(update()); await state.policyStore.apply(update(2, 1, []));
    expect(await state.policyStore.isRevoked(aliceId, 'document:123', 1, ID)).toBe(true);
    expect(await state.policyStore.isRevoked(aliceId, 'document:123', 1, SECOND_ID)).toBe(false);
    await state.policyStore.apply(update(3, 2, []));
    expect(await state.policyStore.isRevoked(aliceId, 'document:123', 1, SECOND_ID)).toBe(true);
    expect(await state.policyStore.isRevoked(aliceId, 'document:123', 2, SECOND_ID)).toBe(false);
    await expect(state.policyStore.apply(update(4, 1, []))).rejects.toThrow('stale_policy_update');
  });
  it('fails closed for stale policy and does not refresh it through clock rollback', async () => {
    const f = fixture(), state = f.reopen(); await state.policyStore.initialize(anchor());
    f.setNow(NOW + 60_000);
    expect(await state.policyStore.isRevoked(aliceId, 'document:123', 1, ID)).toBe(true);
    f.setNow(NOW); await expect(f.reopen().policyStore.read(aliceId, 'document:123')).rejects.toThrow('policy_unavailable');
  });
  it('persists the high-water clock even when policy read is denied', async () => {
    const f = fixture(), state = f.reopen(); await state.policyStore.initialize(anchor());
    f.setNow(NOW + 60_000); await expect(state.policyStore.read(aliceId, 'document:123')).rejects.toThrow('policy_unavailable');
    f.setNow(NOW); await expect(f.reopen().policyStore.read(aliceId, 'document:123')).rejects.toThrow('policy_unavailable');
  });
  it('preserves concurrent revocations in the same epoch', async () => {
    const f = fixture(); await f.reopen().policyStore.initialize(anchor());
    const results = await Promise.allSettled([f.reopen().policyStore.apply(update(1, 1, [ID])), f.reopen().policyStore.apply(update(2, 1, [SECOND_ID]))]);
    const policies = f.reopen().policyStore;
    expect(await policies.isRevoked(aliceId, 'document:123', 1, SECOND_ID)).toBe(true);
    if (results[0].status === 'fulfilled') expect(await policies.isRevoked(aliceId, 'document:123', 1, ID)).toBe(true);
    else expect(String(results[0].reason)).toContain('stale_policy_update');
    // Out-of-order updates require the issuer to send a cumulative revocation list.
  });
  it('fails closed on policy capacity without silently changing trusted owners', async () => {
    const f = fixture(), state = createDurableCoreState({ scope: bobId, key, records: f.records, environment: f.environment,
      randomBytes: n => crypto.getRandomValues(new Uint8Array(n)), policyCapacity: 1 });
    await state.policyStore.initialize(anchor());
    await expect(state.policyStore.initialize({ ...anchor(), resource: 'document:other' })).rejects.toThrow('policy_capacity');
    expect((await state.policyStore.read(aliceId, 'document:123')).epoch).toBe(1);
  });
  it('checks policy freshness again after a delayed transaction', async () => {
    const f = fixture(), state = f.reopen(); await state.policyStore.initialize(anchor());
    const cas = f.records.compareAndSwap;
    f.records.compareAndSwap = async (...args) => { const result = await cas(...args); f.setNow(NOW + 60_000); return result; };
    expect(await state.policyStore.isRevoked(aliceId, 'document:123', 1, ID)).toBe(true);
  });
  it('does not evict revocation tombstones at capacity and allows a new epoch', async () => {
    const state = fixture().reopen(); await state.policyStore.initialize(anchor());
    const revoked = Array.from({ length: 1024 }, (_, i) => `12345678-1234-4234-8234-${i.toString(16).padStart(12, '0')}`);
    await state.policyStore.apply(update(1, 1, revoked));
    await expect(state.policyStore.apply(update(2, 1, [ID]))).rejects.toThrow('policy_revocation_capacity');
    expect(await state.policyStore.isRevoked(aliceId, 'document:123', 1, revoked[0])).toBe(true);
    await expect(state.policyStore.apply(update(2, 2, [ID]))).resolves.toBeUndefined();
  });
  it('uses the signed revocation API, enforces trusted issuer/recipient/resource, and denies revoked grants', async () => {
    const f = fixture(), state = f.reopen(); await state.policyStore.initialize(anchor());
    const owner = createCore({ identity: alice, environment: f.environment });
    const reader = createCore({ environment: f.environment, policyStore: state.policyStore });
    const grant = await owner.issueGrant({ subject: bobId, resource: 'document:123', actions: ['read'], notBefore: NOW, epoch: 1, canDelegate: false }, NOW + 60_000);
    await expect(reader.authorizeStored(grant, context())).resolves.toEqual(grant);
    const revocation = await owner.issueRevocation(update(1, 1, [grant.record.id]));
    const expected = { issuer: aliceId, recipient: bobId, resource: 'document:123' };
    for (const change of [{ issuer: bobId }, { recipient: aliceId }, { resource: 'document:other' }])
      await expect(reader.applyRevocation(revocation, { ...expected, ...change })).rejects.toThrow('policy_update_not_authorized');
    await reader.applyRevocation(revocation, expected);
    await expect(createCore({ environment: f.environment, policyStore: f.reopen().policyStore }).authorizeStored(grant, context())).rejects.toThrow('permission_denied');
    await expect(owner.issueRevocation({ ...update(), issuer: bobId })).rejects.toThrow('policy_update_not_authorized');
  });
  it('rejects tampered/incorrectly addressed policy envelopes and requires the store', async () => {
    const f = fixture(), state = f.reopen(); await state.policyStore.initialize(anchor());
    const owner = createCore({ identity: alice, environment: f.environment });
    const reader = createCore({ environment: f.environment, policyStore: state.policyStore });
    const expected = { issuer: aliceId, recipient: bobId, resource: 'document:123' };
    const value = await owner.issueRevocation(update());
    const tampered = structuredClone(value); (tampered.record.body as Record<string, unknown>).revoked = [];
    await expect(reader.applyRevocation(tampered, expected)).rejects.toThrow('invalid_object_signature');
    for (const change of [{ audience: [aliceId] }, { audience: [bobId, aliceId] }, { expiresAt: NOW + 50_000 }]) {
      const wrong = await owner.signObject({ kind: 'revocation', body: update() as unknown as import('./canonical').JsonValue,
        audience: [bobId], expiresAt: NOW + 60_000, ...change });
      await expect(reader.applyRevocation(wrong, expected)).rejects.toThrow('policy_update_not_authorized');
    }
    await expect(owner.applyRevocation(value, expected)).rejects.toThrow('policy_store_required');
    await expect(owner.authorizeStored(value, context())).rejects.toThrow('policy_store_required');
  });
  it('rechecks the latest epoch after grant signature verification, not an earlier snapshot', async () => {
    const f = fixture(), state = f.reopen(); await state.policyStore.initialize(anchor());
    const owner = createCore({ identity: alice, environment: f.environment });
    const grant = await owner.issueGrant({ subject: bobId, resource: 'document:123', actions: ['read'], notBefore: NOW, epoch: 1, canDelegate: false }, NOW + 60_000);
    const policies = { ...state.policyStore, read: async (issuer: string, resource: string) => {
      const old = await state.policyStore.read(issuer, resource);
      await state.policyStore.apply(update(1, 2, [])); return old;
    } };
    await expect(createCore({ environment: f.environment, policyStore: policies }).authorizeStored(grant, context())).rejects.toThrow('permission_denied');
  });
  it('validates deadlines, sequences, UUID lists, extra fields and explicit bootstrap shape', async () => {
    const state = fixture().reopen(); await state.policyStore.initialize(anchor());
    for (const change of [{ sequence: 0 }, { sequence: 1.5 }, { epoch: -1 }, { validUntil: NOW },
      { validUntil: NOW + 8 * 86400000 }, { revoked: [ID, ID] }, { revoked: ['bad'] }, { extra: true }])
      await expect(state.policyStore.apply({ ...update(), ...change } as PolicyUpdate)).rejects.toThrow();
    await expect(state.policyStore.initialize(null as unknown as PolicyAnchor)).rejects.toThrow('invalid_policy');
  });
});
