import { messageStatus, type MessageStatus } from '$lib/chat/message-presentation';
import type { ChatEntry } from '$lib/chat/session-chats';
import { groupAudience, type GroupEntry, type GroupRoom } from './storage';

export type GroupDeliveryPhase = 'searching' | 'sending';

export function groupChatEntry(entry: GroupEntry, self: string, ready = false): ChatEntry {
  return { id:entry.id, from:entry.from, text:entry.text, timestamp:entry.sentAt ?? 0,
    direction:entry.from === self ? 'outgoing' : 'incoming', ...(entry.file ? {
      file:entry.file, fileStatus:ready || entry.fileReady || entry.fileNode ? 'ready' : 'offered',
    } : {}) };
}

export function groupRecipients(room: GroupRoom, entry: GroupEntry) {
  const recipients = groupAudience(room, entry).filter(peer => peer !== entry.from);
  const accepted = new Set(entry.receivedBy);
  const read = new Set(entry.receipts?.filter(receipt => receipt.state === 'read').map(receipt => receipt.by));
  for (const receipt of entry.receipts ?? []) accepted.add(receipt.by);
  const files = new Set(entry.fileReceivedBy);
  return recipients.map(peer => {
    const cardNode = entry.nodeStatus?.[peer], fileNode = entry.nodeFileStatus?.[peer];
    const file = files.has(peer) || fileNode === 'delivered';
    const card = accepted.has(peer) || cardNode === 'delivered' || file;
    return { peer, card, file, cardNode, fileNode, read:read.has(peer),
      received:entry.file ? file : card,
      stored:entry.file ? !file && fileNode === 'stored' : !card && cardNode === 'stored' };
  });
}

export function groupDelivery(room: GroupRoom, entry: GroupEntry, self: string, ready = false,
  activity?: GroupDeliveryPhase, searching?: ReadonlySet<string>): { status:MessageStatus; count?: string } {
  const message = groupChatEntry(entry, self, ready);
  if (entry.from !== self) return { status:messageStatus(message) };
  const recipients = groupRecipients(room, entry);
  const total = recipients.length;
  const received = recipients.filter(peer => peer.received).length;
  const stored = recipients.filter(peer => peer.stored).length;
  const seen = recipients.filter(peer => peer.received && peer.read).length;
  const result = (icon: string, label: string, detail: string, tone: MessageStatus['tone'], count?: string) =>
    ({ status:{ icon, label, detail, tone }, count });
  if (!total) return { status:messageStatus({ ...message, delivery:'delivered' }, true) };
  if (seen === total)
    return result('✓✓', 'Прочитано всеми', 'Все получатели подтвердили получение и прочтение сообщения.', 'success');
  if (received === total)
    return result('✓', 'Получено всеми', 'Все получатели подтвердили получение сообщения целиком.', 'success');
  if (stored) return result('☁', 'Сохранено на ноде', received + stored === total
    ? 'Для каждого получателя есть подтверждение получения или сохранения полной копии на ноде. Приложение можно закрыть, пока нода доступна.'
    : 'Нода сохранила полную копию для части получателей. Для остальных доставка продолжается. Оставьте приложение открытым.',
    'success', received + stored === total ? undefined : `${stored}/${total}`);
  if (received) return result('✓', 'Получено', 'Часть участников получила сообщение целиком. Чтобы остальные могли получить его, оставьте приложение открытым.',
    'success', `${received}/${total}`);
  if (activity === 'sending')
    return result('↑', 'Отправляем', 'Идёт передача. Оставьте приложение открытым до подтверждения.', 'waiting');
  if (activity === 'searching' || recipients.some(({ peer }) => room.members.includes(peer) && searching?.has(peer)))
    return result('◷', 'Ищем получателя', 'Ищем участника или ноду, которые смогут принять сообщение. Оставьте приложение открытым.', 'waiting');
  return result('×', entry.file ? 'Файл не отправлен' : 'Не отправлено',
    'Сообщение сохранено здесь. Сейчас полной копии нет у получателей или на ноде. Оставьте приложение открытым для следующей попытки.', 'error');
}
