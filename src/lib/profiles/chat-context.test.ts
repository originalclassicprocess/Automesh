import { beforeAll, describe, expect, it } from 'vitest';
import { prepareProfileChatContext, commitProfileChatContext, readProfileInbox } from './chat-context';
import { WebCryptoIdentity } from '../identity/webcrypto';
import { accountIdFromPublicKey } from '../addressing/account-id.js';
import { deriveProfileSeed } from './keys';
import { createProfileRegistry, addProfile, requestInboxConnection, decideInboxConnection, type ProfileEntry } from '../core/profiles';
import { deriveChatStoreKey, type LocalChatData } from '../chat/local-store';
import { emptySessionChats, saveChats } from '../chat/session-chats';
const root = new Uint8Array(32); root[31] = 1;
let owner: string, main: ProfileEntry, legacy: ProfileEntry, incoming: ProfileEntry;
async function entry(index: number | null, role: ProfileEntry['role']): Promise<ProfileEntry> {
  const seed = index === null ? new Uint8Array(root) : await deriveProfileSeed(root, index, crypto.subtle);
  const provider = new WebCryptoIdentity();
  try { await provider.fromSeed(seed); return { id: crypto.randomUUID(), index, role, accountId: await accountIdFromPublicKey(await provider.getPublicKeyBytes()), name: role, archived: false, createdAt: 1000 }; }
  finally { seed.fill(0); provider.dispose(); }
}
beforeAll(async () => { legacy = await entry(null, 'personal'); owner = legacy.accountId; main = await entry(0, 'main'); incoming = await entry(1, 'incoming'); });
const registry = () => addProfile(createProfileRegistry(main, legacy), incoming);
const data = (): LocalChatData => ({ selfNickname: 'test', readReceiptsEnabled: true, autoLockMinutes: 5,
  aliases: {}, declaredNames: {}, peerReadPreferences: {}, peerPublicKeys: {}, chats: saveChats(emptySessionChats()) });
