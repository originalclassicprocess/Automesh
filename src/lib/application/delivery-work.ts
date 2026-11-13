import type { ChatEntry, Conversation } from '$lib/chat/session-chats';

// History, delegated/radio work and terminal node actions never become new
// primary sends merely because a browser or a different transport reconnects.
export function localOutgoing(message: ChatEntry | undefined): message is ChatEntry {
  return !!message && message.direction === 'outgoing' && message.delivery !== 'saving' && !message.restoredFromBackup && !message.importedFromDevice &&
    !message.deviceMessage && !message.radioDelivery && !message.nodeQueue && !message.localCall;
}

export function pendingText(message: ChatEntry | undefined): message is ChatEntry {
  return localOutgoing(message) && !message.file && ['queued', 'sent', 'stored'].includes(message.delivery ?? '');
}

export function pendingFile(message: ChatEntry | undefined): message is ChatEntry & {file: NonNullable<ChatEntry['file']>} {
  return localOutgoing(message) && !!message.file && !message.fileDeleted &&
    !['ready', 'rejected', 'canceled'].includes(message.fileStatus ?? '');
}

export function pendingFileOffer(message: ChatEntry | undefined): boolean {
  return pendingFile(message) && ['queued', 'offered', 'failed'].includes(message.fileStatus ?? '');
}

export function peerNeedsRecovery(conversation: Conversation): boolean {
  if (conversation.contact === 'blocked' || conversation.contact === 'pending') return false;
  return conversation.contact === 'accepted' || conversation.contact === 'outgoing' ||
    conversation.messages.some(m => pendingText(m) || pendingFileOffer(m));
}
