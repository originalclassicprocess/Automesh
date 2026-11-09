import { fromStop } from '../server/notifications.mjs';
import { notify } from '../server/runtime.mjs';

try {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 2 * 1024 * 1024) throw new Error('hook_input_limit');
  }
  const payload = fromStop(JSON.parse(input));
  const result = payload ? await notify(payload, { automatic: true }) : null;
  process.stdout.write(JSON.stringify(result?.status === 'queued'
    ? { systemMessage: 'Automesh: уведомление сохранено в очереди; доставка пока не подтверждена.' } : {}));
} catch {
  // Never request continuation or make a successful Codex turn fail.
  process.stdout.write(JSON.stringify({ systemMessage: 'Automesh: уведомление не отправлено. Проверьте настройки плагина.' }));
}
