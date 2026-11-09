<script lang="ts">
  import {locale as uiLocale} from '$lib/i18n/language';
  import { tr as i18n } from '$lib/i18n/language';
  import { onMount } from 'svelte';
  import { MAX_FULL_BACKUP_BYTES, disposeFullBackup } from './full-backup';
  import { isDataBackup, openDataBackup, type DataBackupContents } from './data-backup';
  let { accountId, onOpened, label = 'Восстановить данные' }: { accountId: string;
    onOpened(data: DataBackupContents, guard: () => void): Promise<boolean>; label?: string } = $props();
  let file = $state<File | null>(null), password = $state(''), busy = $state(false), error = $state('');
  let opened = $state<DataBackupContents | null>(null), token = 0;
  let fileInput: HTMLInputElement | undefined = $state();
  const discard = () => { disposeFullBackup(opened ?? undefined); opened = null; };
  async function open() {
    if (busy || !file || !password) return;
    const selected = file, entered = password, work = ++token;
    password = ''; error = ''; busy = true; discard();
    let data: DataBackupContents | undefined;
    try {
      const guard = () => { if (work !== token) throw new Error('backup_cancelled'); };
      if (!isDataBackup(new Uint8Array(await selected.slice(0, 8).arrayBuffer()))) throw new Error('backup_not_data');
      data = await openDataBackup(selected, entered, accountId, guard); guard(); opened = data; data = undefined;
    } catch (cause) {
      if (work === token) {
        const code = cause instanceof Error ? cause.message : '';
        error = code === 'backup_wrong_account' ? 'Копия относится к другому профилю. Откройте нужный профиль и повторите.' :
          code === 'backup_not_data' ? 'Это не копия данных без сида. Файл доступа или полную копию открывайте через восстановление аккаунта.' :
          'Не удалось открыть копию данных. Проверьте пароль и целостность файла.';
      }
    } finally { disposeFullBackup(data); if (work === token) busy = false; }
  }
  async function accept() {
    if (!opened || busy) return;
    busy = true; error = ''; const work = token;
    try {
      const guard = () => { if (work !== token) throw new Error('backup_cancelled'); };
      if (!await onOpened(opened, guard) && work === token) error = 'Данные не восстановлены. Существующая история не заменена.';
      else if (work === token) { discard(); file = null; if (fileInput) fileInput.value = ''; }
    } catch (cause) {
      if (work === token) {
        const code = cause instanceof Error ? cause.message : '';
        error = code === 'backup_destination_not_empty' ? 'В этом профиле уже есть переписка, контакты или медиа. Эта версия не объединяет истории и не перезаписывает их.' :
          code === 'backup_destination_changed' ? 'Во время восстановления данные изменились. Ничего не перезаписано; повторите проверку.' :
          'Восстановление не завершено. Проверьте свободное место и повторите. Существующая история не заменена.';
      }
    } finally { if (work === token) busy = false; }
  }
  onMount(() => {
    const hide = () => { if (document.hidden) { token++; password = ''; busy = false; discard(); } };
    document.addEventListener('visibilitychange', hide);
    return () => { token++; password = ''; discard(); document.removeEventListener('visibilitychange', hide); };
  });
</script>

<section aria-label={$i18n.text("Открыть копию данных")}>
  <form onsubmit={event => { event.preventDefault(); void open(); }}>
    <label>{$i18n.text("Файл копии данных")}<input bind:this={fileInput} type="file" accept=".automesh-data,application/octet-stream" disabled={busy} onchange={event => {
      token++; discard(); error = ''; password = ''; file = event.currentTarget.files?.[0] ?? null;
      if (file && file.size > MAX_FULL_BACKUP_BYTES) { file = null; event.currentTarget.value = ''; error = 'Максимальный размер копии этой версии — 128 МБ.'; }
    }} /></label>
    <label>{$i18n.text("Пароль копии данных")}<input type="password" autocomplete="off" bind:value={password} disabled={busy} /></label>
    <button type="submit" disabled={busy || !file || !password}>{busy ? $i18n.text("Проверяем…") : $i18n.text("Проверить копию данных")}</button>
  </form>
  {#if opened}
    <p role="status">{$i18n("m_c36fa6f929f9", {v0: (opened.summary.messages), v1: (opened.summary.contacts), v2: (opened.summary.files)})}</p>
    <p class="help-text">{$i18n("m_4241c4d25ad5", {v0: (new Date(opened.createdAt).toLocaleString($uiLocale)), v1: (opened.summary.missingFiles ? $i18n("m_ec2c9879cdfe", {v0: (opened.summary.missingFiles)}) : '')})}</p>
    <p class="help-text">{$i18n.text("Импорт — только в пустую историю этого профиля. Сетевые настройки и права устройств не восстанавливаются, старые сообщения не отправляются заново.")}</p>
    <button type="button" disabled={busy} onclick={() => void accept()}>{$i18n.text(label)}</button>
    <button type="button" disabled={busy} onclick={discard}>{$i18n.text("Отмена")}</button>
  {/if}
  {#if error}<p role="alert">{$i18n.text(error)}</p>{/if}
</section>

<style>
  label { display:flex; flex-direction:column; gap:8px; margin:12px 0; }
  input { max-width:100%; }
</style>
