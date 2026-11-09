import type { SessionChats } from '$lib/chat/session-chats';
export const radioCategories = [
  { id: 'sending', label: 'Отправляем', tone: 'waiting' },
  { id: 'awaiting', label: 'Ждём ответа платы', tone: 'waiting' },
  { id: 'board', label: 'Принято платой', tone: 'success' },
  { id: 'retry', label: 'Нужен повтор', tone: 'danger' },
] as const;
export function radioQueueView(chats: SessionChats) {
  return chats.order.flatMap(peer => chats.byPeer[peer].messages
    .filter(m => m.radioDelivery && m.radioDelivery !== 'received' && m.direction === 'outgoing' &&
      !['delivered','read'].includes(m.delivery ?? '') && !m.restoredFromBackup && !m.importedFromDevice)
    .map(message => ({ peer, message, kind: ['retry','stopped'].includes(message.radioDelivery!) ? 'retry' :
      message.radioDelivery === 'board' ? 'board' : message.radioDelivery === 'awaiting' ? 'awaiting' : 'sending' })));
}
