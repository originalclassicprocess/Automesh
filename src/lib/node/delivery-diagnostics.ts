export type DeliveryDiagnostics = { envelopeAt: number; savedAt: number; receiptAt: number; failure: string;
  inboxAt?: number; inboxFailure?: string; inboxSupported?: boolean;
  remoteInboxAt?: number; remoteInboxFailure?: string; remoteInboxSources?: number };
export const emptyDeliveryDiagnostics = (): DeliveryDiagnostics => ({ envelopeAt: 0, savedAt: 0, receiptAt: 0, failure: '' });
export function deliveryFailure(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  if(code==='courier_key_import_failed')return 'Браузер не смог открыть сохранённый ключ получения. Конверт остаётся на ноде. Код: courier_key_import_failed.';
  if(code==='courier_key_agreement_failed')return 'Не удалось подготовить расшифровку конверта сохранённым ключом. Подтверждение не отправлено. Код: courier_key_agreement_failed.';
  if(code==='courier_decryption_failed')return 'Зашифрованное содержимое не прошло расшифровку или проверку целостности. Подтверждение не отправлено. Код: courier_decryption_failed.';
  if(code==='invalid_courier_recipient')return 'Конверт не соответствует получателю или сроку сохранённого ключа. Подтверждение не отправлено. Код: invalid_courier_recipient.';
  if(code==='invalid_courier_packet')return 'Поля зашифрованного сообщения не прошли проверку. Подтверждение не отправлено. Код: invalid_courier_packet.';
  if(code==='invalid_attachment_manifest')return 'Описание вложения не прошло проверку. Файл не подтверждён. Код: invalid_attachment_manifest.';
  if(code==='invalid_recipient_grant')return 'Разрешение отправителя для получения очереди не прошло проверку или истекло. Нужен новый подписанный обмен с контактом.';
  if(code==='node_unavailable'||code==='not_found')return 'Нода собеседника не ответила. Проверим повторно; может потребоваться обновление ноды.';
  if (code === 'courier_key_unavailable') return 'Нет сохранённого ключа для этого конверта. Нужен повторный обмен ключами с контактом; старый конверт автоматически расшифровать нельзя.';
  if (code === 'courier_not_saved') return 'Не удалось сохранить сообщение. Подтверждение не отправлено, копия остаётся на ноде.';
  if (code === 'attachment_relay_update_required') return 'Сервер подключения не поддерживает получение файлов. Нужен обновлённый сигналинг.';
  if (code === 'courier_replay_conflict' || code === 'conflicting_message_id') return 'Конфликт повторного сообщения. Конверт не подтверждён.';
  return 'Конверт не принят: проверка подписи, ключа или формата не завершилась. Подтверждение не отправлено.';
}
