import type { CommittedIncoming } from '$lib/chat/committed-incoming';
import type { SessionChats } from '$lib/chat/session-chats';
import { encodeChatContent, type MessageDetails } from '$lib/chat/message-details';
import { MAX_RADIO_TEXT_BYTES } from '$lib/radio/crypto';
import { CHANNEL_TEXT_BYTES, nativeMessageKey, type NativeChannel } from '$lib/radio/native-channels';
export const AGENT_REPLY_DETAILS: MessageDetails = { allowForwardAttribution: false };
export const AGENT_QUEUE_SIZE = 32;
export type NativeAgentEvent = { transport: 'native-radio'; peer: string; from: number; id: number; epoch: number };
export type AgentEvent = CommittedIncoming | NativeAgentEvent;

export function radioAgentCommand(text: string): string | null {
  const command = /^\/ai\s+([\s\S]+)$/i.exec(text.trim());
  return command?.[1].replace(/\n\[Automesh\]\(\S+\)$/u, '').trim() || null;
}

export function incomingNativeAgentPrompt(channel: NativeChannel | undefined, event: NativeAgentEvent): string | null {
  if (!channel || channel.deleted?.includes(nativeMessageKey(event))) return null;
  const entry = channel.messages.find(message => message.id === event.id && message.from === event.from);
  return entry && (!entry.outgoing || entry.status === 'accepted' || entry.status === 'mesh') ? radioAgentCommand(entry.text) : null;
}

// The event is a reference into the current account, not a second source of
// plaintext. Only an explicitly permitted, accepted peer can invoke the model.
export function incomingAgentPrompt(chats: SessionChats, owner: string, allowedPeer: string, event: CommittedIncoming): string | null {
  if (!allowedPeer || event.peer !== allowedPeer || event.peer === owner) return null;
  const conversation = chats.byPeer[event.peer];
  if (conversation?.contact !== 'accepted' || conversation.deletedIds?.includes(event.id)) return null;
  const entry = conversation.messages.find(message => message.id === event.id);
  if (!entry || entry.direction !== 'incoming' || entry.from !== event.peer || entry.file || entry.localCall ||
      entry.restoredFromBackup || entry.importedFromDevice || entry.deviceMessage ||
      !Object.keys(entry.details ?? {}).every(key => key === 'allowForwardAttribution' || key === 'reply')) return null;
  const text = entry.text.trim();
  if (!text || /^\[ai\]/i.test(text)) return null;
  return Array.from(text).slice(0, 1200).join('');
}

export function formatAgentReply(reply: string, transport: AgentEvent['transport']): string {
  const text = `[AI] ${reply.trim()}`;
  if (transport !== 'radio' && transport !== 'native-radio') return text;
  // Limit the encoded envelope, not JS characters. Never split a surrogate pair.
  const encoder = new TextEncoder();
  let fitted = '';
  for (const char of text) {
    const candidate = fitted + char;
    const wire = transport === 'radio' ? encodeChatContent(candidate, AGENT_REPLY_DETAILS) : candidate;
    if (encoder.encode(wire).length > (transport === 'radio' ? MAX_RADIO_TEXT_BYTES : CHANNEL_TEXT_BYTES)) break;
    fitted += char;
  }
  if (transport === 'native-radio' && fitted.length < text.length && !/\s/u.test(text[fitted.length] ?? '')) {
    const boundary = fitted.trimEnd().search(/\s+\S*$/u);
    if (boundary > '[AI] '.length) return fitted.slice(0, boundary).trimEnd();
  }
  return fitted.trimEnd();
}
