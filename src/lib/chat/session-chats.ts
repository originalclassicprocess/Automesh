import type { FileOffer } from './file-transfer';
import type { MessageDetails } from './message-details';
import type { CallRecord } from '$lib/calls/history';
import type { DeliveryIssue, DeliveryErrorCode } from '$lib/application/delivery-issues';

// Runtime chat state. Durable fields are serialized separately from connection state.
export type ChatEntry = {
  id: string;
  text: string;
  from: string;
  timestamp: number;
  direction: 'incoming' | 'outgoing';
  restoredFromBackup?: boolean;
  importedFromDevice?: boolean;
  deviceMessage?: boolean;
  // Independent replication tasks; never a gate for primary delivery.
  deviceCopies?: Array<'own' | 'peer'>;
  deviceCopyDelivery?: 'stored' | 'delivered';
  details?: MessageDetails;
  ephemeralState?: { firstViewedAt: number; views: number; expired?: boolean };
  localCall?: CallRecord;
  courierVia?: string;
  forwardedTo?: string[];
  // Absent on messages saved before the outbox protocol was introduced.
  delivery?: 'saving' | 'queued' | 'sending' | 'sent' | 'stored' | 'delivered' | 'read';
  deliveryIssue?: DeliveryIssue;
  deliveryError?: DeliveryErrorCode;
  directFallback?: boolean;
  radioDelivery?: import('$lib/radio/conversation').RadioDelivery;
  radioReception?: import('$lib/radio/reception').RadioReception;
  radioSuppressed?: boolean;
  radioNoticeDismissed?: boolean;
  // Current worker activity only; never restore a live transfer from history.
  courierStage?: 'preparing' | 'uploading' | 'retrying';
  nodeQueue?: 'canceling' | 'canceled' | 'expired';
  nodeQueueDismissed?: boolean;
  readState?: 'waiting' | 'pending' | 'sent' | 'skipped';
  file?: FileOffer;
  fileStatus?: 'queued' | 'offered' | 'receiving' | 'sending' | 'ready' | 'failed' | 'rejected' | 'canceled';
  fileProgress?: number;
  fileAccepted?: boolean;
  fileDeleted?: boolean;
};

export type ContactState = 'new' | 'outgoing' | 'pending' | 'accepted' | 'blocked';

export type Conversation = {
  peerAddress: string;
  messages: ChatEntry[];
  draft: string;
  unread: number;
  connection: 'offline' | 'connecting' | 'connected';
  error: string;
  sending: boolean;
  contact: ContactState;
  blockedFrom?: ContactState;
  deletedIds?: string[];
};

export type SessionChats = {
  byPeer: Record<string, Conversation>;
  order: string[];
  activePeer: string;
};

export type SavedChats = {
  order: string[];
  byPeer: Record<string, { messages: ChatEntry[]; contact?: ContactState; blockedFrom?: ContactState; deletedIds?: string[] }>;
};

export function unreadMessageCount(messages: ChatEntry[]): number {
  return messages.filter((message) => !message.details?.pin && !message.details?.ephemeralOpened && message.direction === 'incoming' && !message.readState).length;
}

export function firstUnreadMessageId(messages: ChatEntry[]): string | undefined {
  return messages.find((message) => !message.details?.pin && !message.details?.ephemeralOpened && message.direction === 'incoming' && !message.readState)?.id;
}

export function saveChats(state: SessionChats): SavedChats {
  const byPeer: SavedChats['byPeer'] = {};
  for (const peer of state.order) {
    const conversation = state.byPeer[peer];
    if (conversation) byPeer[peer] = {
      messages: conversation.messages.map(({courierStage:_,...message})=>message), contact: conversation.contact, blockedFrom: conversation.blockedFrom,
      ...(conversation.deletedIds ? { deletedIds: conversation.deletedIds } : {}),
    };
  }
  return { order: [...state.order], byPeer };
}

export function restoreChats(saved: SavedChats): SessionChats {
  let state = emptySessionChats();
  for (const peer of saved.order) {
    if (!saved.byPeer[peer]) continue;
    state = ensureConversation(state, peer);
    state = updateConversation(state, peer, (conversation) => {
      const messages = saved.byPeer[peer].messages.map((message) => ({
        ...message,
        courierStage: undefined,
        delivery: message.delivery === 'sending' || (message.direction === 'outgoing' && message.file && !message.fileDeleted &&
          ['delivered', 'read'].includes(message.delivery ?? '') && !['ready', 'rejected', 'canceled'].includes(message.fileStatus ?? ''))
          ? 'queued' : message.delivery,
        fileStatus: message.fileStatus === 'sending' ? 'queued' :
          message.fileStatus === 'receiving' ? 'offered' : message.fileStatus,
      }));
      // Existing histories predate requests and remain normal conversations.
      const contact = saved.byPeer[peer].contact ?? (messages.length ? 'accepted' : 'new');
      return {
        ...conversation,
        messages,
        unread: contact === 'blocked' ? 0 : unreadMessageCount(messages),
        contact,
        blockedFrom: saved.byPeer[peer].blockedFrom,
        ...(saved.byPeer[peer].deletedIds ? { deletedIds: saved.byPeer[peer].deletedIds } : {}),
      };
    });
  }
  return state;
}

