import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createCore, MemoryReplayStore, type CoreEnvironment, type GrantBody, type PermissionContext } from './index';
import { canonicalJson } from './canonical';
import { WebCryptoIdentity } from '../identity/webcrypto';
import type { IdentityProvider } from '../identity/identity';
import { accountIdFromPublicKey } from '../addressing/account-id.js';
import { validateObjectRecord, type ObjectDraft, type SignedObject } from './objects';

const NOW = 1_800_000_000_000;
const UUID = '12345678-1234-4234-8234-123456789abc';
const env = (now = () => NOW): CoreEnvironment => ({ subtle: crypto.subtle, now, newId: () => UUID });
let alice: WebCryptoIdentity, bob: WebCryptoIdentity, aliceId: string, bobId: string;
beforeAll(async () => {
  alice = new WebCryptoIdentity(); bob = new WebCryptoIdentity();
  const scalar = new Uint8Array(32); scalar[31] = 1; await alice.fromSeed(scalar);
  scalar[31] = 2; await bob.fromSeed(scalar); scalar.fill(0);
  aliceId = await accountIdFromPublicKey(await alice.getPublicKeyBytes());
  bobId = await accountIdFromPublicKey(await bob.getPublicKeyBytes());
});
afterEach(() => vi.restoreAllMocks());
const signer = () => createCore({ identity: alice, environment: env() });
const draft = (): ObjectDraft => ({ kind: 'task', audience: [bobId], body: { operation: 'test', value: 1 }, expiresAt: NOW + 60_000 });
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));

describe('core signed object API', () => {
  it('signs/validates versioned objects through a read-only API without exposing keys', async () => {
    const core = signer(), reader = createCore({ environment: env() });
    const signed = await core.signObject(draft());
    expect(signed.record.author).toBe(aliceId);
    expect(signed.record.id).toBe(UUID); expect(signed.record.version).toBe(1);
    expect(await reader.verifyObject(signed)).toEqual(signed);
    expect(Object.isFrozen(core)).toBe(true); expect(core).not.toHaveProperty('identity');
    expect(core).not.toHaveProperty('seed');
    await expect(reader.signObject(draft())).rejects.toThrow('core_read_only');
  });
  it('uses a distinct signature domain and deterministic canonical signing bytes', async () => {
    const sign = vi.spyOn(alice, 'sign'); const signed = await signer().signObject(draft());
    expect(new TextDecoder().decode(sign.mock.calls[0][0])).toBe('Automesh signed object v1\0' + canonicalJson(signed.record));
    const pub = await crypto.subtle.importKey('raw', (await alice.getPublicKeyBytes()).buffer as ArrayBuffer,
      { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const signature = Uint8Array.from(signed.signature.match(/../g)!, x => parseInt(x, 16));
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, signature,
      new TextEncoder().encode('Another domain\0' + canonicalJson(signed.record)))).toBe(false);
  });
  it('rejects tampering with every signed field, key and signature', async () => {
    const core = signer(), original = await core.signObject(draft());
    const changes: Array<(v: SignedObject) => void> = [
      v => { v.record.author = bobId; }, v => { v.record.audience = [aliceId]; },
      v => { v.record.kind = 'post'; }, v => { v.record.createdAt++; }, v => { v.record.expiresAt!++; },
      v => { v.record.id = '22345678-1234-4234-8234-123456789abc'; }, v => { v.record.body = 'changed'; },
      v => { v.signature = '00'.repeat(64); }, v => { v.publicKey = '04' + '00'.repeat(64); },
      v => { (v.record as unknown as { version: number }).version = 2; },
      v => { Object.assign(v, { extra: true }); },
    ];
    for (const change of changes) { const value = copy(original); change(value); await expect(core.verifyObject(value)).rejects.toThrow(); }
  });
  it('rejects expired/future/unsafe/ambiguous records', async () => {
    const object = await signer().signObject(draft());
    await expect(createCore({ environment: env(() => NOW + 60_000) }).verifyObject(object)).rejects.toThrow('invalid_core_object');
    for (const replacement of [{ createdAt: NOW + 300_001 }, { createdAt: -1 }, { createdAt: 1.5 },
      { id: [UUID] }, { audience: [bobId, bobId] }, { extra: true }]) {
      expect(() => validateObjectRecord({ ...object.record, ...replacement }, NOW)).toThrow('invalid_core_object');
    }
    await expect(createCore({ identity: alice, environment: env(() => NaN) }).signObject(draft())).rejects.toThrow('invalid_core_clock');
  });
  it('rejects oversized complete envelopes before invoking the signer', async () => {
    const sign = vi.spyOn(alice, 'sign');
    await expect(signer().signObject({ ...draft(), body: 'x'.repeat(65_000) })).rejects.toThrow('object_size_limit');
    expect(sign).not.toHaveBeenCalled();
  });
  it('snapshots drafts synchronously before any asynchronous crypto', async () => {
    const input = draft(); const pending = signer().signObject(input);
    input.body = 'changed'; input.audience[0] = aliceId;
    const value = await pending;
    expect(value.record.body).toEqual({ operation: 'test', value: 1 }); expect(value.record.audience).toEqual([bobId]);
  });
  it('catches an inconsistent signer/public key provider', async () => {
    const broken: IdentityProvider = { create: () => alice.create(), fromSeed: s => alice.fromSeed(s),
      getPublicKeyBytes: () => alice.getPublicKeyBytes(), verify: (d, s) => alice.verify(d, s), sign: d => bob.sign(d) };
    await expect(createCore({ identity: broken, environment: env() }).signObject(draft())).rejects.toThrow('invalid_object_signature');
  });
  it('does not resume signing after close while fetching the public key', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const get = alice.getPublicKeyBytes.bind(alice), sign = vi.spyOn(alice, 'sign');
    vi.spyOn(alice, 'getPublicKeyBytes').mockImplementation(async () => { await gate; return get(); });
    const core = signer(), pending = core.signObject(draft());
    const rejected = expect(pending).rejects.toThrow('core_closed'); core.close(); release();
    await rejected; expect(sign).not.toHaveBeenCalled();
    await expect(core.verifyObject({})).rejects.toThrow('core_closed');
  });
  it('does not release an in-flight signature after close; provider remains host-owned', async () => {
    let release!: () => void, started!: () => void;
    const gate = new Promise<void>(r => { release = r; }); const entering = new Promise<void>(r => { started = r; });
    const sign = alice.sign.bind(alice);
    vi.spyOn(alice, 'sign').mockImplementation(async data => { started(); await gate; return sign(data); });
    const core = signer(), pending = core.signObject(draft());
    const rejected = expect(pending).rejects.toThrow('core_closed'); await entering; core.close(); release(); await rejected;
    expect((await alice.getPublicKeyBytes()).length).toBe(65);
  });
});

