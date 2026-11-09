import { beforeAll, describe, expect, it } from 'vitest';
import { WebCryptoIdentity } from '../identity/webcrypto';
import { accountIdFromPublicKey } from '../addressing/account-id.js';
import { addProfile, createProfileRegistry, decideInboxConnection, profileRegistrySnapshot,
  requestInboxConnection, updateProfile, visibleInboxSources, LOCAL_INBOX_UNTIL_REVOKED, type ProfileEntry, type ProfileRegistry } from './profiles';
const now = 1_800_000_000_000;
const id = (n: number) => `12345678-1234-4234-8234-${n.toString().padStart(12, '0')}`;
let profiles: ProfileEntry[];
beforeAll(async () => {
  profiles = [];
  for (let n = 0; n < 5; n++) {
    const seed = new Uint8Array(32); seed[31] = n + 1;
    const identity = new WebCryptoIdentity();
    const address = await accountIdFromPublicKey((await identity.fromSeed(seed)).publicKey);
    identity.dispose(); seed.fill(0);
    profiles.push({ id: id(n), index: n, name: ['Все входящие', 'Личный', 'Входящая', 'Исходящая', 'Работа'][n],
      role: n === 0 ? 'main' : n === 2 ? 'incoming' : n === 3 ? 'outgoing' : 'personal',
      accountId: address, archived: false, createdAt: now });
  }
});
const initial = () => profiles.slice(1, 4).reduce((r, p) => addProfile(r, p), createProfileRegistry(profiles[0]));
function request(r: ProfileRegistry, n: number, permission: 'contribute' | 'read-all', sub = 1, actor = sub) {
  return requestInboxConnection(r, { id: id(100 + n), subId: id(sub), actor: id(actor), permission, now, validUntil: now + 86400000 });
}
const approve = (r: ProfileRegistry, n = 1, actor = 0) => decideInboxConnection(r, id(100 + n), id(actor), 'approve', now + 1);
describe('local profile consent and aggregation', () => {
  it('permits until-revoked local contribution but never unlimited cross-profile reading', () => {
    const input = { id: id(101),subId: id(1),actor: id(1),now,validUntil: LOCAL_INBOX_UNTIL_REVOKED };
    const r = approve(requestInboxConnection(initial(), { ...input,permission: 'contribute' }));
    expect(visibleInboxSources(r,id(0),now + 365 * 86400000)).toContain(id(1));
    expect(() => requestInboxConnection(initial(), { ...input,permission: 'read-all' })).toThrow('invalid_profile_registry');
    const revoked = decideInboxConnection(r,id(101),id(1),'revoke',now + 1);
    expect(visibleInboxSources(revoked,id(0),now + 2)).not.toContain(id(1));
  });
  it('defaults to isolated inboxes, including main', () => {
    const r = initial();
    for (let n = 0; n < 4; n++) expect(visibleInboxSources(r, id(n), now)).toEqual([id(n)]);
  });
  it('requires approval by the other side, not a repeated self-approval', () => {
    let r = request(initial(), 1, 'contribute');
    expect(visibleInboxSources(r, id(0), now)).toEqual([id(0)]);
    expect(() => approve(r, 1, 1)).toThrow('inbox_decision_not_allowed');
    expect(() => approve(r, 1, 2)).toThrow('inbox_decision_not_allowed');
    r = approve(r, 1);
    expect(visibleInboxSources(r, id(0), now)).toEqual([id(0), id(1)]);
    expect(visibleInboxSources(r, id(1), now)).toEqual([id(1)]);
  });
  it('also requires sub consent when main initiates the request', () => {
    const r = request(initial(), 1, 'contribute', 1, 0);
    expect(() => approve(r, 1)).toThrow('inbox_decision_not_allowed');
    expect(visibleInboxSources(approve(r, 1, 1), id(0), now)).toContain(id(1));
  });
  it('separates contribute and read; read scope never silently expands', () => {
    let r = approve(request(initial(), 1, 'contribute'));
    r = approve(request(r, 2, 'read-all', 2), 2);
    expect(visibleInboxSources(r, id(2), now)).toEqual([id(2), id(0), id(1)]);
    r = approve(request(r, 3, 'contribute', 3), 3);
    expect(visibleInboxSources(r, id(0), now)).toContain(id(3));
    expect(visibleInboxSources(r, id(2), now)).not.toContain(id(3));
  });
  it('removes visibility on revocation, even for previously approved readers', () => {
    let r = approve(request(initial(), 1, 'contribute'));
    r = approve(request(r, 2, 'read-all', 2), 2);
    r = decideInboxConnection(r, id(101), id(1), 'revoke', now + 2);
    expect(visibleInboxSources(r, id(0), now)).toEqual([id(0)]);
    expect(visibleInboxSources(r, id(2), now)).not.toContain(id(1));
    expect(() => approve(r, 1)).toThrow('inbox_decision_not_allowed');
  });
  it('rejects expired pending approvals and expired active permissions', () => {
    const r = request(initial(), 1, 'contribute');
    expect(() => decideInboxConnection(r, id(101), id(0), 'approve', now + 600000)).toThrow();
    expect(visibleInboxSources(approve(r, 1), id(0), now + 86400000)).toEqual([id(0)]);
  });
  it('archiving revokes links; unarchiving does not resurrect authorization', () => {
    let r = approve(request(initial(), 1, 'contribute'));
    r = updateProfile(r, id(1), { archived: true });
    expect(() => visibleInboxSources(r, id(1), now)).toThrow();
    r = updateProfile(r, id(1), { archived: false });
    expect(visibleInboxSources(r, id(0), now)).toEqual([id(0)]);
    expect(() => updateProfile(r, id(0), { archived: true })).toThrow();
  });
  it('keeps addresses, indices and caller state unchanged when renaming', () => {
    const r = initial(), next = updateProfile(r, id(1), { name: 'Другой ник' });
    expect(r.profiles[1].name).toBe('Личный');
    expect(next.profiles[1]).toEqual({ ...r.profiles[1], name: 'Другой ник' });
    expect(() => updateProfile(r, id(1), { accountId: profiles[2].accountId } as never)).toThrow();
  });
  it('rejects reused indices, duplicate addresses and a second main profile', () => {
    const r = initial();
    expect(() => addProfile(r, { ...profiles[4], index: 1 })).toThrow();
    expect(() => addProfile(r, { ...profiles[4], accountId: profiles[1].accountId })).toThrow();
    expect(() => addProfile(r, { ...profiles[4], role: 'main' })).toThrow();
  });
  it('retains legacy ID under an explicit legacy entry without changing next derivation index', () => {
    const legacy = { ...profiles[1], index: null };
    const r = createProfileRegistry(profiles[0], legacy);
    expect(r.profiles[1].accountId).toBe(legacy.accountId); expect(r.nextIndex).toBe(1);
  });
  it('rejects invalid actors, duplicate requests and malicious registry shapes', () => {
    const r = request(initial(), 1, 'contribute');
    expect(() => request(r, 2, 'contribute')).toThrow();
    expect(() => request(initial(), 1, 'contribute', 1, 2)).toThrow();
    expect(() => request(initial(), 1, 'contribute', 0)).toThrow();
    expect(() => profileRegistrySnapshot({ ...r, seed: 'secret' })).toThrow();
    expect(() => profileRegistrySnapshot({ ...r, get connections() { throw new Error('getter_executed'); } })).toThrow('invalid_json_object');
    expect(() => profileRegistrySnapshot({ ...r, connections: [{ ...r.connections[0], status: 'active' }] })).toThrow();
    expect(() => requestInboxConnection(initial(), { id: id(101), subId: id(1), actor: id(1), permission: 'contribute', now, validUntil: now + 8 * 86400000 })).toThrow();
  });
});
