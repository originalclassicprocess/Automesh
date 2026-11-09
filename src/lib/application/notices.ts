export type AppNotice = { message: string; details?: string; durationMs: number; kind: 'info' | 'error' };
const temporarySuccess = new Set(['Ссылка на контакт скопирована.', 'Пароль изменён.', 'Закрепление сохранено.', 'Закрепление сохранено и отправляется собеседнику.', 'Это ваш аккаунт.']);
temporarySuccess.add('Файлы переданы браузеру для скачивания. Сохранение на диск управляется браузером.');
export function accountNotice(message: string): AppNotice {
  return { message, durationMs: temporarySuccess.has(message) ? 3000 : 0,
    kind: /не удалось|неверн|ошиб|не сохран|не отправ|не совпад|недоступ|слишком длин/i.test(message) ? 'error' : 'info' };
}
export function microphoneNotice(error: unknown): AppNotice {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return { message: 'Разрешите микрофон в браузере.', durationMs: 7000, kind: 'error', details: 'Откройте разрешения для этого сайта в браузере и разрешите микрофон, затем повторите запись. Нужен HTTPS. Пароль и seed для этого не требуются.' };
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return { message: 'Микрофон не найден.', details: 'Проверьте подключение микрофона и выбор устройства в браузере.', durationMs: 7000, kind: 'error' };
  if (error instanceof Error && error.message === 'recording_unsupported') return { message: 'Запись не поддерживается этим браузером.', details: 'Можно записать звук другим приложением и прикрепить файл.', durationMs: 7000, kind: 'error' };
  return { message: 'Микрофон недоступен.', details: 'Проверьте разрешения сайта и не занят ли микрофон другим приложением. Запись требует HTTPS или localhost.', durationMs: 7000, kind: 'error' };
}
export class NoticeTimer {
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private dismiss: () => void) {}
  update(durationMs: number, paused = false) { this.dispose(); if (durationMs > 0 && !paused) this.timer = setTimeout(() => { this.timer = undefined; this.dismiss(); }, durationMs); }
  dispose() { clearTimeout(this.timer); this.timer = undefined; }
}
