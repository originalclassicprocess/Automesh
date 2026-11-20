import type { SessionChats } from './session-chats';

// Emitted only after authentication and successful history commit. It contains
// a reference, not plaintext, keys, a network route or a live transport object.
export type CommittedIncoming = { peer: string; id: string; transport: 'direct' | 'mailbox' | 'courier' | 'radio' };
export type CommittedIncomingListener = (event: CommittedIncoming) => void;

export function isFreshIncoming(chats: SessionChats, peer: string, id: string): boolean {
  const conversation = chats.byPeer[peer];
  return conversation?.contact === 'accepted' && !conversation.deletedIds?.includes(id) &&
    !conversation.messages.some(message => message.id === id);
}

// Observers are optional and must never prevent the transport receipt or retry.
export function notifyCommittedIncoming(listener: CommittedIncomingListener | undefined, event: CommittedIncoming): void {
  try { listener?.(event); } catch { /* application observer is independent of delivery */ }
}
