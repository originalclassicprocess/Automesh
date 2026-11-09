import type { SignedObject } from '../core/objects';
import type { MembershipBody } from './membership';
import { canonicalJson } from '../core/canonical';
import type { SessionChats } from '../chat/session-chats';

// Signature-verified rosters only. Empty root-only direct adverts from 0.3.4
// are discovery hints, not an opt-in to a different delivery protocol.
// Any certificate (even revoked/expired), node pin or disabled primary makes
// this protocol sticky. Never downgrade it after a failed freshness check.
export function requiresDeviceDelivery(roster: SignedObject | undefined): boolean {
  if (!roster) return false;
  const body = roster.record.body as unknown as MembershipBody;
  return Boolean(body.directory) || !body.primary || body.devices.length > 0;
}
export function requirePolicyProgress(previous: SignedObject | undefined, next: SignedObject): void {
  if (!previous) return;
  const a = previous.record.body as unknown as MembershipBody, b = next.record.body as unknown as MembershipBody;
  if (b.sequence < a.sequence || b.sequence === a.sequence && canonicalJson({record: previous.record, publicKey: previous.publicKey}) !== canonicalJson({record: next.record, publicKey: next.publicKey}) ||
      requiresDeviceDelivery(previous) && !requiresDeviceDelivery(next) ||
      a.devices.some(m => m.revokedAt !== null && !b.devices.some(n => n.certificate.record.id === m.certificate.record.id && n.revokedAt !== null)))
    throw new Error('device_membership_rollback');
}
// Primary UI only, immediately after the runtime verified these rosters.
// Repair the accidental 0.3.4 root-only overlay without touching stored jobs,
// true device conversations, restored history, file transfers or message IDs.
export function reconcileRootOnlyOutbox(chats: SessionChats, verified: SignedObject[]): SessionChats {
  let result = chats;
  for (const roster of verified) {
    const peer = roster.record.author, conversation = result.byPeer[peer];
    if (!conversation || requiresDeviceDelivery(roster)) continue;
    let changed = false;
    const messages = conversation.messages.map(m => {
      if (!m.deviceMessage || m.restoredFromBackup || m.file || m.direction !== 'outgoing' || m.delivery !== 'queued') return m;
      changed = true; return {...m,deviceMessage:false};
    });
    if (changed) result = {...result,byPeer:{...result.byPeer,[peer]:{...conversation,messages}}};
  }
  return result;
}
const explanations: Record<string, string> = {
  device_owner_unavailable: 'Не удалось получить свежую проверку прав. В прямом режиме нужен доступный владелец; для отложенной доставки подключите ноду на его основном устройстве.',
  device_owner_checkpoint_invalid: 'Свежий ответ владельца не прошёл проверку. Проверьте автоматические дату и время; права не сброшены. Код: device_owner_checkpoint_invalid',
  device_membership_denied: 'Подписанный список устройств не прошёл проверку времени, формата или версии. Код: device_membership_denied',
  device_membership_fork: 'Обнаружены разные ветки подписанного списка устройств. Список не заменён. Код: device_membership_fork',
  device_membership_conflict: 'Одна версия списка устройств имеет разное содержимое. Список не заменён. Код: device_membership_conflict',
  device_membership_rollback: 'Получена устаревшая или конфликтующая версия прав. Права не сброшены. Код: device_membership_rollback',
  device_checkpoint_invalid: 'Ответ закреплённой ноды не подтвердил свежесть списка. Код: device_checkpoint_invalid',
  invalid_core_object: 'Подписанный объект не прошёл проверку формата или срока действия. Код: invalid_core_object',
  device_access_revoked: 'Доступ устройства отозван или истёк. Новая отправка запрещена; сохранённые данные не удалены.',
  device_prekeys_unavailable: 'У получателя нет свободных ключей для очереди. Он должен открыть приложение и подготовить получение.',
  device_keys_unavailable: 'У получателя нет свободных ключей для очереди. Он должен открыть приложение и подготовить получение.',
  courier_change_pending: 'Смена ноды остановлена: в прежней очереди остались неподтверждённые задания. Сначала завершите их; данные не удалены.',
  device_no_recipients: 'Нет разрешённых устройств получателя. Проверьте список устройств у владельца.',
  device_delivery_capacity: 'Локальный журнал доставки заполнен. Сообщение не удалено; требуется освобождение подтверждённых записей.',
  device_directory_migration_required: 'Проверка прав привязана к другой ноде. Автоматическая замена запрещена; прежние очереди сохранены.',
  device_mail_capacity: 'Локальная очередь конвертов заполнена. Новые задания пока не подготовлены.',
  device_denied: 'Нода не подтвердила права этого профиля. Проверьте выбранный профиль и его подключение для доставки.',
  not_member: 'Этот профиль не подключён к очереди ноды. Доступ к панели администратора не заменяет подключение доставки.',
};
export function deviceDeliveryExplanation(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  return explanations[code] ?? 'Доставка устройствам пока не готова. Проверьте права, выбранную ноду и связь; подтверждение доставки не получено.';
}