export function emptySessionChats(): SessionChats {
  return { byPeer: {}, order: [], activePeer: '' };
}

export function ensureConversation(state: SessionChats, peerAddress: string): SessionChats {
  if (state.byPeer[peerAddress]) return state;
  return {
    ...state,
    byPeer: {
      ...state.byPeer,
      [peerAddress]: {
        peerAddress,
        messages: [],
        draft: '',
        unread: 0,
        connection: 'offline',
        error: '',
        sending: false,
        contact: 'new',
      },
    },
    order: [...state.order, peerAddress],
  };
}

export function updateConversation(
  state: SessionChats,
  peerAddress: string,
  update: (conversation: Conversation) => Conversation,
): SessionChats {
  const next = ensureConversation(state, peerAddress);
  return {
    ...next,
    byPeer: {
      ...next.byPeer,
      [peerAddress]: update(next.byPeer[peerAddress]),
    },
  };
}

export function selectConversation(state: SessionChats, peerAddress: string): SessionChats {
  const next = ensureConversation(state, peerAddress);
  return {
    ...next,
    activePeer: peerAddress,
  };
}

export function receiveMessage(state: SessionChats, entry: ChatEntry): SessionChats {
  return updateConversation(state, entry.from, (conversation) => {
    if (conversation.deletedIds?.includes(entry.id) || conversation.messages.some((message) => message.id === entry.id)) return conversation;
    return {
      ...conversation,
      messages: [...conversation.messages, entry],
      unread: conversation.unread + unreadMessageCount([entry]),
      contact: conversation.contact === 'new' ? 'pending' : conversation.contact,
    };
  });
}

// Called only after authenticating a file offer/manifest. Old clients could
// mistakenly send the file's empty text with this ID before the real offer.
// Never replace actual text, control messages, another sender or another file.
export function receiveFileMessage(state: SessionChats, entry: ChatEntry): SessionChats {
  if (!entry.file || entry.direction !== 'incoming') throw new Error('invalid_file_entry');
  if (state.byPeer[entry.from]?.deletedIds?.includes(entry.id)) return state;
  const existing = state.byPeer[entry.from]?.messages.find(message => message.id === entry.id);
  if (!existing) return receiveMessage(state, entry);
  if (existing.direction !== 'incoming' || existing.from !== entry.from) throw new Error('conflicting_message_id');
  if (existing.file) {
    if (JSON.stringify(existing.file) !== JSON.stringify(entry.file)) throw new Error('conflicting_message_id');
    return state;
  }
  if (existing.text !== '' || existing.details?.pin || existing.details?.contactCard ||
      Object.entries(existing.details ?? {}).some(([key, value]) =>
        JSON.stringify(value) !== JSON.stringify(entry.file!.details?.[key as keyof MessageDetails]))) throw new Error('conflicting_message_id');
  return updateConversation(state, entry.from, conversation => {
    const messages = conversation.messages.map(message => message.id === entry.id ? entry : message);
    return { ...conversation, messages, unread: unreadMessageCount(messages) };
  });
}

export function recordSentMessage(state: SessionChats, peerAddress: string, entry: ChatEntry): SessionChats {
  return updateConversation(state, peerAddress, (conversation) => ({
    ...conversation,
    messages: [...conversation.messages, entry],
    contact: conversation.contact === 'new' ? 'outgoing' : conversation.contact,
  }));
}

export function setContactState(state: SessionChats, peerAddress: string, contact: ContactState): SessionChats {
  return updateConversation(state, peerAddress, (conversation) => ({ ...conversation, contact }));
}

export function setReadState(
  state: SessionChats,
  peerAddress: string,
  messageId: string,
  readState: NonNullable<ChatEntry['readState']>,
): SessionChats {
  return updateConversation(state, peerAddress, (conversation) => {
    const messages = conversation.messages.map((message) =>
      message.id === messageId && message.direction === 'incoming' ? { ...message, readState } : message);
    return { ...conversation, messages, unread: unreadMessageCount(messages) };
  });
}

export function setDeliveryStatus(
  state: SessionChats,
  peerAddress: string,
  messageId: string,
  delivery: NonNullable<ChatEntry['delivery']>,
): SessionChats {
  return updateConversation(state, peerAddress, (conversation) => ({
    ...conversation,
    messages: conversation.messages.map((message) => message.id === messageId && message.direction === 'outgoing'
        ? { ...message, ...(['stored','delivered','read'].includes(delivery)?{courierStage:undefined}:{}), ...(['delivered','read'].includes(delivery) ? {nodeQueue: undefined, nodeQueueDismissed: undefined} : {}), delivery: message.delivery === 'read' ? 'read' :
          message.delivery === 'delivered' && delivery !== 'read' ? 'delivered' : delivery }
      : message),
  }));
}
