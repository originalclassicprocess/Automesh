import type { CommittedIncoming } from '$lib/chat/committed-incoming';
import type { SessionChats } from '$lib/chat/session-chats';
import { encodeChatContent, type MessageDetails } from '$lib/chat/message-details';
import { MAX_RADIO_TEXT_BYTES } from '$lib/radio/crypto';
import { commandPrompt } from './model';

export const MAX_AUTOMATIC_REQUESTS = 20;
export const AUTOMATIC_COOLDOWN_MS = 15000;
export const AGENT_REPLY_DETAILS: MessageDetails = { allowForwardAttribution: false };

// The event is a reference into the current account, not a second source of
// plaintext. Only an explicitly permitted, accepted peer can invoke the model.
export function incomingAgentPrompt(chats: SessionChats, owner: string, allowedPeer: string, event: CommittedIncoming): string | null {
  if (!allowedPeer || event.peer !== allowedPeer || event.peer === owner) return null;
  const conversation = chats.byPeer[event.peer];
  if (conversation?.contact !== 'accepted' || conversation.deletedIds?.includes(event.id)) return null;
  const entry = conversation.messages.find(message => message.id === event.id);
  if (!entry || entry.direction !== 'incoming' || entry.from !== event.peer || entry.file || entry.localCall ||
      entry.restoredFromBackup || entry.importedFromDevice || entry.deviceMessage ||
      !Object.keys(entry.details ?? {}).every(key => key === 'allowForwardAttribution')) return null;
  return commandPrompt(entry.text);
}

export function formatAgentReply(reply: string, transport: CommittedIncoming['transport']): string {
  const text = `[AI] ${reply.trim()}`;
  if (transport !== 'radio') return text;
  // Limit the encoded envelope, not JS characters. Never split a surrogate pair.
  const encoder = new TextEncoder();
  let fitted = '';
  for (const char of text) {
    if (encoder.encode(encodeChatContent(fitted + char, AGENT_REPLY_DETAILS)).length > MAX_RADIO_TEXT_BYTES) break;
    fitted += char;
  }
  return fitted.trimEnd();
}
