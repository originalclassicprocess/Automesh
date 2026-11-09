import type { DirectoryAuthority } from './membership';
export function deviceNodeCandidate(pinned: DirectoryAuthority | null, courier: { url: string; nodeId: string } | null,
  incoming: { url: string; nodeId: string } | null) {
  // Existing bindings remain usable even when the old outgoing-reserve switch
  // is off. Never silently join, replace a pin, or change either old queue.
  return pinned ?? courier ?? incoming;
}

// Property order is not part of the pinned node identity. Signed/public
// records and encrypted local settings may serialize the same fields differently.
export function requireDeviceAuthority(saved: DirectoryAuthority | null, current: DirectoryAuthority): void {
  if (saved && (saved.url !== current.url || saved.nodeId !== current.nodeId || saved.publicKey !== current.publicKey))
    throw new Error('device_directory_migration_required');
}

const failures: Record<string, string> = {
  invalid_core_object: 'Не прошла проверка подписанного объекта: формат или время. Проверьте автоматические дату и время. Обычная отправка проверяется отдельно.',
  device_owner_checkpoint_invalid: 'Не прошла проверка свежего ответа владельца. Возможна разница часов. Права не сброшены.',
  device_checkpoint_invalid: 'Закреплённая нода не подтвердила свежесть списка устройств. Обычная переписка не переключается на другую ноду автоматически.',
  device_membership_denied: 'Подписанный список устройств не прошёл проверку формата, времени или версии.',
  device_membership_conflict: 'Одна версия списка устройств имеет разное подписанное содержимое. Автоматический сброс запрещён.',
  device_directory_migration_required: 'Сохранённая привязка устройств относится к другой ноде или ключу. Она не заменена. Проверьте выбранную ноду в «Связь и ноды».',
  device_node_changed: 'Идентификатор ноды изменился. Проверьте подключение в «Связь и ноды»; прежняя привязка не заменена.',
  node_identity_changed: 'Идентификатор ноды изменился. Проверьте подключение в «Связь и ноды»; прежняя привязка не заменена.',
  device_denied: 'Нода не разрешила подключение устройств для этого профиля. Проверьте, что именно этот профиль подключён к ноде в «Связь и ноды».',
  not_member: 'Этот профиль не подключён к ноде. Откройте «Связь и ноды» и подключите его.',
  unauthorized: 'Нода не подтвердила права этого профиля. Проверьте его подключение в «Связь и ноды».',
  device_policy_conflict: 'Версия списка устройств на ноде отличается от локальной. Повторите проверку. Список и права доступа не сброшены.',
  device_membership_rollback: 'Нода вернула устаревший или конфликтующий список устройств. Подключение остановлено; права доступа не сброшены.',
  device_membership_fork: 'Нода вернула конфликтующий список устройств. Подключение остановлено; права доступа не сброшены.',
  invalid_device_roster: 'Нода отклонила подписанный список устройств. Проверьте автоматическую дату и время на устройствах и повторите проверку.',
  device_capacity: 'На ноде недостаточно места для списка устройств. Проверьте лимит хранилища ноды.',
  rate_limit: 'Слишком много запросов к ноде. Подождите немного и повторите проверку.',
  device_settings_not_saved: 'Не удалось сохранить настройки устройств в браузере. Проверьте свободное место и доступ к локальному хранилищу.',
  internet_disabled: 'Доступ в интернет выключен. Включите его в «Связь и ноды» для подключения серверной ноды.',
};

export function deviceStartupFailure(error: unknown): { message: string; code: string } {
  const raw = error instanceof Error ? error.message : '';
  // Never expose arbitrary server text, keys, account IDs or URLs.
  const code = Object.hasOwn(failures, raw) ? raw : error instanceof Error && error.name === 'AbortError' ? 'node_timeout' : 'device_connection_failed';
  return { code, message: failures[code] ?? (code === 'node_timeout'
    ? 'Нода не ответила вовремя. Проверьте сеть и повторите проверку.'
    : 'Не удалось подготовить подключение устройств. Повторите проверку; если ошибка сохраняется, сообщите код ниже. Данные и права доступа не сброшены.') };
}
