<script lang="ts">
import { onMount, onDestroy } from 'svelte';
import { replaceState } from '$app/navigation';
import { visibleInboxSources, type ProfileRegistry, type ProfileRole, type InboxConnection } from '$lib/core/profiles';
import type { openProfileBrowserCheck } from '$lib/profiles/browser-check';
import ProfilesPanel from '$lib/profiles/ProfilesPanel.svelte';
let fixture: Awaited<ReturnType<typeof openProfileBrowserCheck>> | undefined;
let registry = $state<ProfileRegistry | null>(null), current = $state(''), target = $state('');
let name = $state(''), role = $state<Exclude<ProfileRole, 'main'>>('personal');
let busy = $state(false), ready = $state(false), status = $state(''), link = $state('');
let consent = $state<InboxConnection | null>(null), destroyed = false;
let managerOpen = $state(false);
let managerFactory = $state.raw<IDBFactory | undefined>();
const publicPhrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const publicAccountId = 'mesh1q93lgc7ekj058ysfcfev89jcqnzceh4hps85cz4m';
const testVault = async (password: string) => password === 'public-test-password'
  ? { mnemonic: new TextEncoder().encode(publicPhrase), metadata: null } : null;
const labels: Record<ProfileRole, string> = { main: 'Главный · локальный', personal: 'Личный', incoming: 'Входящий', outgoing: 'Исходящий', custom: 'Другой' };
let viewer = $derived(registry?.profiles.find(p => p.id === current));
let main = $derived(registry?.profiles.find(p => p.role === 'main'));
let sub = $derived(viewer?.role === 'main' ? target : current);
let sources = $derived(registry && current ? visibleInboxSources(registry, current, Math.max(Date.now(), registry.lastNow)) : []);
onMount(() => {
  void (async () => {
    try {
      const url = new URL(location.href), id = url.searchParams.get('run') || crypto.randomUUID();
      url.searchParams.set('run', id);
      const { openProfileBrowserCheck, profileCheckFactory } = await import('$lib/profiles/browser-check');
      const opened = await openProfileBrowserCheck(id);
      if (destroyed) { opened.close(); return; }
      fixture = opened; replaceState(url, {}); link = url.href; ready = true;
      managerFactory = profileCheckFactory(indexedDB, id);
    } catch (e) { status = 'ОШИБКА: ' + (e instanceof Error ? e.message : 'unknown'); }
  })();
});
onDestroy(() => { destroyed = true; fixture?.close(); });
async function action(work: () => Promise<ProfileRegistry | null>) {
  if (busy || !fixture) return;
  busy = true; status = '';
  try {
    registry = await work();
    if (registry) {
      if (!registry.profiles.some(p => p.id === current)) current = registry.profiles[0].id;
      if (!registry.profiles.some(p => p.id === target)) target = registry.profiles.find(p => p.role !== 'main')?.id ?? '';
    } else { current = ''; target = ''; }
    status = 'Сохранено в отдельной тестовой базе.';
  } catch (e) { status = 'ОШИБКА: ' + (e instanceof Error ? e.message : 'unknown'); }
  finally { busy = false; }
}
const title = (id: string) => registry?.profiles.find(p => p.id === id)?.name ?? id;
async function prepare() {
  await action(async () => {
    await fixture!.clear();
    await fixture!.bundle.initialize('Старый личный');
    await fixture!.bundle.create('incoming', 'Входящий');
    return fixture!.bundle.create('outgoing', 'Исходящий');
  });
}
async function request(permission: 'contribute' | 'read-all') {
  await action(() => fixture!.bundle.request(sub, permission, current, Date.now() + 7 * 86400000));
}
function askConsent(c: InboxConnection) { consent = $state.snapshot(c); }
async function approve() {
  if (!consent) return;
  const id = consent.id; consent = null;
  await action(() => fixture!.bundle.decide(id, current, 'approve'));
}
</script>
<svelte:head><title>Профили — изолированная проверка</title><meta name="robots" content="noindex, nofollow" /></svelte:head>
<section class="check">
  <h1>Профили и разрешения — тест</h1>
  <p>Вымышленные ключи, отдельная тестовая база. Настоящий сейф и чаты не открываются. Сети, ноды, пересылка истории и подключение чужих аккаунтов не используются.</p>
  <div class="controls">
    <button disabled={!ready || busy} onclick={prepare}>Создать тестовую связку</button>
    <button disabled={!ready || busy} onclick={() => action(() => fixture!.bundle.read())}>Открыть сохранённую связку</button>
    <button disabled={!ready || busy} onclick={() => action(async () => { await fixture!.clear(); return null; })}>Очистить тестовую связку</button>
  </div>
  <button disabled={!ready} onclick={() => managerOpen = !managerOpen}>{managerOpen ? 'Скрыть окно настроек' : 'Проверить окно управления профилями'}</button>
  {#if managerOpen}
    <p>Это тот же компонент, что в настройках, но с публичным аккаунтом и отдельной тестовой базой. Тестовый пароль: public-test-password. Настоящий сейф не используется.</p>
    <ProfilesPanel accountId={publicAccountId} nickname="Public test" trusted={true} readVault={testVault} factory={managerFactory} />
  {/if}
  <p role="status">{busy ? 'Работаем…' : status}</p>
  {#if registry}
    <h2>Действуете как</h2>
    <div class="profiles" aria-label="Выбор тестового профиля">
      {#each registry.profiles as p}
        <button disabled={busy} aria-pressed={current === p.id} onclick={() => { current = p.id; consent = null; }}>
          {p.name}<small>{labels[p.role]}</small>
        </button>
      {/each}
    </div>
    {#if viewer}
      <p>Отдельный Mesh ID: <code>{viewer.accountId}</code></p>
      {#if viewer.role === 'main'}<p>Этот адрес по умолчанию не публикуется и не подключается к сигналингу.</p>{/if}
      <h2>Доступные источники входящих</h2>
      <ul>{#each sources as id}<li>{title(id)}</li>{/each}</ul>
      <p>Это проверка разрешений, а не отображение настоящей переписки. Ответы от имени другого профиля этим доступом не разрешаются.</p>
    {/if}
    <h2>Подключение к главному профилю</h2>
    {#if viewer?.role === 'main'}
      <label>Субпрофиль <select bind:value={target} disabled={busy}>{#each registry.profiles.filter(p => p.role !== 'main') as p}<option value={p.id}>{p.name}</option>{/each}</select></label>
    {/if}
    <div class="controls">
      <button disabled={busy || !sub} onclick={() => request('contribute')}>Запрос: передавать входящие главному</button>
      <button disabled={busy || !sub} onclick={() => request('read-all')}>Запрос: читать общий ящик</button>
    </div>
    <p>Запрос действует 10 минут. Разрешение — 7 дней. Принимает другая сторона: переключитесь на неё выше. Два направления подтверждаются отдельно.</p>
    <ul class="connections">
      {#each registry.connections as c}
        <li>
          <strong>{title(c.subId)} · {c.permission === 'contribute' ? 'Передача входящих главному' : 'Чтение общего ящика'}</strong>
          <p>Состояние: {c.validUntil <= Date.now() ? 'истёк' : c.status === 'pending' ? 'ожидает подтверждения' : c.status === 'active' ? 'подключён' : c.status === 'rejected' ? 'отклонён' : 'отозван'}</p>
          <p>Источники доступа: {c.scope.map(title).join(', ')}</p>
          {#if c.status === 'pending' && c.requestExpiresAt > Date.now() && !c.approvedBy.includes(current) && [main?.id, c.subId].includes(current)}
            <button disabled={busy} onclick={() => askConsent(c)}>Принять запрос…</button>
            <button disabled={busy} onclick={() => action(() => fixture!.bundle.decide(c.id, current, 'reject'))}>Отклонить</button>
          {/if}
          {#if ['pending', 'active'].includes(c.status) && [main?.id, c.subId].includes(current)}
            <button disabled={busy} onclick={() => action(() => fixture!.bundle.decide(c.id, current, 'revoke'))}>Отозвать</button>
          {/if}
        </li>
      {/each}
    </ul>
    {#if consent}
      <section class="consent" aria-label="Подтверждение доступа">
        <h2>Подтвердить подключение</h2>
        <p>{consent.permission === 'contribute' ? `${title(consent.subId)} разрешит главному профилю видеть свои входящие.` : `${title(consent.subId)} получит чтение источников: ${consent.scope.map(title).join(', ')}.`}</p>
        <p>Не даёт ключи, право отправки от чужого имени или доступ к новым источникам. Уже прочитанное нельзя забрать обратно.</p>
        <button disabled={busy} onclick={approve}>Подтвердить доступ</button>
        <button onclick={() => { consent = null; }}>Отмена</button>
      </section>
    {/if}
    <h2>Добавить отдельный профиль</h2>
    <form onsubmit={e => { e.preventDefault(); void action(() => fixture!.bundle.create(role, name.trim())); }}>
      <label>Имя <input bind:value={name} maxlength="80" required disabled={busy} /></label>
      <label>Назначение <select bind:value={role} disabled={busy}><option value="personal">Личный</option><option value="incoming">Входящий</option><option value="outgoing">Исходящий</option><option value="custom">Другой</option></select></label>
      <button disabled={busy || !name.trim()}>Создать профиль</button>
    </form>
  {/if}
  {#if link}<p>Для проверки восстановления после reload сохраните <a href={link}>эту ссылку</a>, затем нажмите «Открыть сохранённую связку», не создавая заново.</p>{/if}
  <p>Главная seed даёт владельцу все ключи связки. Переключение тестового профиля не является отдельной аутентификацией или защитой от вредоносного кода браузера.</p>
  <a href="/">Вернуться в приложение</a>
</section>
<style>
  .check { max-width:850px; margin:auto; padding:12px; }
  .controls,.profiles,form { display:flex; flex-wrap:wrap; gap:10px; align-items:center; }
  .profiles button { flex:1 1 160px; text-align:left; }
  small { display:block; font-size:13px; opacity:.75; }
  [aria-pressed='true'] { outline:2px solid var(--accent,#346b55); }
  code { overflow-wrap:anywhere; }
  .connections { list-style:none; padding:0; }
  .connections li,.consent { padding:14px; border:1px solid #aaa; border-radius:12px; margin:12px 0; }
  .consent { background:#edf4ef; }
  label { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
</style>
