<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
import { onDestroy, onMount } from 'svelte';
import { replaceState } from '$app/navigation';
import { version } from '$app/environment';
import type { openBrowserCoreCheck } from '$lib/core-storage/browser-check';
let fixture: Awaited<ReturnType<typeof openBrowserCoreCheck>> | undefined;
let messages = $state<string[]>([]), busy = $state(false), ready = $state(false), link = $state('');
let destroyed = false;
onMount(() => {
  void (async () => {
    try {
      const url = new URL(location.href);
      const runId = url.searchParams.get('run') || crypto.randomUUID();
      url.searchParams.set('run', runId);
      const { openBrowserCoreCheck } = await import('$lib/core-storage/browser-check');
      const opened = await openBrowserCoreCheck(runId);
      if (destroyed) { opened.close(); return; }
      replaceState(url, {});
      fixture = opened; link = url.href; ready = true;
    } catch (error) { messages = [`ОШИБКА: ${error instanceof Error ? error.message : 'unknown'}`]; }
  })();
});
onDestroy(() => { destroyed = true; fixture?.close(); });
async function run(action: 'prepare' | 'verify' | 'regress' | 'race' | 'clear') {
  if (!fixture || busy) return;
  busy = true; messages = [];
  try {
    await fixture[action](message => { messages = [...messages, message]; });
    if (action === 'clear') messages = ['Очищена только отдельная тестовая база этого прогона.'];
  } catch (error) { messages = [...messages, `ОШИБКА: ${error instanceof Error ? error.message : 'unknown'}`]; }
  finally { busy = false; }
}
</script>

<svelte:head><title>{$i18n.text("Проверка хранилища ядра Automesh")}</title><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="robots" content="noindex, nofollow" /></svelte:head>
<main>
  <h1>{$i18n.text("Хранилище ядра — тест")}</h1>
  <p class="url">{$i18n("m_945067d49558", {v0: (version)})}</p>
  <p>{$i18n.text("Только вымышленные данные и отдельная тестовая база. Сейф, переписка и настройки аккаунта не изменяются. Сети и ноды не используются.")}</p>
  <ol>
    <li>{$i18n.text("Нажмите «Подготовить». Это начинает новый прогон в тестовой базе.")}</li>
    <li>{$i18n.text("Перезагрузите страницу или закройте её и снова откройте эту же ссылку в течение часа.")}</li>
    <li>{$i18n.text("Нажмите «Проверить сохранение». Повтор операции должен быть отклонён, отзыв — сохранён.")}</li>
    <li>{$i18n.text("Откройте вторую вкладку по ссылке ниже и повторите проверку без подготовки.")}</li>
    <li>{$i18n.text("Нажмите «Гонка вкладок» в обеих вкладках: принять операцию может только одна.")}</li>
    <li>{$i18n.text("«Проверить сбои» проверяет конкуренцию, закрытие и повреждение, затем очищает тестовую базу.")}</li>
  </ol>
  <div class="actions">
    <button disabled={!ready || busy} onclick={() => run('prepare')}>{$i18n.text("Подготовить")}</button>
    <button disabled={!ready || busy} onclick={() => run('verify')}>{$i18n.text("Проверить сохранение")}</button>
    <button disabled={!ready || busy} onclick={() => run('race')}>{$i18n.text("Гонка вкладок")}</button>
    <button disabled={!ready || busy} onclick={() => run('regress')}>{$i18n.text("Проверить сбои")}</button>
    <button disabled={!ready || busy} onclick={() => run('clear')}>{$i18n.text("Очистить тестовые данные")}</button>
  </div>
  {#if link}<a href={link} target="_blank" rel="noopener">{$i18n.text("Открыть вторую тестовую вкладку")}</a><p class="url">{link}</p>{/if}
  {#if busy}<p role="status">{$i18n.text("Проверяем…")}</p>{/if}
  <ul aria-label={$i18n.text("Результаты проверки ядра")} aria-live="polite">{#each messages as message}<li>{message}</li>{/each}</ul>
  <p>{$i18n.text("Проверка выполняется только в этом браузере, результаты на сервер не отправляются. Для телефона откройте эту страницу с домена Automesh в обычном браузере. Пароль, seed и вход в настоящий аккаунт не нужны.")}</p>
  <a href="/">{$i18n.text("Вернуться в приложение")}</a>
</main>

<style>
  main { max-width: 780px; margin: 0 auto; padding: 20px; font: 16px/1.5 system-ui, sans-serif; }
  .actions { display: flex; flex-wrap: wrap; gap: 10px; margin: 20px 0; }
  button { padding: 10px 14px; font: inherit; }
  li { margin-bottom: 8px; }
  .url { overflow-wrap: anywhere; font-size: 13px; }
</style>
