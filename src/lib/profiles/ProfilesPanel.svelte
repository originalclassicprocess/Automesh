<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import { onMount } from 'svelte';
  import { loadVault } from '$lib/vault/vault';
  import { accountFromMnemonic } from '$lib/application/account';
  import { openBrowserProfileBundle } from './browser';
  import { visibleInboxSources, type ProfileRegistry, type InboxPermission } from '$lib/core/profiles';
  import { PROFILE_PRESETS, profilePreset, type ProfilePresetId } from './presets';
  import { PROFILE_FEATURES } from './features';
  import EncryptedBackup from '$lib/vault/EncryptedBackup.svelte';
  import BackupReader from '$lib/vault/BackupReader.svelte';
  import HelpInfo from '$lib/application/HelpInfo.svelte';
  import type { OpenedBackup } from '$lib/vault/encrypted-backup';
  let { accountId, nickname, trusted, blocked = false, readVault = loadVault, factory, onChange, activeProfileId = '', chatSwitching = false, mode = 'all' }: {
    accountId: string; nickname: string; trusted: boolean; blocked?: boolean;
    readVault?: typeof loadVault; factory?: IDBFactory;
    onChange?(value: ProfileRegistry): void; activeProfileId?: string;
    chatSwitching?: boolean;
    mode?: 'all' | 'manage' | 'backup';
  } = $props();
  let bundle = $state.raw<Awaited<ReturnType<typeof openBrowserProfileBundle>> | undefined>();
  let registry = $state<ProfileRegistry | null>(null), password = $state(''), busy = $state(false), error = $state('');
  let selected = $state(''), name = $state(''), rename = $state(''), preset = $state<ProfilePresetId>('work');
  let showNewInAll = $state(true);
  let now = $state(Date.now());
  let copied = $state('');
  let consent = $state<{ subId: string; permission: InboxPermission; enabled: boolean; scope: string[] } | null>(null), backup = $state(false), importing = $state(false);
  let token = 0, destroyed = false;
  let viewer = $derived(registry?.profiles.find(p => p.id === selected));
  let mainId = $derived(registry?.profiles.find(p => p.role === 'main')?.id ?? '');
  let sources = $derived(PROFILE_FEATURES.advancedInbox && registry && mainId ? visibleInboxSources(registry, mainId, now) : []);
  let contributed = $derived(sources.includes(selected));
  let readingOthers = $derived(PROFILE_FEATURES.advancedInbox && (registry?.connections.some(c => c.subId === selected && c.permission === 'read-all' && c.status === 'active' && c.validUntil > Math.max(now,registry?.lastNow ?? 0)) ?? false));
  const title = (id: string) => registry?.profiles.find(p => p.id === id)?.name ?? id;
  function close() {
    token++; bundle?.close(); bundle = undefined; registry = null; password = ''; busy = false;
    selected = ''; consent = null; backup = false; importing = false; name = ''; rename = ''; copied = ''; showNewInAll = true;
  }
  $effect(() => { if (!trusted || blocked) close(); });
  onMount(() => {
    const clock = PROFILE_FEATURES.advancedInbox ? setInterval(() => { now = Math.max(now, Date.now()); }, 1000) : undefined;
    const hide = () => { if (document.hidden) close(); };
    document.addEventListener('visibilitychange', hide);
    return () => { destroyed = true; close(); clearInterval(clock); document.removeEventListener('visibilitychange', hide); };
  });
  function display(value: ProfileRegistry) {
    registry = value;
    onChange?.(value);
    if (!value.profiles.some(p => p.id === selected && p.role !== 'main'))
      selected = value.profiles.find(p => p.id === activeProfileId && p.role !== 'main')?.id
        ?? value.profiles.find(p => p.role !== 'main' && !p.archived)?.id ?? '';
  }
  function message(cause: unknown) {
    const code = cause instanceof Error ? cause.message : '';
    return code === 'profile_backup_conflict' ? 'Список профилей конфликтует с локальной связкой. Данные не заменены.'
      : code === 'profile_consent_changed' ? 'Список доступных чатов изменился. Откройте подтверждение заново; новые права не выданы.'
      : code === 'profile_backup_address_mismatch' || code === 'profile_backup_owner_mismatch' ? 'Адреса файла не соответствуют этому аккаунту.'
      : 'Не удалось выполнить операцию. Проверьте хранилище; существующие данные не удалены.';
  }
  async function unlock() {
    if (busy || blocked || !trusted || !password) return;
    busy = true; error = ''; const work = ++token, entered = password, scope = accountId; password = '';
    const current = () => !destroyed && work === token && trusted && !blocked && accountId === scope;
    let account: Awaited<ReturnType<typeof accountFromMnemonic>> | undefined;
    let opened: typeof bundle;
    let seed: Uint8Array | undefined;
    try {
      const vault = await readVault(entered); seed = vault?.mnemonic;
      if (!current()) return;
      if (!seed) { error = 'Неверный пароль аккаунта.'; return; }
      account = await accountFromMnemonic(new TextDecoder().decode(seed));
      if (!current()) return;
      if (account.accountId !== scope) throw new Error('profile_backup_owner_mismatch');
      opened = await openBrowserProfileBundle({ root: account.identitySeed, scope, trusted, factory, isCurrent: current });
      if (!current()) return;
      // Do not auto-initialize: a restored registry must be imported first.
      let saved: ProfileRegistry | undefined;
      try { saved = await opened.read(); }
      catch (cause) { if (!(cause instanceof Error) || cause.message !== 'profile_registry_missing') throw cause; }
      if (!current()) return;
      bundle?.close(); bundle = opened; opened = undefined;
      if (saved) display(saved);
    } catch (cause) { if (current()) error = message(cause); }
    finally { seed?.fill(0); account?.identitySeed.fill(0); account?.provider.dispose(); opened?.close(); if (work === token) busy = false; }
  }
  async function act(run: (active: NonNullable<typeof bundle>) => Promise<ProfileRegistry>) {
    if (!bundle || busy || blocked) return;
    const active = bundle, work = token; busy = true; error = '';
    try { const result = await run(active); if (work === token && active === bundle) display(result); }
    catch (cause) { if (work === token) error = message(cause); }
    finally { if (work === token) busy = false; }
  }
  async function importFile(file: OpenedBackup) {
    if (!file.profiles || file.accountId !== accountId || !bundle || busy) { error = 'Нужен файл со связкой профилей этого аккаунта (формат 2).'; return false; }
    const active = bundle, work = token; busy = true; error = '';
    try {
      const result = await active.restore(file.profiles);
      if (work !== token || active !== bundle) return false;
      display(result); importing = false; return true;
    } catch (cause) { if (work === token) error = message(cause); return false; }
    finally { if (work === token) busy = false; }
  }
  async function copy(id: string) {
    const work = token;
    try { await navigator.clipboard.writeText(id); if (work === token) copied = id; }
    catch { if (work === token) error = 'Не удалось скопировать. Адрес можно выделить вручную.'; }
  }
  function askPermission(permission: InboxPermission, enabled: boolean) {
    if (!registry || !viewer || viewer.archived || busy) return;
    consent = { subId: viewer.id, permission, enabled,
      scope: permission === 'contribute' ? [viewer.id] : visibleInboxSources(registry,mainId,now) };
  }
  async function createPreset() {
    const chosen = profilePreset(preset), entered = name.trim() || chosen.name;
    let created = '';
    await act(async active => { const result = await active.createPreset(chosen.id,entered,showNewInAll); created = result.profiles.at(-1)!.id; return result; });
    if (!error && registry?.profiles.some(p => p.id === created)) { selected = created; name = ''; }
  }
  async function createProfile() {
    const entered = name.trim();
    if (!entered) return;
    let created = '';
    await act(async active => { const result = await active.create('custom', entered); created = result.profiles.at(-1)!.id; return result; });
    if (!error && registry?.profiles.some(p => p.id === created)) { selected = created; name = ''; }
  }
