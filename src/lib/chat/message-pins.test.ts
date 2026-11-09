import { describe, expect, it } from 'vitest';
import { encodeAccountId } from '$lib/addressing/bech32m.js';
import { decodeChatContent, encodeChatContent, normalizeMessageDetails, RICH_PREFIX } from './message-details';
import { messagePins, nextPinRevision, visibleChatMessages } from './message-pins';
import { normalizeFileOffer } from './file-transfer';
import { emptySessionChats, receiveMessage, recordSentMessage, restoreChats, saveChats, unreadMessageCount, firstUnreadMessageId, type ChatEntry } from './session-chats';
import { conversationPreview } from './conversation-list';
const alice = encodeAccountId(new Uint8Array(20).fill(1)), bob = encodeAccountId(new Uint8Array(20).fill(2)), stranger = encodeAccountId(new Uint8Array(20).fill(3));
const id = '11111111-1111-4111-8111-111111111111';
const original: ChatEntry = { id, text: 'message', from: alice, direction: 'outgoing', timestamp: 1 };
const control = (from: string, targetId: string | null, revision: number, direction: ChatEntry['direction'] = 'outgoing'): ChatEntry => ({
  id: crypto.randomUUID(), from, direction, text: '', timestamp: Date.now(), details: { pin: { targetId, revision } }, delivery: 'queued' });
describe('shared participant-owned pins', () => {
  it('strictly roundtrips the control through existing rich content', () => {
    const details = { pin: { targetId: id, revision: 1 } };
    expect(decodeChatContent(encodeChatContent('', details))).toEqual({ text: '', details });
    for (const pin of [{ targetId: 'fake', revision: 1 }, { targetId: id, revision: 0 }, { targetId: id, revision: 1.5 }, { targetId: id, revision: 1, owner: bob }])
      expect(normalizeMessageDetails({ pin })).toBeNull();
    expect(normalizeMessageDetails({ pin: details.pin, forwarded: { sourceId: id } })).toBeNull();
    expect(() => encodeChatContent('hidden body', details)).toThrow('invalid_pin_content');
    expect(decodeChatContent(RICH_PREFIX + JSON.stringify({ text: 'hidden body', details }))).toBeNull();
    expect(normalizeFileOffer({ id, name: 'x.txt', mime: 'text/plain', size: 1, sha256: 'a'.repeat(64), details })).toBeNull();
  });
  it('holds one independent slot per authenticated participant', () => {
    const messages = [original, control(alice, id, 1), control(bob, id, 1, 'incoming'), control(alice, '22222222-2222-4222-8222-222222222222', 2)];
    const pins = messagePins(messages, alice, bob);
    expect(pins).toHaveLength(2); expect(pins.find(pin => pin.actor === bob)?.targetId).toBe(id);
    expect(pins.find(pin => pin.actor === alice)?.revision).toBe(2);
    expect(nextPinRevision(messages, alice, bob)).toBe(3);
  });
  it('ignores delayed older controls, converges on ties, and keeps unpin tombstones', () => {
    const old = control(bob, id, 1, 'incoming'), unpin = control(bob, null, 2, 'incoming');
    expect(messagePins([unpin, old, old], alice, bob)[0].targetId).toBeNull();
    const a = control(alice, id, 3), b = control(alice, null, 3);
    expect(messagePins([a, b], alice, bob)).toEqual(messagePins([b, a], alice, bob));
  });
  it('cannot take another participant slot or turn a pin into an ordinary message', () => {
    const fake = control(stranger, id, 99, 'incoming'), forgedDirection = control(alice, id, 99, 'incoming');
    expect(messagePins([fake, forgedDirection, { ...control(bob, id, 99, 'incoming'), text: 'bad' }], alice, bob)).toEqual([]);
  });
  it('is durable, but never appears as an empty bubble, unread message or download selection', () => {
    let state = recordSentMessage(emptySessionChats(), bob, original);
    state = recordSentMessage(state, bob, control(alice, id, 1));
    state = receiveMessage(state, control(bob, id, 1, 'incoming'));
    state = restoreChats(saveChats(state)); const messages = state.byPeer[bob].messages;
    expect(messagePins(messages, alice, bob)).toHaveLength(2);
    expect(visibleChatMessages(messages)).toEqual([original]);
    expect(unreadMessageCount(messages)).toBe(0); expect(firstUnreadMessageId(messages)).toBeUndefined();
    expect(conversationPreview(state.byPeer[bob])).toBe('Вы: message');
  });
});
