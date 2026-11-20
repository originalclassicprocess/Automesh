import { describe, expect, it, vi } from 'vitest';
import { incomingAgentPrompt, formatAgentReply, AGENT_REPLY_DETAILS } from './runtime';
import { isFreshIncoming, notifyCommittedIncoming, type CommittedIncoming } from '$lib/chat/committed-incoming';
import { emptySessionChats, ensureConversation, receiveMessage, setContactState, updateConversation, type ChatEntry } from '$lib/chat/session-chats';
import { encodeChatContent } from '$lib/chat/message-details';
import { MAX_RADIO_TEXT_BYTES } from '$lib/radio/crypto';

const peer = 'peer', owner = 'owner', id = 'message';
const accepted = () => setContactState(ensureConversation(emptySessionChats(), peer), peer, 'accepted');
const message: ChatEntry = { id, from: peer, timestamp: 1, direction: 'incoming', text: '/ai hello', details: { allowForwardAttribution: true } };
const saved = (extra: Partial<ChatEntry> = {}) => receiveMessage(accepted(), { ...message, ...extra });

describe('committed chat events for AI', () => {
  it.each(['direct', 'mailbox', 'courier', 'radio'] as const)('accepts the same explicit command from %s', transport => {
    const event = { peer, id, transport };
    expect(incomingAgentPrompt(saved(), owner, peer, event)).toBe('hello');
    expect(incomingAgentPrompt(saved(), owner, 'different', event)).toBeNull();
    expect(incomingAgentPrompt(saved(), owner, peer, { ...event, id: 'other' })).toBeNull();
  });
  it.each([{ direction: 'outgoing' }, { text: '[AI] /ai hello' }, { importedFromDevice: true }, { deviceMessage: true }, { restoredFromBackup: true }, { details: { ephemeral: { seconds: 10, allowDownload: false } } }])('does not dispatch non-eligible data: %j', extra => {
    const chats = updateConversation(accepted(), peer, c => ({ ...c, messages: [{ ...message, ...extra } as ChatEntry] }));
    expect(incomingAgentPrompt(chats, owner, peer, { peer, id, transport: 'direct' })).toBeNull();
  });
  it('detects duplicates, deleted IDs and blocked contacts before dispatch', () => {
    expect(isFreshIncoming(accepted(), peer, id)).toBe(true);
    expect(isFreshIncoming(saved(), peer, id)).toBe(false);
    const deleted = updateConversation(accepted(), peer, c => ({ ...c, deletedIds: [id] }));
    expect(isFreshIncoming(deleted, peer, id)).toBe(false);
    expect(isFreshIncoming(setContactState(accepted(), peer, 'blocked'), peer, id)).toBe(false);
  });
  it('never lets an optional consumer break receipt handling', () => {
    const event: CommittedIncoming = { peer, id, transport: 'radio' };
    const callback = vi.fn(() => { throw new Error('optional listener failed'); });
    expect(() => notifyCommittedIncoming(callback, event)).not.toThrow();
    expect(callback).toHaveBeenCalledWith(event);
  });
  it('fits labeled multibyte, escaped text into the real LoRa envelope', () => {
    const fitted = formatAgentReply('🙂"\\я'.repeat(200), 'radio');
    expect(fitted.startsWith('[AI] ')).toBe(true);
    expect(new TextEncoder().encode(encodeChatContent(fitted, AGENT_REPLY_DETAILS)).length).toBeLessThanOrEqual(MAX_RADIO_TEXT_BYTES);
    expect(fitted).not.toContain('\ufffd');
    expect(formatAgentReply('hello', 'courier')).toBe('[AI] hello');
  });
});
