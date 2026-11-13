// Local allowlisted reasons only. Never display arbitrary server/error text.
export const deliveryIssues = {
  contact_connecting: ['Устанавливаем защищённую связь', 'Запрос сохранён в приложении. Доставка собеседнику ещё не подтверждена.'],
  direct_unavailable: ['Ждём соединения', 'Прямой канал не принял сообщение. Повторяем попытку; при доступных ключах используем ноду.'],
  direct_receipt_timeout: ['Ждём подтверждения', 'Прямой канал не подтвердил получение вовремя. Повторяем тот же ID, при возможности — через ноду.'],
  contact_pending: ['Ждём принятия контакта', 'Первый запрос сохранён. Для офлайн-доставки нужно принятие контакта и обмен ключами; подключение к одной ноде этого не заменяет.'],
  node_not_configured: ['Ждём собеседника', 'Нода доставки не выбрана. Сообщение сохранено и будет отправлено по прямому каналу после подключения.'],
  node_sending_disabled: ['Ждём собеседника', 'Новая отправка через ноду выключена. Прямой чат продолжает работать.'],
  keys_missing: ['Ждём ключи', 'Нет ключей для отложенной доставки. Запрашиваем запас через ноду собеседника, если он опубликован. Прямое соединение также обновляет ключи; для онлайн-отправки они не нужны.'],
  keys_expired: ['Ждём новые ключи', 'Срок ключей для новых отправлений истёк. Запрашиваем опубликованный запас через ноду; прямое соединение также обновляет ключи.'],
  keys_exhausted: ['Ждём новые ключи', 'Свободные офлайн-ключи закончились. Запрашиваем запас через ноду собеседника, если он опубликован; сообщение сохранено и ждёт пополнения или прямого канала.'],
  keys_source_unavailable:['Не удалось получить ключи','Служба ключей собеседника недоступна или её ответ не прошёл проверку. Сообщение сохранено; повторим запрос. Домашний адрес службы должен быть заранее добавлен в ваши ноды. Прямой чат продолжает работать.'],
  node_unavailable: ['Повторяем подключение к ноде', 'Предыдущая попытка не завершилась. Сообщение сохранено; повторяем автоматически.'],
  node_timeout: ['Повторяем запрос к ноде', 'Предыдущий запрос не завершился вовремя. Сообщение сохранено; повтор будет автоматическим.'],
  node_denied: ['Доступ к ноде не подтверждён', 'Нода отклонила права этого профиля. Проверьте именно подключение профиля для доставки, а не закладку панели.'],
  node_full: ['Очередь ноды заполнена', 'Нода не приняла конверт из-за лимита. Локальная копия сохранена.'],
  node_files_full: ['Достигнут лимит файлов ноды', 'Закончились файловые слоты. Это отдельный лимит от объёма в МБ; локальная копия сохранена.'],
  node_profile_files_full: ['Достигнут лимит файлов профиля', 'Ваш профиль занял свою квоту файлов на этой ноде. Остальные профили используют собственные квоты.'],
  node_storage_full: ['Не хватает места в очереди', 'Объём ноды занят или зарезервирован под файлы. Часть места сохраняется для обычных сообщений.'],
  node_messages_full: ['Достигнут лимит конвертов', 'Исчерпана квота конвертов или служебных квитанций. Это отдельный лимит от числа файлов и объёма в МБ.'],
  node_profile_messages_full: ['Достигнута квота отправителя', 'У этого отправителя слишком много ожидающих конвертов или их объём превышает квоту. Локальная копия сохранена.'],
  node_rate_limit: ['Нода ограничила запросы', 'Слишком много запросов. Клиент повторит отправку с задержкой.'],
  local_storage: ['Не удалось сохранить', 'Ошибка локального хранилища. Не очищайте данные; проверьте свободное место. Подтверждение доставки не получено.'],
  primary_disabled: ['Основной вход отключён', 'В подписанном списке отключён основной вход аккаунта. Отправка остановлена, права и список устройств не сброшены.'],
  primary_policy_invalid: ['Не удалось проверить список', 'Сохранённые сведения о правах этого аккаунта не прошли проверку подписи или формата. Сообщение сохранено; другие чаты не блокируются.'],
  network_forbidden: ['Маршрут запрещён настройками', 'Выбранная интернет-нода недоступна в режиме «Только LAN». Данные не отправлены в запрещённую сеть.'],
} as const;
export type DeliveryIssue = keyof typeof deliveryIssues;
const actionIssues=new Set<DeliveryIssue>(['node_denied','node_full','node_files_full','node_profile_files_full','node_storage_full','node_messages_full','node_profile_messages_full','local_storage','primary_disabled','primary_policy_invalid','network_forbidden']);
// Optional node setup does not block a direct send. A rejected/unapproved key
// source, unlike a temporary timeout, needs inspection rather than mere waiting.
export const deliveryNeedsAction=(code:DeliveryIssue,error?:unknown)=>actionIssues.has(code)||code==='keys_source_unavailable'&&typeof error==='string'&&
  ['prekey_denied','invalid_prekey','invalid_prekey_allocation','prekey_already_used','prekey_source_not_approved'].includes(error);
