import { describe, expect, it } from 'vitest';

import {
  emptySessionChats,
  firstUnreadMessageId,
  receiveMessage,
  receiveFileMessage,
  recordSentMessage,
  setContactState,
  setDeliveryStatus,
  setReadState,
  restoreChats,
  saveChats,
  selectConversation,
  updateConversation,
  unreadMessageCount,
} from './session-chats';

describe('session conversations', () => {
  it('repairs only an authenticated empty legacy file placeholder and resets its false read state', () => {
    const file = { id: 'file', name: 'gif.gif', mime: 'image/gif', size: 12, sha256: '0'.repeat(64) };
    let state = receiveMessage(emptySessionChats(), { id: 'file', from: 'peer', text: '', timestamp: 1, direction: 'incoming', readState: 'sent' });
    state = receiveFileMessage(state, { id: 'file', from: 'peer', text: '', timestamp: 1, direction: 'incoming', file, fileStatus: 'offered', courierVia: 'node' });
    expect(state.byPeer.peer.messages).toHaveLength(1);
    expect(state.byPeer.peer.messages[0].file).toEqual(file);
    expect(state.byPeer.peer.messages[0].readState).toBeUndefined();
    expect(state.byPeer.peer.unread).toBe(1);
    expect(receiveFileMessage(state, { ...state.byPeer.peer.messages[0], file })).toBe(state);
    const deleted = updateConversation(state, 'peer', conversation => ({ ...conversation, deletedIds: ['file'] }));
    expect(receiveFileMessage(deleted, { ...state.byPeer.peer.messages[0], file })).toBe(deleted);
    expect(() => receiveFileMessage(state, { ...state.byPeer.peer.messages[0], file: { ...file, name: 'other.gif' } })).toThrow('conflicting');
    for (const original of [{ text: 'real text' }, { text: '', details: { contactCard: { accountId: 'a', nickname: 'A' } } },
      { text: '', details: { pin: { targetId: 'x', revision: 1 } } }, { text: '', direction: 'outgoing' as const }]) {
      const other = receiveMessage(emptySessionChats(), { id: 'file', from: 'peer', timestamp: 1, direction: 'incoming', ...original });
      expect(() => receiveFileMessage(other, { id: 'file', from: 'peer', text: '', timestamp: 1, direction: 'incoming', file })).toThrow('conflicting');
    }
  });
  it('restores falsely acknowledged unfinished outgoing files as queued, without downgrading completed files or text', () => {
    let state = recordSentMessage(emptySessionChats(), 'peer', { id: 'file', from: 'me', text: '', timestamp: 1, direction: 'outgoing',
      delivery: 'read', fileStatus: 'offered', file: { id: 'file', name: 'gif.gif', mime: 'image/gif', size: 12, sha256: '0'.repeat(64) } });
    state = recordSentMessage(state, 'peer', { ...state.byPeer.peer.messages[0], id: 'ready', fileStatus: 'ready' });
    state = recordSentMessage(state, 'peer', { id: 'text', from: 'me', text: 'hello', timestamp: 1, direction: 'outgoing', delivery: 'read' });
    state = recordSentMessage(state, 'peer', { ...state.byPeer.peer.messages[0], id: 'deleted', fileDeleted: true });
    const restored = restoreChats(saveChats(state));
    expect(restored.byPeer.peer.messages.map(m => m.delivery)).toEqual(['queued', 'read', 'read', 'read']);
  });
  it('keeps personal messages and drafts separate', () => {
    let state = selectConversation(emptySessionChats(), 'rAlice');
    state = updateConversation(state, 'rAlice', (chat) => ({ ...chat, draft: 'for Alice' }));
    state = selectConversation(state, 'rBob');
    state = updateConversation(state, 'rBob', (chat) => ({ ...chat, draft: 'for Bob' }));
    state = recordSentMessage(state, 'rBob', {
      id: 'out-1', text: 'hello Bob', from: 'rMe', timestamp: 1, direction: 'outgoing',
    });
    state = receiveMessage(state, {
      id: 'in-1', text: 'hello', from: 'rAlice', timestamp: 2, direction: 'incoming',
    });

    expect(state.byPeer.rAlice.draft).toBe('for Alice');
    expect(state.byPeer.rBob.draft).toBe('for Bob');
    expect(state.byPeer.rAlice.messages.map((message) => message.text)).toEqual(['hello']);
    expect(state.byPeer.rBob.messages.map((message) => message.text)).toEqual(['hello Bob']);
    expect(state.byPeer.rAlice.unread).toBe(1);
    expect(state.byPeer.rBob.unread).toBe(0);
    expect(state.byPeer.rAlice.contact).toBe('pending');
    expect(state.byPeer.rBob.contact).toBe('outgoing');

    state = selectConversation(state, 'rAlice');
    expect(state.byPeer.rAlice.unread).toBe(1);
    expect(state.order).toEqual(['rAlice', 'rBob']);
  });

  it('creates a conversation for an unexpected incoming peer', () => {
    const state = receiveMessage(emptySessionChats(), {
      id: 'in-2', text: 'hi', from: 'rCharlie', timestamp: 3, direction: 'incoming',
    });
    expect(state.order).toEqual(['rCharlie']);
    expect(state.byPeer.rCharlie.unread).toBe(1);
  });

  it('restores history without carrying over online state, preserving unread messages', () => {
    let state = receiveMessage(emptySessionChats(), {
      id: 'in-3', text: 'saved', from: 'rAlice', timestamp: 4, direction: 'incoming',
    });
    state = updateConversation(state, 'rAlice', (chat) => ({ ...chat, connection: 'connected' }));
    const restored = restoreChats(saveChats(state));
    expect(restored.byPeer.rAlice.messages[0].text).toBe('saved');
    expect(restored.byPeer.rAlice.connection).toBe('offline');
    expect(restored.byPeer.rAlice.unread).toBe(1);
  });

  it('restores pending sends as queued and deduplicates incoming retries', () => {
    let state = recordSentMessage(emptySessionChats(), 'rAlice', {
      id: 'out-queued', text: 'later', from: 'rMe', timestamp: 1,
      direction: 'outgoing', delivery: 'sending',
    });
    state = restoreChats(saveChats(state));
    expect(state.byPeer.rAlice.messages[0].delivery).toBe('queued');
    state = setDeliveryStatus(state, 'rAlice', 'out-queued', 'sent');
    state = setDeliveryStatus(state, 'rAlice', 'out-queued', 'delivered');
    state = setDeliveryStatus(state, 'rAlice', 'out-queued', 'sent');
    expect(state.byPeer.rAlice.messages[0].delivery).toBe('delivered');

    const incoming = { id: 'repeat', text: 'once', from: 'rAlice', timestamp: 2, direction: 'incoming' as const };
    state = receiveMessage(state, incoming);
    state = receiveMessage(state, incoming);
    expect(state.byPeer.rAlice.messages.filter((message) => message.id === incoming.id)).toHaveLength(1);
    expect(state.byPeer.rAlice.unread).toBe(1);
  });

  it('persists accepted contacts and read state without reopening legacy requests', () => {
    let state = receiveMessage(emptySessionChats(), {
      id: 'first', text: 'request', from: 'rAlice', timestamp: 1, direction: 'incoming',
    });
    expect(state.byPeer.rAlice.contact).toBe('pending');
    state = setContactState(state, 'rAlice', 'accepted');
    state = setReadState(state, 'rAlice', 'first', 'pending');
    const restored = restoreChats(saveChats(state));
    expect(restored.byPeer.rAlice.contact).toBe('accepted');
    expect(restored.byPeer.rAlice.messages[0].readState).toBe('pending');

    const legacy = restoreChats({
      order: ['rBob'], byPeer: { rBob: { messages: [
        { id: 'old', text: 'existing', from: 'rBob', timestamp: 2, direction: 'incoming' },
      ] } },
    });
    expect(legacy.byPeer.rBob.contact).toBe('accepted');
  });

  it('never downgrades a read status to delivered', () => {
    let state = recordSentMessage(emptySessionChats(), 'rAlice', {
      id: 'sent', text: 'hello', from: 'rMe', timestamp: 1, direction: 'outgoing', delivery: 'sent',
    });
    state = setDeliveryStatus(state, 'rAlice', 'sent', 'read');
    state = setDeliveryStatus(state, 'rAlice', 'sent', 'delivered');
    expect(state.byPeer.rAlice.messages[0].delivery).toBe('read');
  });

  it('counts unseen incoming messages until each is actually marked visible', () => {
    let state = selectConversation(emptySessionChats(), 'rAlice');
    state = receiveMessage(state, {
      id: 'first', text: 'first', from: 'rAlice', timestamp: 1, direction: 'incoming',
    });
    state = receiveMessage(state, {
      id: 'second', text: 'second', from: 'rAlice', timestamp: 2, direction: 'incoming',
    });
    state = recordSentMessage(state, 'rAlice', {
      id: 'out', text: 'reply', from: 'rMe', timestamp: 3, direction: 'outgoing',
    });
    expect(state.byPeer.rAlice.unread).toBe(2);
    expect(firstUnreadMessageId(state.byPeer.rAlice.messages)).toBe('first');
    state = setReadState(state, 'rAlice', 'first', 'waiting');
    expect(state.byPeer.rAlice.unread).toBe(1);
    expect(firstUnreadMessageId(state.byPeer.rAlice.messages)).toBe('second');
    state = restoreChats(saveChats(state));
    expect(state.byPeer.rAlice.unread).toBe(1);
    state = setReadState(state, 'rAlice', 'second', 'skipped');
    expect(state.byPeer.rAlice.unread).toBe(0);
    expect(firstUnreadMessageId(state.byPeer.rAlice.messages)).toBeUndefined();
    expect(unreadMessageCount(state.byPeer.rAlice.messages)).toBe(0);
  });
});
