<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import { onMount } from 'svelte';
  import { MAX_BACKUP_BYTES, openEncryptedBackup, type OpenedBackup } from './encrypted-backup';
  import { MAX_FULL_BACKUP_BYTES, isFullBackup, openFullBackup, disposeFullBackup } from '$lib/backup/full-backup';
  import { isDataBackup } from '$lib/backup/data-backup';
  let { expectedAccountId = '', onOpened, label = 'Открыть резервную копию' }: {
    expectedAccountId?: string;
    onOpened: (backup: OpenedBackup) => Promise<boolean>;
    label?: string;
  } = $props();
  let file = $state<File | null>(null);
  let password = $state('');
  let busy = $state(false);
  let error = $state('');
  let token = 0;
  let opened = $state<OpenedBackup | null>(null);
  const discard = () => { opened?.seed.fill(0); disposeFullBackup(opened?.full); opened = null; };

  async function accept(): Promise<void> {
    if (!opened || busy) return;
    busy = true; error = ''; const work = token;
    try { if (!await onOpened(opened) && work === token) error = 'Не удалось восстановить копию. Существующие данные не заменены.'; }
    catch { if (work === token) error = 'Не удалось восстановить копию. Существующие данные не заменены.'; }
    finally { discard(); if (work === token) busy = false; }
  }

  async function open(): Promise<void> {
    if (busy || !file || !password) return;
    const selected = file;
    const entered = password;
    password = ''; busy = true; error = '';
    const work = ++token;
    let backup: Awaited<ReturnType<typeof openEncryptedBackup>> | undefined;
    try {
      if (selected.size > MAX_FULL_BACKUP_BYTES) throw new Error('backup_too_large');
      const guard = () => { if (work !== token) throw new Error('backup_cancelled'); };
      const header = new Uint8Array(await selected.slice(0, 8).arrayBuffer()); guard();
      if (isDataBackup(header)) throw new Error('backup_data_only');
      if (isFullBackup(header)) backup = await openFullBackup(selected, entered, expectedAccountId, guard);
      else {
        if (selected.size > MAX_BACKUP_BYTES) throw new Error('backup_too_large');
        backup = await openEncryptedBackup(await selected.text(), entered, expectedAccountId);
      }
      if (work !== token) return;
      if (expectedAccountId && backup.accountId !== expectedAccountId) throw new Error('backup_wrong_account');
      if (backup.full) { discard(); opened = backup; backup = undefined; return; }
      if (!await onOpened(backup) && work === token) error = 'Не удалось завершить проверку. Попробуйте ещё раз.';
    } catch (cause) {
      if (work === token) error = cause instanceof Error && cause.message === 'backup_wrong_account'
        ? 'Это резервная копия другого аккаунта.' : cause instanceof Error && cause.message === 'backup_data_only'
        ? 'В этой копии нет сида. Сначала восстановите доступ сидом или файлом доступа, затем откройте нужный профиль → Безопасность → Резервные копии → Только данные.'
        : 'Не удалось открыть файл. Проверьте пароль и выберите неповреждённую резервную копию Automesh.';
    } finally { backup?.seed.fill(0); disposeFullBackup(backup?.full); if (work === token) busy = false; }
  }
  onMount(() => {
    const hide = () => { if (document.hidden) { token++; password = ''; busy = false; discard(); } };
    document.addEventListener('visibilitychange', hide);
    return () => { token++; password = ''; file = null; discard(); document.removeEventListener('visibilitychange', hide); };
  });
</script>

<form autocomplete="off" onsubmit={(event) => { event.preventDefault(); void open(); }}>
  <label class="field">{$i18n.text("Файл резервной копии")}
    <input type="file" accept=".automesh,.automesh-backup,.automesh-data,.json,application/json,application/octet-stream" disabled={busy} onchange={(event) => {
      discard(); file = event.currentTarget.files?.[0] ?? null; error = ''; password = '';
      if (file && file.size > MAX_FULL_BACKUP_BYTES) { file = null; event.currentTarget.value = ''; error = 'Для этой версии максимальный размер копии — 128 МБ.'; }
    }} />
  </label>
  <label class="field">{$i18n.text("Пароль файла")} <input type="password" bind:value={password} autocomplete="off" disabled={busy} /></label>
  <button type="submit" disabled={busy || !file || !password}>{busy ? $i18n.text("Расшифровываем…") : label}</button>
  {#if error}<p role="alert">{$i18n.text(error)}</p>{/if}
</form>

{#if opened?.full}
  <section aria-label={$i18n.text("Содержимое полной копии")}>
    <h4>{$i18n.text("Полная копия проверена")}</h4>
    <p>{$i18n("m_eeef1ac5326b", {v0: (opened.full.summary.profiles), v1: (opened.full.summary.contacts), v2: (opened.full.summary.messages), v3: (opened.full.summary.files)})}</p>
    {#if opened.full.summary.missingFiles}<p>{$i18n("m_0478b7c66960", {v0: (opened.full.summary.missingFiles)})}</p>{/if}
    <p>{$i18n.text("Восстановление — только в пустое хранилище этих профилей. Существующие чаты не заменяются. Старые отправки не повторяются; подключения к нодам нужно проверить заново.")}</p>
    <button type="button" disabled={busy} onclick={() => void accept()}>{$i18n.text(label)}</button>
    <button type="button" disabled={busy} onclick={discard}>{$i18n.text("Отмена")}</button>
  </section>
{/if}

<style>.field { display:block; margin:12px 0; } .field input { display:block; max-width:100%; margin-top:4px; }</style>
