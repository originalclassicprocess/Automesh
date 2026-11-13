import type { SessionChats } from '$lib/chat/session-chats';
export const radioCategories = [
  { id: 'sending', label: 'Отправляем', tone: 'waiting' },
  { id: 'awaiting', label: 'Ждём ответа платы', tone: 'waiting' },
  { id: 'board', label: 'Принято платой', tone: 'waiting' },
  { id: 'retry', label: 'Нужен повтор', tone: 'danger' },
  { id: 'paused', label: 'LoRa приостановлена', tone: 'waiting' },
  { id: 'stopped', label: 'Отменено вами', tone: 'neutral' },
] as const;
export function radioQueueView(chats: SessionChats) {
  return chats.order.flatMap(peer => chats.byPeer[peer].messages
    .filter(m => m.radioDelivery && !m.nodeQueue && m.radioDelivery !== 'received' && m.direction === 'outgoing' &&
      !['stored','delivered','read'].includes(m.delivery ?? '') && !m.restoredFromBackup && !m.importedFromDevice)
    .map(message => ({ peer, message, kind: message.radioDelivery === 'stopped' ? message.radioSuppressed ? 'stopped' : 'paused' : message.radioDelivery === 'retry' ? 'retry' :
      message.radioDelivery === 'board' ? 'board' : message.radioDelivery === 'awaiting' ? 'awaiting' : 'sending' })));
}
