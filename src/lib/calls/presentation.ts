import type { CallView } from './controller';
export function callLabel(view: CallView): string {
  if (view.phase === 'incoming') return 'Входящий голосовой звонок';
  if (view.phase === 'outgoing') return 'Вызываем собеседника…';
  if (view.phase === 'connecting') return 'Подключаем защищённый звонок…';
  if (view.phase === 'reconnecting') return 'Восстанавливаем связь…';
  if (view.phase === 'active') return 'Голосовой звонок';
  const reasons = { finished: 'Звонок завершён', declined: 'Звонок отклонён', busy: 'Собеседник занят', unanswered: 'Нет ответа',
    network: 'Соединение прервано', microphone: 'Микрофон недоступен', security: 'Проверка звонка не пройдена', unsupported: 'Звонки не поддерживаются в этом браузере' };
  return reasons[view.reason ?? 'finished'];
}
export function callTime(started: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - started) / 1000));
  return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
}
