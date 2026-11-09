import { beforeAll, describe, expect, it } from 'vitest';
import { createProfileRegistry, addProfile, requestInboxConnection, decideInboxConnection } from '../core/profiles';
import { WebCryptoIdentity } from '../identity/webcrypto';
import { accountIdFromPublicKey } from '../addressing/account-id.js';
import { encodeAccountId } from '../addressing/bech32m.js';
import { deriveProfileSeed } from './keys';
import { mergeProfileBackup, verifyProfileRegistry } from './backup';
import type { ProfileRegistry, ProfileEntry } from '../core/profiles';

const root = new Uint8Array(32); root[31] = 1;
const now = 1800000000000;
let registry: ProfileRegistry, scope: string;
beforeAll(async () => {
  const entry = async (index: number | null, role: ProfileEntry['role']): Promise<ProfileEntry> => {
    const seed = index === null ? root.slice() : await deriveProfileSeed(root, index, crypto.subtle), identity = new WebCryptoIdentity();
    try { return { id: crypto.randomUUID(), accountId: await accountIdFromPublicKey((await identity.fromSeed(seed)).publicKey), index,
      role, name: role, createdAt: now, archived: false }; }
    finally { seed.fill(0); identity.dispose(); }
  };
  const legacy = await entry(null, 'personal'); scope = legacy.accountId;
  registry = addProfile(createProfileRegistry(await entry(0, 'main'), legacy), await entry(1, 'incoming'));
});
describe('profile backup integrity and conservative merge', () => {
  it('verifies every derived address without modifying caller secrets', async () => {
    const before = root.slice(); expect(await verifyProfileRegistry(root, scope, registry)).toEqual(registry); expect(root).toEqual(before);
  });
  it('rejects a foreign owner and a valid-looking but unrelated child address', async () => {
    await expect(verifyProfileRegistry(root, registry.profiles[0].accountId, registry)).rejects.toThrow('profile_backup_owner_mismatch');
    const changed = structuredClone(registry); changed.profiles[2].accountId = encodeAccountId(new Uint8Array(20).fill(12));
    await expect(verifyProfileRegistry(root, scope, changed)).rejects.toThrow('profile_backup_address_mismatch');
  });
  it('does not restore an archived child under a substituted key', async () => {
    const changed = structuredClone(registry); changed.profiles[2].archived = true; changed.profiles[2].index = 2; changed.nextIndex = 3;
    await expect(verifyProfileRegistry(root, scope, changed)).rejects.toThrow('profile_backup_address_mismatch');
  });
  it('checks host lifetime throughout key derivation', async () => {
    let checks = 0;
    await expect(verifyProfileRegistry(root, scope, registry, () => { if (++checks >= 3) throw new Error('closed'); })).rejects.toThrow('closed');
  });
  it('restores profile metadata but drops every old pending or active grant', () => {
    const main = registry.profiles[0], sub = registry.profiles[2];
    let r = requestInboxConnection(registry, { id: crypto.randomUUID(), subId: sub.id, permission: 'contribute', actor: sub.id, now, validUntil: now + 86400000 });
    r = decideInboxConnection(r, r.connections[0].id, main.id, 'approve', now);
    const restored = mergeProfileBackup(undefined, r);
    expect(restored.profiles).toEqual(r.profiles); expect(restored.connections).toEqual([]); expect(r.connections).toHaveLength(1);
  });
  it('keeps local names, archives, clock and index high-water marks on stale import', () => {
    const local = structuredClone(registry); local.profiles[2].name = 'New name'; local.profiles[2].archived = true;
    local.nextIndex = 10; local.lastNow = now + 5000;
    const restored = mergeProfileBackup(local, registry); expect(restored).toEqual(local);
    expect(mergeProfileBackup(restored, registry)).toEqual(restored);
  });
  it('rejects conflicting UUID/index mappings rather than silently replacing a local registry', () => {
    const foreign = structuredClone(registry); foreign.profiles[0].id = crypto.randomUUID();
    expect(() => mergeProfileBackup(registry, foreign)).toThrow('profile_backup_conflict');
    expect(registry.profiles[0].id).not.toBe(foreign.profiles[0].id);
  });
  it('adds missing profiles but never invents new permissions for them', () => {
    const local = createProfileRegistry(registry.profiles[0], registry.profiles[1]);
    const restored = mergeProfileBackup(local, registry); expect(restored.profiles).toEqual(registry.profiles);
    expect(restored.nextIndex).toBe(2); expect(restored.connections).toEqual([]);
  });
});
