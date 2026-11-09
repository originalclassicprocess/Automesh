import { describe, expect, it } from 'vitest';
import { cleanedHistory, formatBytes, managedFiles } from './storage-summary';
import type { LocalChatData } from '$lib/chat/local-store';
import { emptySessionChats, ensureConversation, updateConversation } from '$lib/chat/session-chats';
describe('storage dashboard without secrets', () => {
  it('cleans an old durable archive without writing new untrusted messages or dropping settings', () => {
    const data: LocalChatData = { selfNickname: 'Old', readReceiptsEnabled: false, autoLockMinutes: 5, aliases: { peer: 'Friend' },
      declaredNames: {}, peerReadPreferences: {}, peerPublicKeys: {}, chats: { order: ['peer'], byPeer: { peer: { contact: 'blocked', messages: [
        { id: 'a', from: 'peer', timestamp: 1, text: '', direction: 'incoming', fileStatus: 'ready',
          file: { id: 'a', name: 'old.png', mime: 'image/png', size: 10, sha256: 'a'.repeat(64) } },
        { id: 'b', from: 'peer', timestamp: 2, text: 'old text', direction: 'incoming' },
      ] } } } };
    const selected = cleanedHistory(data, ['peer:a']);
    expect(selected.chats.byPeer.peer.messages[0]).toMatchObject({ fileDeleted: true, fileStatus: 'canceled' });
    expect(selected.chats.byPeer.peer.messages[1].text).toBe('old text');
    expect(data.chats.byPeer.peer.messages[0].fileStatus).toBe('ready');
    const cleared = cleanedHistory(data); expect(cleared.chats.byPeer.peer.messages).toEqual([]);
    expect(cleared.aliases).toEqual({ peer: 'Friend' }); expect(cleared.chats.byPeer.peer.contact).toBe('blocked');
    expect(cleared.autoLockMinutes).toBe(5);
  });
  it('matches only current account file records and distinguishes disk/memory/orphans', () => {
    let state = ensureConversation(emptySessionChats(), 'peer');
    state = updateConversation(state, 'peer', c => ({ ...c, messages: [{ id: 'image', from: 'peer', text: '', timestamp: 1,
      direction: 'incoming', file: { id: 'image', name: 'photo.png', mime: 'image/png', size: 10, sha256: 'a'.repeat(64) } }] }));
    const files = managedFiles(state, { historyBytes: 100, otherAccountBytes: 1000, allFileBytes: 1090,
      files: [{ id: 'peer:image', bytes: 38 }, { id: 'orphan', bytes: 52 }] }, new Map([['peer:image', new Uint8Array(10)]]));
    expect(files).toHaveLength(2); expect(files[0]).toMatchObject({ name: 'photo.png', category: 'image', bytes: 38, memoryBytes: 10 });
    expect(files[1]).toMatchObject({ name: 'Файл вне истории', category: 'other', peer: '' });
    expect(files).not.toContainEqual(expect.objectContaining({ bytes: 1000 }));
  });
  it('formats payload size without claiming to measure physical RAM', () => {
    expect(formatBytes(0)).toBe('0 Б'); expect(formatBytes(1024)).toBe('1.0 КБ');
    expect(formatBytes(1048576)).toBe('1.0 МБ'); expect(formatBytes(NaN)).toBe('Неизвестно');
  });
});
