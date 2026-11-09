<script lang="ts">
import { onDestroy, onMount } from 'svelte';
import { browser, version } from '$app/environment';
import AppUpdatePanel from '$lib/application/AppUpdatePanel.svelte';
import InterfacePreview from '$lib/application/InterfacePreview.svelte';
import { createBrowserUpdater } from '$lib/application/browser-updates';
import type { AppUpdateState } from '$lib/application/app-update';
let updateState = $state<AppUpdateState>({ phase: 'idle', message: 'Обновления ещё не проверены.' });
let updates: ReturnType<typeof createBrowserUpdater> | undefined;
let blockTestReload = $state(false);
let temporaryFixture = $state(false);
let directCheck = $state<string[]>([]);
let interfaceOpen = $state(true);
let directBusy = $state(false);
let directAbort: AbortController | undefined;
let backupCheck = $state<string[]>([]);
let backupBusy = $state(false);
let backupTestHost = $state<HTMLDivElement>();
let closeBackupFixture: (() => Promise<void>) | undefined;
let backupFixtureOpen = $state(false);
const local = browser && ['localhost', '127.0.0.1'].includes(location.hostname);
onMount(() => { if (local) updates = createBrowserUpdater(value => updateState = value); return () => updates?.dispose(); });
onDestroy(() => { directAbort?.abort(); void closeBackupFixture?.(); });
async function openBackupFixture(): Promise<void> {
  if (!local || backupBusy || !backupTestHost) return;
  backupBusy = true;
  try {
    await closeBackupFixture?.(); closeBackupFixture = undefined;
    const { mountBackupDownloadFixture } = await import('$lib/vault/seed-backup-browser-check');
    closeBackupFixture = await mountBackupDownloadFixture(backupTestHost);
    backupFixtureOpen = true;
  } finally { backupBusy = false; }
}
async function runDirectCheck(delayAfterAnswerMs = 0): Promise<void> {
  if (!local || directBusy) return;
  directBusy = true; directCheck = []; directAbort = new AbortController();
  try {
    const { checkDirectInBrowser } = await import('$lib/transport/direct-browser-check');
    await checkDirectInBrowser((message) => directCheck = [...directCheck, message], directAbort.signal, delayAfterAnswerMs);
  } catch (e) { directCheck = [...directCheck, `ОШИБКА: ${e instanceof Error ? e.message : 'unknown'}`]; }
  finally { directBusy = false; }
}

async function runBackupCheck(): Promise<void> {
  if (!local || backupBusy || !backupTestHost) return;
  backupBusy = true; backupCheck = [];
  try {
    await closeBackupFixture?.(); closeBackupFixture = undefined; backupFixtureOpen = false;
    const { checkSeedBackupInBrowser } = await import('$lib/vault/seed-backup-browser-check');
    await checkSeedBackupInBrowser(backupTestHost, (message) => backupCheck = [...backupCheck, message]);
  } catch (e) { backupCheck = [...backupCheck, `ОШИБКА: ${e instanceof Error ? e.message : 'unknown'}`]; }
  finally { backupBusy = false; }
}

</script>

<p><a href="/dev/profiles">Профили и подтверждение подключения — изолированный тест</a></p>

<h1>Dev Panel</h1>
{#if local}
  <p><a href="/dev/core">Проверка хранилища ядра в браузере</a> — отдельная вымышленная база, без доступа к аккаунту.</p>
  <button onclick={() => interfaceOpen = !interfaceOpen}>{interfaceOpen ? 'Скрыть пример интерфейса' : 'Открыть пример интерфейса'}</button>
  {#if interfaceOpen}<InterfacePreview />{/if}
  <h2>Проверка обновлений</h2>
  <p>Настоящий worker, без аккаунта и доступа к сейфу/переписке. Обновляется только тестовая вкладка.</p>
  <label><input type="checkbox" bind:checked={blockTestReload} /> Блокировать тестовую перезагрузку</label><br />
  <label><input type="checkbox" bind:checked={temporaryFixture} /> Показать предупреждение временной сессии</label>
  <AppUpdatePanel state={updateState} {version} discardTemporary={temporaryFixture}
    onCheck={() => void updates?.updater.check()}
    onApply={() => void updates?.updater.apply(async () => blockTestReload ? 'Тестовый черновик блокирует обновление.' : null)} />
  <h2>Радио без интернета</h2>
  <p><a href="/dev/radio">Открыть USB-стенд LoRa / Meshtastic</a> — временные аккаунты, два радиомодуля, без изменения настоящих чатов.</p>
  <h2>Проверка резервной копии</h2>
  <p>Общедоступная тестовая фраза. Настоящие аккаунты, пароли и хранилище не используются.</p>
  <button onclick={runBackupCheck} disabled={backupBusy}>{backupBusy ? 'Проверяем запись…' : 'Проверить запись seed'}</button>
  <button onclick={openBackupFixture} disabled={backupBusy}>Открыть тестовый экспорт</button>
  {#if backupFixtureOpen}<p>Пароль общедоступного тестового файла: <code>public-fixture-password</code>. Это не ваш аккаунт.</p>{/if}
  <ul aria-label="Результаты проверки seed" aria-live="polite">{#each backupCheck as message}<li>{message}</li>{/each}</ul>
  <div bind:this={backupTestHost}></div>
  <h2>Проверка прямого QR-подключения</h2>
  <p>Два временных клиента в памяти. Настоящий WebRTC и шифрование; пользовательские аккаунты и история не меняются.</p>
  <button onclick={() => runDirectCheck()} disabled={directBusy}>{directBusy ? 'Проверяем…' : 'Проверить два клиента без серверов'}</button>
  <button onclick={() => runDirectCheck(60_000)} disabled={directBusy}>Проверить ожидание ответа 60 секунд</button>
  {#if directBusy}<button onclick={() => directAbort?.abort()}>Отменить проверку</button>{/if}
  <ul aria-live="polite">{#each directCheck as message}<li>{message}</li>{/each}</ul>
{/if}