describe('explicit permissions (deny by default)', () => {
  const body = (): GrantBody => ({ subject: bobId, resource: 'document:123', actions: ['read'], notBefore: NOW, epoch: 1, canDelegate: false });
  const policy = (): PermissionContext => ({ issuer: aliceId, subject: bobId, resource: 'document:123', action: 'read', epoch: 1, isRevoked: async () => false });
  it('accepts only the exact owner, subject, resource, action and policy epoch', async () => {
    const core = signer(), grant = await core.issueGrant(body(), NOW + 60_000);
    expect(await core.authorize(grant, policy())).toEqual(grant);
    for (const change of [{ issuer: bobId }, { subject: aliceId }, { resource: 'document:other' }, { action: 'write' as const }, { epoch: 2 }])
      await expect(core.authorize(grant, { ...policy(), ...change })).rejects.toThrow('permission_denied');
    await expect(core.authorize(await core.signObject(draft()), policy())).rejects.toThrow('permission_denied');
  });
  it('fails closed on revoked, indeterminate or unavailable revocation state', async () => {
    const core = signer(), grant = await core.issueGrant(body(), NOW + 60_000);
    for (const isRevoked of [async () => true, async () => undefined as unknown as boolean,
      async () => { throw new Error('revocation_store_unavailable'); }]) await expect(core.authorize(grant, { ...policy(), isRevoked })).rejects.toThrow();
  });
  it('forbids wildcards, delegation, duplicate/unknown actions and invalid validity windows', async () => {
    const core = signer();
    for (const change of [{ resource: '*' }, { canDelegate: true }, { actions: ['read', 'read'] }, { actions: [] },
      { actions: ['admin'] }, { epoch: -1 }, { notBefore: NOW + 60_000 }])
      await expect(core.issueGrant({ ...body(), ...change } as GrantBody, NOW + 60_000)).rejects.toThrow('invalid_grant');
  });
  it('rejects a validly signed grant addressed to anyone else or with no expiry', async () => {
    const core = signer();
    for (const change of [{ audience: [aliceId] }, { audience: [bobId, aliceId] }, { expiresAt: null }]) {
      const grant = await core.signObject({ kind: 'grant', body: body() as unknown as import('./canonical').JsonValue,
        audience: [bobId], expiresAt: NOW + 60_000, ...change });
      await expect(core.authorize(grant, policy())).rejects.toThrow('permission_denied');
    }
  });
  it('snapshots policy and rechecks expiry after asynchronous revocation lookup', async () => {
    let now = NOW; const core = createCore({ identity: alice, environment: env(() => now) });
    const grant = await core.issueGrant(body(), NOW + 60_000);
    const p = policy(), pending = core.authorize(grant, p); p.action = 'write';
    await expect(pending).resolves.toEqual(grant);
    await expect(core.authorize(grant, { ...policy(), isRevoked: async () => { now += 60_000; return false; } })).rejects.toThrow('permission_denied');
  });
});