</script>

<section class="profiles-panel" aria-label={$i18n.text("Связка профилей")}>
  <h3>{mode === 'backup' ? $i18n.text("Список профилей") : $i18n.text("Профили")}</h3>
  {#if mode === 'backup'}<p>{$i18n.text("Резервный файл списка профилей. Не переносит переписку.")}</p>{:else}
  <p>{$i18n.text("Каждый профиль — отдельный адрес со своими чатами. Пароль аккаунта общий.")}</p>
  <p><small>{chatSwitching ? $i18n.text("Выбор — в шапке. В сети только выбранный профиль; выбор сохраняется после блокировки и перезагрузки.") : $i18n.text("В этом тестовом окне доступно управление, без подключения чатов.")}</small></p>
  {/if}
  {#if !trusted}
    <p>{$i18n.text("Для хранения связки нужен доверенный режим. Независимые профили во временной сессии пока не включены.")}</p>
  {:else if !bundle}
    <form onsubmit={event => { event.preventDefault(); void unlock(); }}>
      <label>{$i18n.text("Пароль аккаунта")} <input type="password" bind:value={password} autocomplete="current-password" disabled={busy || blocked} /></label>
      <button disabled={busy || blocked || !password}>{busy ? $i18n.text("Открываем…") : mode === 'backup' ? $i18n.text("Открыть резервные копии") : $i18n.text("Открыть управление профилями")}</button>
    </form>
  {:else}
    {#if mode !== 'backup'}
    {#if !registry}
      <p>{$i18n("m_3d86fd59c0e7", {v0: (mode === 'manage' ? $i18n.text("Если есть резервный файл, сначала восстановите список в разделе «Безопасность».") : $i18n.text("Если есть резервный файл с профилями, сначала восстановите его ниже."))})}</p>
      <button disabled={busy} onclick={() => act(active => active.initializePersonal(true))}>{$i18n.text("Включить профили для этого аккаунта")}</button>
    {:else}
      <div class="profile-list" aria-label={$i18n.text("Управление профилем")}>
        {#each registry.profiles.filter(p => p.role !== 'main') as profile}
          <button disabled={busy} aria-pressed={selected === profile.id} onclick={() => { selected = profile.id; rename = ''; consent = null; }}>
            {profile.name}<small>{profile.id === activeProfileId ? $i18n.text("Сейчас выбран") : $i18n.text("Отдельный адрес")}{profile.archived ? $i18n.text("· архив") : ''}</small>
          </button>
        {/each}
      </div>
      {#if viewer}
        <p><strong>{$i18n("m_9ba9154ca1e0", {v0: (viewer.name)})}</strong>{viewer.id !== activeProfileId ? $i18n.text("· для общения выберите его в шапке") : ''}</p>
        <p>{$i18n.text("Адрес профиля:")}</p><code class="address">{viewer.accountId}</code>
        <button onclick={() => copy(viewer!.accountId)}>{copied === viewer.accountId ? $i18n.text("Скопировано") : $i18n.text("Копировать адрес")}</button>
        <details><summary>{$i18n.text("Изменить название")}</summary><form onsubmit={event => { event.preventDefault(); if (rename.trim()) void act(active => active.update(selected, { name: rename.trim() })); }}>
          <label>{$i18n.text("Новое имя")} <input bind:value={rename} maxlength="80" disabled={busy} /></label>
          <button disabled={busy || !rename.trim()}>{$i18n.text("Переименовать")}</button>
        </form><small>{$i18n.text("Это название только для вас. Публичный ник меняется в настройках выбранного профиля.")}</small></details>
        {#if viewer.role !== 'main'}<button disabled={busy || selected === activeProfileId} title={selected === activeProfileId ? $i18n.text("Сначала переключитесь на другой профиль") : ''} onclick={() => act(active => active.update(selected, { archived: !viewer!.archived }))}>{viewer.archived ? $i18n.text("Вернуть из архива") : $i18n.text("Архивировать профиль")}</button>{/if}
        {#if PROFILE_FEATURES.advancedInbox && !viewer.archived}
          <div class="access-setting"><span>{$i18n.text("Показывать чаты в «Все чаты»")}<small>{$i18n.text("Локальный просмотр, без пересылки в сеть. Действует, пока не выключите.")}</small></span>
            <button disabled={busy} aria-pressed={contributed} onclick={() => askPermission('contribute',!contributed)}>{contributed ? $i18n.text("Включено") : $i18n.text("Выключено")}</button></div>
          <div class="access-setting"><span>{$i18n.text("Видеть чаты других профилей")}<small>{$i18n.text("По умолчанию выключено. Разрешение на 7 дней, только на перечисленные при подтверждении источники.")}</small></span>
            <button disabled={busy} aria-pressed={readingOthers} onclick={() => askPermission('read-all',!readingOthers)}>{readingOthers ? $i18n.text("Включено") : $i18n.text("Выключено")}</button></div>
        {/if}
      {/if}
      {#if PROFILE_FEATURES.advancedInbox && consent}
        <section class="consent" aria-label={$i18n.text("Подтверждение подключения профиля")}>
          <h4>{$i18n.text("Подтвердить доступ")}</h4>
          <p>{!consent.enabled ? $i18n("m_aa4dc246e917", {v0: (title(consent.subId))}) : consent.permission === 'contribute' ? $i18n("m_bb8661efce52", {v0: (title(consent.subId))}) : $i18n("m_e68607b2d36c", {v0: (title(consent.subId)), v1: (consent.scope.map(title).join(', '))})}</p>
          <p>{$i18n.text("Не публикует связь адресов в сети и не разрешает отправку от чужого имени. Уже прочитанное нельзя забрать обратно.")}</p>
          <button disabled={busy} onclick={() => { const setting = $state.snapshot(consent!); consent = null; void act(active => active.configureInbox(setting.subId,setting.permission,setting.enabled,setting.scope)); }}>{$i18n.text("Подтвердить")}</button>
          <button onclick={() => consent = null}>{$i18n.text("Отмена")}</button>
        </section>
      {/if}
      <h4>{$i18n.text("Добавить профиль")}</h4>
      {#if PROFILE_FEATURES.advancedInbox}
      <form onsubmit={event => { event.preventDefault(); void createPreset(); }}>
        <label>{$i18n.text("Шаблон")} <select bind:value={preset} disabled={busy}>
          {#each PROFILE_PRESETS as p}<option value={p.id}>{$i18n.text(p.name)}</option>{/each}
        </select></label>
        <label>{$i18n.text("Название (необязательно)")} <input bind:value={name} placeholder={$i18n.text(profilePreset(preset).name)} maxlength="80" disabled={busy} /></label>
        <p>{$i18n.text(profilePreset(preset).description)}</p>
        <label class="checkbox"><input type="checkbox" bind:checked={showNewInAll} disabled={busy} /> {$i18n.text("Показывать чаты нового профиля в «Все чаты»")}</label>
        <small>{$i18n.text("Создание подтверждает только этот локальный доступ, до его отключения. Новый профиль не получает доступ к чужим чатам и не подключается к сети автоматически.")}</small>
        <button disabled={busy}>{$i18n.text("Добавить профиль")}</button>
      </form>
      {:else}
      <form onsubmit={event => { event.preventDefault(); void createProfile(); }}>
        <label>{$i18n.text("Название профиля")} <input bind:value={name} placeholder={$i18n.text("Например, Рабочий")} maxlength="80" required disabled={busy} /></label>
        <button disabled={busy || !name.trim()}>{$i18n.text("Добавить профиль")}</button>
      </form>
      <p><small>{$i18n.text("Для общения выберите новый профиль в шапке.")}</small> <HelpInfo label={$i18n.text("Справка: новый профиль")} text={$i18n.text("У профиля отдельные адрес, история и настройки ноды. Он не читает чаты других профилей и не подключается автоматически. Название видно только вам; имя для собеседников задаётся отдельно.")} /></p>
      {/if}
      <details><summary>{$i18n.text("Как устроены профили")}</summary><p>{$i18n.text("У каждого профиля свой адрес, история и настройки ноды. Для общения выберите его в шапке. Доступно до 255 профилей, включая архивные.")}</p><p>{$i18n.text("Один сид восстанавливает ключи всех профилей. Список и названия сохраняйте в резервной копии после изменений. Разные адреса не гарантируют анонимность.")}</p></details>
    {/if}
    {/if}
    {#if mode !== 'manage'}
    {#if registry}
      <button disabled={busy} onclick={() => { backup = !backup; importing = false; }}>{$i18n.text("Сохранить копию доступа и профилей")}</button>
      {#if backup}<EncryptedBackup {accountId} {nickname} {readVault} readProfiles={() => bundle!.read()} onVerified={async () => Boolean(bundle && !blocked)} onClose={() => backup = false} />{/if}
    {/if}
    <button disabled={busy} onclick={() => { importing = !importing; backup = false; }}>{$i18n.text("Восстановить профили из копии доступа")}</button>
    {#if importing}
      <p>{$i18n.text("Импорт восстанавливает список адресов, но не переносит переписку и не заменяет локальные имена. Конфликтующие адреса отклоняются.")}</p>
      <BackupReader expectedAccountId={accountId} onOpened={importFile} label={$i18n.text("Восстановить список профилей")} />
    {/if}
    {/if}
    {#if mode === 'manage'}<small>{$i18n.text("Перенос списка профилей — в «Безопасность → Резервная копия».")}</small>{/if}
    <button disabled={busy} onclick={close}>{$i18n.text("Закрыть управление")}</button>
  {/if}
  {#if error}<p role="alert">{$i18n.text(error)}</p>{/if}
</section>

<style>
  .profiles-panel { margin-top:16px; }
  .profiles-panel small { color:var(--muted, #586465); }
  .profile-list { display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:8px; margin:12px 0; }
  .profile-list button { text-align:left; }
  .profile-list button[aria-pressed=true] { border:2px solid var(--accent,#287061); }
  .profile-list small { display:block; margin-top:4px; }
  .address { display:block; overflow-wrap:anywhere; margin-bottom:8px; }
  form { display:flex; flex-wrap:wrap; gap:8px; align-items:end; margin:12px 0; }
  label { display:grid; gap:6px; max-width:100%; }
  input,select { max-width:100%; }
  button { margin:4px 4px 4px 0; }
  .consent { padding:12px; border:1px solid var(--border,#d1d9d7); border-radius:12px; margin:8px 0; }
  .access-setting { display:flex; justify-content:space-between; gap:12px; align-items:center; margin:12px 0; }
  .access-setting small { display:block; } .checkbox { display:flex; align-items:center; }
</style>