const errorCodes = ['invalid_node_request','invalid_courier_inventory','invalid_recipient_grant','primary_disabled','primary_policy_invalid','primary_session_changed','not_member','unauthorized','sender_not_allowed',
  'prekey_denied','prekey_capacity','prekeys_unavailable','invalid_prekey','invalid_prekey_allocation','prekey_already_used','prekey_source_not_approved','courier_prekey_limit',
  'not_owner','device_denied','rate_limit','too_many_challenges','mailbox_full','member_limit','sender_limit','internet_disabled',
  'courier_not_saved','offline_not_saved','invalid_challenge','invalid_courier_store','invalid_courier_receipt','invalid_courier_receipts',
  'invalid_courier_signature','invalid_courier_job','invalid_courier_inbox','node_identity_changed','node_protocol_invalid','courier_disabled',
  'device_policy_conflict','invalid_device_roster','device_membership_rollback','device_membership_fork','device_membership_conflict',
  'device_owner_unavailable','device_owner_checkpoint_invalid','device_checkpoint_invalid','invalid_core_object','node_unavailable',
  'peer_unreachable','peer_not_connected','secure_session_not_ready','channel_closed','courier_busy','courier_lan_update_required',
  'node_file_limit','profile_file_limit','node_storage_limit','node_message_limit','profile_message_limit',
  'request_aborted','request_timeout','client_type_error','unclassified_failure'] as const;
export type DeliveryErrorCode = typeof errorCodes[number];
export const isDeliveryErrorCode = (value: unknown): value is DeliveryErrorCode => typeof value === 'string' && (errorCodes as readonly string[]).includes(value);
export function safeDeliveryErrorCode(error: unknown): DeliveryErrorCode {
  if (error instanceof Error && isDeliveryErrorCode(error.message)) return error.message;
  if (error instanceof Error && error.name === 'AbortError') return 'request_aborted';
  if (error instanceof Error && error.name === 'TimeoutError') return 'request_timeout';
  if (error instanceof TypeError) return 'client_type_error';
  return 'unclassified_failure';
}
export const isDeliveryIssue = (value: unknown): value is DeliveryIssue => typeof value === 'string' && Object.hasOwn(deliveryIssues, value);
export function deliveryAttempt(previous: {directFallback?:boolean}, code: DeliveryIssue | undefined, error?: unknown) {
  return { deliveryIssue:code, deliveryError:error === undefined ? undefined : safeDeliveryErrorCode(error),
    // A new direct ATTEMPT is not a receipt. Keep the fallback eligible while
    // that attempt races the courier wakeup; confirmed states exclude it.
    directFallback:previous.directFallback || code === 'direct_unavailable' || code === 'direct_receipt_timeout' ? true : undefined };
}
export function deliveryIssueText(code: DeliveryIssue, error?: unknown): string {
  const [label, detail] = deliveryIssues[code]; return `${label}. ${detail} Код: ${code}${error === undefined ? '' : `; причина: ${safeDeliveryErrorCode(error)}`}`;
}
export function deliveryIssueForError(error: unknown, fallback: DeliveryIssue): DeliveryIssue {
  const code = error instanceof Error ? error.message : '';
  if (isDeliveryIssue(code)) return code;
  if (error instanceof Error && ['AbortError','TimeoutError'].includes(error.name)) return 'node_timeout';
  if (['not_member','unauthorized','device_denied','sender_not_allowed','not_owner'].includes(code)) return 'node_denied';
  if (['mailbox_full','member_limit','sender_limit'].includes(code)) return 'node_full';
  if (code === 'node_file_limit') return 'node_files_full';
  if (code === 'profile_file_limit') return 'node_profile_files_full';
  if (code === 'node_storage_limit') return 'node_storage_full';
  if (code === 'node_message_limit') return 'node_messages_full';
  if (code === 'profile_message_limit') return 'node_profile_messages_full';
  if (code === 'rate_limit' || code === 'too_many_challenges') return 'node_rate_limit';
  if(code==='prekeys_unavailable'||code==='prekey_capacity'||code==='courier_prekey_limit')return 'keys_exhausted';
  if(['prekey_denied','invalid_prekey','invalid_prekey_allocation','prekey_already_used','prekey_source_not_approved'].includes(code))return 'keys_source_unavailable';
  if (code === 'internet_disabled') return 'network_forbidden';
  if (['courier_not_saved','offline_not_saved'].includes(code)) return 'local_storage';
  return fallback;
}
