import { status, probe, flush, notify } from './runtime.mjs';

const command = process.argv[2] ?? 'status';
try {
  let result;
  if (command === 'status') result = await status();
  else if (command === 'probe') result = await probe();
  else if (command === 'flush') result = await flush();
  else if (command === 'test') result = await notify({
    eventId: 'automesh-notifier-connection-test-v1', title: 'Проверка подключения Automesh', status: 'finished',
    summary: 'Плагин Automesh Notifications подключён. Это проверочное уведомление Codex. Отправитель — отдельный аккаунт плагина.',
  });
  else throw new Error('unknown_command');
  console.log(JSON.stringify(result));
} catch {
  // No stack traces or decrypted material in operator/model-visible output.
  console.error('Automesh notifier failed. Check setup, browser availability and the encrypted outbox.');
  process.exitCode = 1;
}
