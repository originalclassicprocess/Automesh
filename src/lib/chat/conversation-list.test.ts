import { describe, expect, it } from 'vitest';
import { conversationPreview, submitOnEnter, visibleConversations } from './conversation-list';
import { emptySessionChats, receiveMessage, selectConversation } from './session-chats';

describe('conversation list and keyboard input', () => {
  it('sorts by last activity, filters by name or address and keeps the stored order intact', () => {
    let state = selectConversation(emptySessionChats(), 'alice');
    state = receiveMessage(state, { id: '1', from: 'alice', text: 'hello', timestamp: 1, direction: 'incoming' });
    state = receiveMessage(state, { id: '2', from: 'bob', text: 'newer', timestamp: 2, direction: 'incoming' });
    const name = (peer: string) => peer === 'bob' ? 'Борис' : 'Алиса';
    expect(visibleConversations(state, '', name)).toEqual(['bob', 'alice']);
    expect(visibleConversations(state, ' БОР ', name)).toEqual(['bob']);
    expect(visibleConversations(state, 'alice', name)).toEqual(['alice']);
    expect(visibleConversations(state, 'nobody', name)).toEqual([]);
    expect(state.order).toEqual(['alice', 'bob']);
    expect(conversationPreview(state.byPeer.bob)).toBe('newer');
  });
  it('submits Enter but leaves Shift+Enter and IME confirmation to the input', () => {
    const event = { key: 'Enter', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, isComposing: false };
    expect(submitOnEnter(event)).toBe(true);
    expect(submitOnEnter({ ...event, shiftKey: true })).toBe(false);
    expect(submitOnEnter({ ...event, isComposing: true })).toBe(false);
    expect(submitOnEnter({ ...event, key: 'a' })).toBe(false);
  });
  it('pins Saved consistently for owner and linked-device views without changing stored order', () => {
    let state = selectConversation(emptySessionChats(), 'saved');
    state = receiveMessage(state, { id: '1', from: 'older', text: 'Old', timestamp: 10, direction: 'incoming' });
    state = receiveMessage(state, { id: '2', from: 'newer', text: 'New', timestamp: 20, direction: 'incoming' });
    expect(visibleConversations(state, '', peer => peer, 'saved')).toEqual(['saved','newer','older']);
    expect(visibleConversations(state, 'new', peer => peer, 'saved')).toEqual(['newer']);
    expect(state.order).toEqual(['saved','older','newer']);
  });
});