describe('replay handling', () => {
  it('claims a valid operation only once even with simultaneous verification', async () => {
    const core = createCore({ identity: alice, environment: env(), replayStore: new MemoryReplayStore() });
    const object = await core.signObject(draft()), policy = { author: aliceId, recipient: bobId, kind: 'task' as const };
    const attempts = await Promise.allSettled([core.acceptOnce(object, policy), core.acceptOnce(object, policy)]);
    expect(attempts.filter(x => x.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter(x => x.status === 'rejected')).toHaveLength(1);
    await expect(core.acceptOnce(object, policy)).rejects.toThrow('object_replay');
  });
  it('does not consume a claim for a wrong author, recipient or kind', async () => {
    const core = createCore({ identity: alice, environment: env(), replayStore: new MemoryReplayStore() });
    const object = await core.signObject(draft()), p = { author: aliceId, recipient: bobId, kind: 'task' as const };
    for (const change of [{ author: bobId }, { recipient: aliceId }, { kind: 'post' as const }])
      await expect(core.acceptOnce(object, { ...p, ...change })).rejects.toThrow('object_not_accepted');
    await expect(core.acceptOnce(object, p)).resolves.toEqual(object);
  });
  it('requires an explicit store and finite bounded expiry for operations', async () => {
    const core = signer(), p = { author: aliceId, recipient: bobId, kind: 'task' as const };
    const object = await core.signObject(draft());
    await expect(core.acceptOnce(object, p)).rejects.toThrow('replay_store_required');
    const receiver = createCore({ environment: env(), replayStore: new MemoryReplayStore() });
    for (const expiresAt of [null, NOW + 8 * 86400000])
      await expect(receiver.acceptOnce(await core.signObject({ ...draft(), expiresAt }), p)).rejects.toThrow('object_not_accepted');
  });
  it('never evicts live claims on capacity pressure; expired claims can be reclaimed', async () => {
    const store = new MemoryReplayStore(1);
    expect(await store.claim('a', NOW + 10, NOW)).toBe(true);
    expect(await store.claim('a', NOW + 10, NOW)).toBe(false);
    await expect(store.claim('b', NOW + 20, NOW)).rejects.toThrow('replay_capacity');
    expect(await store.claim('a', NOW + 20, NOW + 10)).toBe(true);
    expect(() => new MemoryReplayStore(0)).toThrow('invalid_replay_capacity');
    await expect(store.claim('b', NOW, NOW)).rejects.toThrow('invalid_replay_claim');
  });
  it('rechecks expiry after a delayed storage claim', async () => {
    let now = NOW;
    const receiver = createCore({ environment: env(() => now), replayStore: {
      async claim() { now += 60_000; return true; },
    } });
    await expect(receiver.acceptOnce(await signer().signObject(draft()),
      { author: aliceId, recipient: bobId, kind: 'task' })).rejects.toThrow('object_not_accepted');
  });
  it('rejects a repeat even with an alternate valid ECDSA signature', async () => {
    const receiver = createCore({ environment: env(), replayStore: new MemoryReplayStore() });
    const object = await signer().signObject(draft()), p = { author: aliceId, recipient: bobId, kind: 'task' as const };
    const order = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
    const alternative = { ...object, signature: object.signature.slice(0, 64) +
      (order - BigInt('0x' + object.signature.slice(64))).toString(16).padStart(64, '0') };
    await expect(receiver.verifyObject(alternative)).resolves.toEqual(alternative);
    await receiver.acceptOnce(object, p);
    await expect(receiver.acceptOnce(alternative, p)).rejects.toThrow('object_replay');
  });
});
