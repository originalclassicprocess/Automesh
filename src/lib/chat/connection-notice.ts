// Only routine direct-connection notices collapse. Send/storage/input errors
// must remain visible as alerts; this is presentation, never delivery state.
export function isRoutineConnectionNotice(error: string): boolean {
  return error === 'Сообщения ждут появления собеседника в сети.' ||
    error === 'Собеседник не ответил. Выберите чат, чтобы повторить подключение.';
}
