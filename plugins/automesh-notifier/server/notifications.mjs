import { createHash, randomUUID } from 'node:crypto';

const statuses = { completed: 'Задача выполнена', failed: 'Задача завершилась с ошибкой',
  needs_input: 'Нужен ответ пользователя', finished: 'Ответ Codex завершён' };
const clean = (value, limit) => typeof value === 'string' && value.trim().length > 0 && value.length <= limit;
export function notification(input) {
  const allowed = ['eventId', 'title', 'summary', 'status', 'threadId'];
  if (!input || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key)) ||
      !clean(input.eventId, 256) || !clean(input.title, 160) || !clean(input.summary, 12000) ||
      !Object.hasOwn(statuses, input.status) ||
      (input.threadId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.threadId)))
    throw new Error('invalid_notification');
  const key = createHash('sha256').update(input.eventId).digest('hex');
  return { key, messageId: randomUUID(), text: [statuses[input.status], input.title.trim(), '', input.summary.trim(),
    ...(input.threadId ? ['', `codex://threads/${input.threadId}`] : [])].join('\n'), createdAt: Date.now() };
}
export function fromStop(event) {
  if (!event || event.hook_event_name !== 'Stop' || !clean(event.session_id, 128) ||
      !clean(event.turn_id, 128) || !clean(event.last_assistant_message, 2 * 1024 * 1024)) return null;
  return { eventId: `codex-stop:${event.session_id}:${event.turn_id}`, status: 'finished',
    title: 'Уведомление Codex', summary: event.last_assistant_message.slice(0, 12000),
    ...(/^[0-9a-f-]{36}$/i.test(event.session_id) ? { threadId: event.session_id } : {}) };
}
