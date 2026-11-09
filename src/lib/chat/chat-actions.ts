import { updateConversation, type ChatEntry, type SessionChats } from './session-chats';
import type { ContactCard, MessageDetails, ReplyReference } from './message-details';
export function savedConversation(state: SessionChats, self: string): SessionChats {
  const next = updateConversation(state, self, conversation => ({ ...conversation, contact: 'accepted', connection: 'connected', error: '' }));
  return { ...next, order: [self, ...next.order.filter(peer => peer !== self)] };
}
export function messagePreview(message: ChatEntry): string {
  if (message.details?.ephemeral) return message.ephemeralState?.expired ? 'Исчезнувшее сообщение' : 'Исчезающее сообщение';
  return (message.file ? `📎 ${message.file.name}` : message.details?.contactCard
    ? `Контакт: ${message.details.contactCard.nickname || message.details.contactCard.accountId}` : message.text).slice(0, 280);
}
export function replyReference(message: ChatEntry): ReplyReference {
  return { id: message.id, from: message.from, preview: messagePreview(message) };
}
export function replyCount(messages: ChatEntry[], id: string): number {
  return messages.filter(message => message.details?.reply?.id === id).length;
}
export function displayedReply(messages: ChatEntry[], reference: ReplyReference): ReplyReference {
  const original = messages.find(message => message.id === reference.id);
  return original ? replyReference(original) : reference;
}
export function forwardingDetails(message: ChatEntry, author: ContactCard, allowOwnAttribution: boolean, self: string): MessageDetails {
  if (message.details?.ephemeral) throw new Error('Исчезающие сообщения нельзя пересылать.');
  const allowed = message.details?.allowForwardAttribution !== false && (message.from !== self || allowOwnAttribution);
  const original = message.details?.forwarded;
  return { forwarded: { sourceId: original?.sourceId ?? message.id,
    ...(allowed && (original ? original.author : author) ? { author: original?.author ?? author } : {}) },
    ...(message.details?.contactCard ? { contactCard: message.details.contactCard } : {}),
    ...(message.details?.media ? { media: message.details.media } : {}),
    // Do not carry a reply ID from another conversation: it points nowhere and
    // leaks a third person's quote. The forwarded body remains unchanged.
    allowForwardAttribution: allowed };
}
export function removeMessages(state: SessionChats, peer: string, ids: readonly string[]): SessionChats {
  const selected = new Set(ids);
  return updateConversation(state, peer, conversation => ({ ...conversation,
    messages: conversation.messages.filter(message => !selected.has(message.id)),
    unread: conversation.messages.filter(message => !message.details?.pin && !selected.has(message.id) && message.direction === 'incoming' && !message.readState).length,
    deletedIds: [...new Set([...(conversation.deletedIds ?? []), ...ids])],
  }));
}
export function transcript(messages: readonly ChatEntry[]): string {
  return messages.filter(message => !message.details?.ephemeral && !message.details?.ephemeralOpened).map(message => `[${new Date(message.timestamp).toISOString()}] ${message.from}\n${messagePreview(message)}${message.text.length > 280 && !message.file && !message.details?.contactCard ? message.text.slice(280) : ''}`).join('\n\n');
}