describe('profile chat context preflight', () => {
  it('commits only after stopping old transport and durable save, in that order', async () => {
    const context = await prepareProfileChatContext({ root, owner, registry: registry(), profileId: incoming.id, guard() {}, read: async () => undefined });
    const calls: string[] = [];
    try {
      await commitProfileChatContext(context, { guard() {}, stop: async () => { calls.push('stop'); }, save: async () => { calls.push('save'); return true; }, adopt: () => { calls.push('adopt'); } });
      expect(calls).toEqual(['stop','save','adopt']);
    } finally { context.close(); }
  });
  it('does not adopt on failed save or invalidated old session', async () => {
    const context = await prepareProfileChatContext({ root, owner, registry: registry(), profileId: incoming.id, guard() {}, read: async () => undefined });
    let adopted = false, current = true;
    const port = { guard() { if (!current) throw new Error('stale'); }, stop: async () => {}, save: async () => false, adopt: () => { adopted = true; } };
    try {
      await expect(commitProfileChatContext(context,port)).rejects.toThrow('profile_previous_history_not_saved'); expect(adopted).toBe(false);
      await expect(commitProfileChatContext(context, { ...port, save: async () => { current = false; return true; } })).rejects.toThrow('stale'); expect(adopted).toBe(false);
    } finally { context.close(); }
  });
  it('refreshes the saved archive before adoption, including same-profile switches', async () => {
    const initial = data(); initial.selfNickname = 'before';
    const context = await prepareProfileChatContext({ root, owner, registry: registry(), profileId: incoming.id, guard() {}, read: async () => initial });
    const calls: string[] = [];
    try {
      await commitProfileChatContext(context,{ guard() {}, stop: async () => { calls.push('stop'); },
        save: async () => { calls.push('save'); initial.selfNickname = 'after'; return true; },
        refresh: async next => { calls.push('refresh'); next.data = structuredClone(initial); },
        adopt: next => { calls.push('adopt'); expect(next.data!.selfNickname).toBe('after'); } });
      expect(calls).toEqual(['stop','save','refresh','adopt']);
      let adopted = false;
      await expect(commitProfileChatContext(context,{ guard() {}, stop: async () => {}, save: async () => true,
        refresh: async () => { throw new Error('read_failed'); }, adopt: () => { adopted = true; } })).rejects.toThrow('read_failed');
      expect(adopted).toBe(false);
    } finally { context.close(); }
  });
  it('preserves legacy address and history scope without changing root bytes', async () => {
    const original = new Uint8Array(root); let loaded = '';
    const context = await prepareProfileChatContext({ root, owner, registry: registry(), guard() {}, read: async (_key, id) => { loaded = id; return data(); } });
    try { expect(context.accountId).toBe(owner); expect(loaded).toBe(owner); expect(context.network).toBe(true); expect(root).toEqual(original); }
    finally { context.close(); }
  });
  it('child signer and history use the child address and a separate key', async () => {
    const context = await prepareProfileChatContext({ root, owner, registry: registry(), profileId: incoming.id, guard() {}, read: async key => {
      const iv = crypto.getRandomValues(new Uint8Array(12)), sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new Uint8Array([1]));
      const legacyKey = await deriveChatStoreKey(root, owner);
      await expect(crypto.subtle.decrypt({ name: 'AES-GCM', iv }, legacyKey, sealed)).rejects.toThrow(); return data();
    } });
    try { expect(context.accountId).toBe(incoming.accountId); expect(await accountIdFromPublicKey(await context.provider.getPublicKeyBytes())).toBe(incoming.accountId); }
    finally { context.close(); }
  });
  it('main is local-only and never made network eligible', async () => {
    const context = await prepareProfileChatContext({ root, owner, registry: registry(), profileId: main.id, guard() {}, read: async () => undefined });
    expect(context.network).toBe(false); context.close();
  });
  it('refuses missing, archived, substituted and wrong-owner identities', async () => {
    const options = { root, owner, registry: registry(), guard() {}, read: async () => undefined };
    await expect(prepareProfileChatContext({ ...options, profileId: crypto.randomUUID() })).rejects.toThrow();
    const archived = registry(); archived.profiles[2].archived = true;
    await expect(prepareProfileChatContext({ ...options, registry: archived, profileId: incoming.id })).rejects.toThrow();
    const substituted = registry(); substituted.profiles[2].accountId = (await entry(2, 'custom')).accountId;
    await expect(prepareProfileChatContext({ ...options, registry: substituted, profileId: incoming.id })).rejects.toThrow('profile_address_mismatch');
    await expect(prepareProfileChatContext({ ...options, owner: main.accountId })).rejects.toThrow('profile_owner_mismatch');
  });
  it('a failed history read or superseded preflight is not silently an empty chat', async () => {
    const options = { root, owner, registry: registry(), profileId: incoming.id, guard() {} };
    await expect(prepareProfileChatContext({ ...options, read: async () => { throw new Error('corrupt'); } })).rejects.toThrow('corrupt');
    let current = true;
    await expect(prepareProfileChatContext({ ...options, guard() { if (!current) throw new Error('stale'); }, read: async () => { current = false; return data(); } })).rejects.toThrow('stale');
  });
  it('projects only explicit nonexpired sources; does not grow or keep revoked sources', async () => {
    let value = requestInboxConnection(registry(), { id: crypto.randomUUID(), subId: incoming.id, permission: 'contribute', actor: incoming.id, now: 1000, validUntil: 900000 });
    value = decideInboxConnection(value, value.connections[0].id, main.id, 'approve', 1001);
    const options = { root, owner, registry: value, viewer: main.id, now: 2000, guard() {}, read: async () => data() };
    const projected = await readProfileInbox(options);
    expect(projected.sources.map(s => s.profile.id)).toEqual([]);
    // Empty histories have no chat rows; permission tests also exercise actual data.
    const chats = data(); chats.chats.order = [owner]; chats.chats.byPeer[owner] = { messages: [] };
    const rows = await readProfileInbox({ ...options, read: async () => chats });
    expect(rows.sources.map(s => s.profile.id)).toEqual([main.id, incoming.id]);
    expect(Object.keys(rows.sources[0].data).sort()).toEqual(['aliases','chats','declaredNames','selfNickname']);
    value = decideInboxConnection(value, value.connections[0].id, incoming.id, 'revoke', 2001);
    expect((await readProfileInbox({ ...options, read: async () => chats, registry: value, now: 2002 })).sources.map(s => s.profile.id)).toEqual([main.id]);
  });
  it('paginates rather than deleting messages, bounds previews, and authorizes older pages', async () => {
    const original = data();
    original.chats.order = Array.from({ length: 21 }, (_, i) => `peer-${i}`);
    for (const peer of original.chats.order) original.chats.byPeer[peer] = { messages: Array.from({ length: 120 }, (_, i) => ({
      id: String(i), from: owner, text: 'x'.repeat(5000), timestamp: i, direction: 'incoming' as const,
    })) };
    original.chats.order[0] = owner; original.chats.byPeer[owner] = original.chats.byPeer['peer-0'];
    const options = { root, owner, registry: registry(), viewer: incoming.id, now: 2000, guard() {}, read: async () => original };
    const first = await readProfileInbox(options);
    expect(first.totalChats).toBe(21); expect(first.sources[0].data.chats.order).toHaveLength(20);
    expect(first.sources[0].windows[owner]).toEqual({ total: 120, start: 70, end: 120 });
    expect(first.sources[0].data.chats.byPeer[owner].messages).toHaveLength(50);
    expect(first.sources[0].data.chats.byPeer[owner].messages[0].text).toHaveLength(1001);
    expect((await readProfileInbox({ ...options, page: 1 })).sources[0].data.chats.order).toHaveLength(1);
    const older = await readProfileInbox({ ...options, focus: { profileId: incoming.id, peer: owner, before: 70 } });
    expect(older.sources[0].windows[owner]).toEqual({ total: 120, start: 20, end: 70 });
    expect(original.chats.byPeer[owner].messages).toHaveLength(120);
    expect(original.chats.byPeer[owner].messages[0].text).toHaveLength(5000);
    await expect(readProfileInbox({ ...options, focus: { profileId: main.id, peer: owner } })).rejects.toThrow('invalid_inbox_page');
    await expect(readProfileInbox({ ...options, page: -1 })).rejects.toThrow('invalid_inbox_page');
  });
});
