import { describe, expect, it } from 'vitest';
import { encodeAccountId } from '$lib/addressing/bech32m.js';
import { decodeChatContent, encodeChatContent, normalizeMessageDetails } from './message-details';
import { emptySessionChats, receiveMessage, recordSentMessage, restoreChats, saveChats, type ChatEntry } from './session-chats';
import { displayedReply, forwardingDetails, removeMessages, replyCount, replyReference, savedConversation, transcript } from './chat-actions';
const self = encodeAccountId(new Uint8Array(20).fill(1));
const peer = encodeAccountId(new Uint8Array(20).fill(2));
const id = '11111111-1111-4111-8111-111111111111';
const entry: ChatEntry = { id, from: self, text: 'hello', timestamp: 1, direction: 'outgoing' };
describe('chat actions and bounded encrypted metadata', () => {
  it('keeps Saved connected locally, first and accepted after restore', () => {
    let state = savedConversation(emptySessionChats(), self);
    state = recordSentMessage(state, self, { ...entry, delivery: 'delivered' });
    state = savedConversation(restoreChats(saveChats(state)), self);
    expect(state.order).toEqual([self]); expect(state.byPeer[self].contact).toBe('accepted');
    expect(state.byPeer[self].connection).toBe('connected'); expect(state.byPeer[self].messages).toHaveLength(1);
  });
  it('roundtrips replies, contacts and privacy flags and still reads legacy text', () => {
    const details = { reply: replyReference(entry), contactCard: { accountId: peer, nickname: 'Bob' }, allowForwardAttribution: false };
    expect(decodeChatContent(encodeChatContent('answer', details))).toEqual({ text: 'answer', details });
    expect(decodeChatContent(encodeChatContent('legacy'))).toEqual({ text: 'legacy' });
    expect(replyCount([entry, { ...entry, id: crypto.randomUUID(), details }], id)).toBe(1);
  });
  it('rejects malformed IDs, oversized quotes, cards, booleans and content', () => {
    expect(normalizeMessageDetails({ reply: { ...replyReference(entry), id: 'no' } })).toBeNull();
    expect(normalizeMessageDetails({ reply: { ...replyReference(entry), preview: 'x'.repeat(281) } })).toBeNull();
    expect(normalizeMessageDetails({ forwarded: { sourceId: id, author: { accountId: 'fake', nickname: 'Alice' } } })).toBeNull();
    expect(normalizeMessageDetails({ allowForwardAttribution: 'yes' })).toBeNull();
    expect(() => encodeChatContent('x'.repeat(65536), { allowForwardAttribution: false })).toThrow('message_too_large');
    expect(decodeChatContent(encodeChatContent('legacy', { allowForwardAttribution: true }))).toEqual({ text: 'legacy' });
    expect(displayedReply([entry], { id, from: peer, preview: 'forged quote' })).toEqual(replyReference(entry));
  });
  it('strips hidden authors, keeps hidden attribution across repeated forwards, omits cross-chat quotes', () => {
    const author = { accountId: self, nickname: 'Alice' };
    const hidden = forwardingDetails({ ...entry, details: { reply: replyReference(entry) } }, author, false, self);
    expect(hidden.forwarded?.author).toBeUndefined(); expect(hidden.reply).toBeUndefined();
    expect(forwardingDetails({ ...entry, from: peer, details: hidden }, author, true, self).forwarded?.author).toBeUndefined();
    expect(forwardingDetails(entry, author, true, self).forwarded?.author).toEqual(author);
  });
  it('local deletion tombstones stop retransmission resurrection after reload', () => {
    let state = receiveMessage(emptySessionChats(), { ...entry, from: peer, direction: 'incoming' });
    state = removeMessages(state, peer, [id]); state = restoreChats(saveChats(state));
    state = receiveMessage(state, { ...entry, from: peer, direction: 'incoming' });
    expect(state.byPeer[peer].messages).toEqual([]); expect(state.byPeer[peer].unread).toBe(0);
  });
  it('exports selected text literally, not executable HTML', () => {
    expect(transcript([{ ...entry, text: '<script>bad</script>' }])).toContain('<script>bad</script>');
  });
});
