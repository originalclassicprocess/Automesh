import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { openProfileChatBrowserCheck, PROFILE_CHAT_TEST_PASSWORD } from './chat-browser-check';
beforeEach(() => vi.stubGlobal('localStorage',{ getItem: () => null }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('isolated browser chat fixture with real sealed histories', () => {
  it('opens all-chats as a read-only view without changing or persisting another identity', async () => {
    const run = crypto.randomUUID(), factory = new IDBFactory();
    let fixture = await openProfileChatBrowserCheck(run,factory);
    try {
      const before = fixture.state(); await fixture.addSaved('current only');
      await fixture.allInbox();
      expect(fixture.state().accountId).toBe(before.accountId);
      expect(fixture.state().profile!.id).toBe(before.profile!.id);
      expect(fixture.state().network).toBe(before.network);
      fixture.close(); fixture = await openProfileChatBrowserCheck(run,factory);
      expect(fixture.state().accountId).toBe(before.accountId);
      expect(fixture.state().data!.chats.byPeer[before.accountId].messages[0].text).toBe('current only');
    } finally { fixture.close(); }
  });
  it('keeps histories separate and reopens the child after lock and a cold restart', async () => {
    const run = crypto.randomUUID(), factory = new IDBFactory();
    let fixture = await openProfileChatBrowserCheck(run,factory);
    try {
      const legacy = fixture.state().profile!, incoming = fixture.state().registry.profiles.find(p => p.role === 'incoming')!;
      await fixture.addSaved('legacy only');
      expect(await fixture.switchProfile(incoming.id,'wrong')).toBe(false); expect(fixture.state().profile!.id).toBe(legacy.id);
      expect(await fixture.switchProfile(incoming.id,PROFILE_CHAT_TEST_PASSWORD)).toBe(true);
      expect(fixture.state().data!.chats.order).toHaveLength(0); await fixture.addSaved('incoming only');
      await fixture.lock(); expect(fixture.state().accountId).toBe('');
      expect(await fixture.unlock(PROFILE_CHAT_TEST_PASSWORD)).toBe(true); expect(fixture.state().profile!.id).toBe(incoming.id);
      fixture.close(); fixture = await openProfileChatBrowserCheck(run,factory);
      expect(fixture.state().profile!.id).toBe(incoming.id);
      expect(fixture.state().data!.chats.byPeer[incoming.accountId].messages.map(m => m.text)).toEqual(['incoming only']);
      await fixture.switchProfile(legacy.id,PROFILE_CHAT_TEST_PASSWORD);
      expect(fixture.state().data!.chats.byPeer[legacy.accountId].messages.map(m => m.text)).toEqual(['legacy only']);
      const main = fixture.state().registry.profiles[0]; await fixture.switchProfile(main.id,PROFILE_CHAT_TEST_PASSWORD);
      expect(fixture.state().network).toBe(false); expect((await fixture.inbox()).totalChats).toBe(0);
    } finally { fixture.close(); }
  });
  it('does not adopt when the previous archive cannot be saved', async () => {
    const fixture = await openProfileChatBrowserCheck(crypto.randomUUID(),new IDBFactory());
    try {
      const previous = fixture.state().accountId, incoming = fixture.state().registry.profiles.find(p => p.role === 'incoming')!;
      const write = vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(() => { throw new DOMException('full','QuotaExceededError'); });
      await expect(fixture.switchProfile(incoming.id,PROFILE_CHAT_TEST_PASSWORD)).rejects.toThrow('full'); write.mockRestore();
      expect(fixture.state().accountId).toBe(previous);
    } finally { fixture.close(); }
  });
  it('never opens a user vault, production chat database, or core database', async () => {
    const factory = new IDBFactory(), run = crypto.randomUUID(), spy = vi.spyOn(factory,'open');
    const fixture = await openProfileChatBrowserCheck(run,factory);
    try {
      await fixture.addSaved('public fixture'); const next = fixture.state().registry.profiles.find(p => p.role === 'outgoing')!;
      await fixture.switchProfile(next.id,PROFILE_CHAT_TEST_PASSWORD); await fixture.lock(); await fixture.unlock(PROFILE_CHAT_TEST_PASSWORD);
      expect(spy.mock.calls.every(([name]) => name === 'automesh-profile-check-v1-' + run ||
        name === 'automesh-profile-check-v1-' + run + '-selection' || name === 'automesh-profile-chat-check-v1-' + run)).toBe(true);
    } finally { fixture.close(); }
    await expect(fixture.unlock(PROFILE_CHAT_TEST_PASSWORD)).rejects.toThrow('test_session_closed');
  });
});
