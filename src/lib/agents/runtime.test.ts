import { describe, expect, it, vi } from 'vitest';
import { incomingAgentPrompt, incomingNativeAgentPrompt, formatAgentReply, AGENT_REPLY_DETAILS, type NativeAgentEvent } from './runtime';
import { isFreshIncoming, notifyCommittedIncoming, type CommittedIncoming } from '$lib/chat/committed-incoming';
import { emptySessionChats, ensureConversation, receiveMessage, setContactState, updateConversation, type ChatEntry } from '$lib/chat/session-chats';
import { encodeChatContent } from '$lib/chat/message-details';
import { MAX_RADIO_TEXT_BYTES } from '$lib/radio/crypto';
import { CHANNEL_TEXT_BYTES, channelText, type NativeChannel } from '$lib/radio/native-channels';

const peer = 'peer', owner = 'owner', id = 'message';
const accepted = () => setContactState(ensureConversation(emptySessionChats(), peer), peer, 'accepted');
const message: ChatEntry = { id, from: peer, timestamp: 1, direction: 'incoming', text: 'Привет!', details: { allowForwardAttribution: true } };
const saved = (extra: Partial<ChatEntry> = {}) => receiveMessage(accepted(), { ...message, ...extra });

describe('committed chat events for AI', () => {
  it.each(['direct', 'mailbox', 'courier', 'radio'] as const)('accepts ordinary text from %s', transport => {
    const event = { peer, id, transport };
    expect(incomingAgentPrompt(saved(), owner, peer, event)).toBe('Привет!');
    expect(incomingAgentPrompt(saved(), owner, 'different', event)).toBeNull();
    expect(incomingAgentPrompt(saved(), owner, peer, { ...event, id: 'other' })).toBeNull();
  });
  it.each([{ direction: 'outgoing' }, { text: '[AI] Привет!' }, { text: '  ' }, { importedFromDevice: true }, { deviceMessage: true }, { restoredFromBackup: true }, { details: { ephemeral: { seconds: 10, allowDownload: false } } }])('does not dispatch non-eligible data: %j', extra => {
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
  it('only runs a committed channel command from the exact board and packet ID', () => {
    const event: NativeAgentEvent = { transport: 'native-radio', peer: 'radio:100:' + 'a'.repeat(64), from: 200, id: 5, epoch: 1 };
    const channel: NativeChannel = { key: 'a'.repeat(64), node: 100, index: 0, public: true, name: '', signature: true, unread: 0,
      messages: [{ from: 200, id: 5, text: '/ai Как дела?\n[Automesh](https://automesh.online/)', name: '', outgoing: false, timestamp: 1, status: 'accepted' }] };
    expect(incomingNativeAgentPrompt(channel, event)).toBe('Как дела?');
    expect(incomingNativeAgentPrompt(channel, { ...event, from: 201 })).toBeNull();
    expect(incomingNativeAgentPrompt({ ...channel, deleted: ['200:5'] }, event)).toBeNull();
    for (const text of ['Привет!', '/air шум', '/ai', '[AI] /ai эхо']) {
      expect(incomingNativeAgentPrompt({ ...channel, messages: [{ ...channel.messages[0], text }] }, event)).toBeNull();
    }
    expect(incomingNativeAgentPrompt({ ...channel, messages: [{ ...channel.messages[0], outgoing: true, status: 'failed' }] }, event)).toBeNull();
  });
  it('fits Unicode responses to the native channel byte limit and preserves the AI label', () => {
    const reply = formatAgentReply('Проверка 😀 '.repeat(60), 'native-radio');
    expect(reply.startsWith('[AI] ')).toBe(true);
    expect(reply.endsWith('😀') || reply.endsWith('Проверка')).toBe(true);
    expect(new TextEncoder().encode(reply).length).toBeLessThanOrEqual(CHANNEL_TEXT_BYTES);
    expect(channelText(reply, false, '')).toBe(reply);
  });
});
