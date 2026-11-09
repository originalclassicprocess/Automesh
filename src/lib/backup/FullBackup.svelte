<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import { onMount } from 'svelte';
  import { loadVault } from '$lib/vault/vault';
  import BackupReader from '$lib/vault/BackupReader.svelte';
  import EncryptedBackup from '$lib/vault/EncryptedBackup.svelte';
  import DataBackupReader from './DataBackupReader.svelte';
  import HelpInfo from '$lib/application/HelpInfo.svelte';
  import { createDataBackup, type DataBackupContents } from './data-backup';
  import type { OpenedBackup } from '$lib/vault/encrypted-backup';
  import { createFullBackup, disposeFullBackup, type BackupProfile, type BackupSummary } from './full-backup';
  import type { ProfileRegistry } from '$lib/core/profiles';
  let { accountId, dataAccountId = accountId, nickname, capture, onClose, readVault = loadVault,
    readProfiles, onIdentityVerified = async () => true, restoreData }: { accountId: string; dataAccountId?: string; nickname: string;
    capture(seed: Uint8Array, guard: () => void, onlyCurrent?: boolean): Promise<{ registry?: ProfileRegistry; profiles: BackupProfile[]; selectedProfileId?: string }>;
    onClose(): void; readVault?: typeof loadVault; readProfiles?: (seed: Uint8Array) => Promise<ProfileRegistry | undefined>;
    onIdentityVerified?: () => Promise<boolean>; restoreData?: (data: DataBackupContents, guard: () => void) => Promise<boolean> } = $props();
  let mode = $state<'full' | 'data' | 'identity'>('full');
  let separatePassword = $state(false), archivePassword = $state(''), confirmation = $state(''), notice = $state('');
  let password = $state(''), busy = $state(false), error = $state(''), url = $state('');
  let summary = $state<BackupSummary | null>(null), verified = $state(false), name = $state('');
  let token = 0, backupId = '';
  const cancel = () => { token++; password = ''; archivePassword = ''; confirmation = ''; busy = false; };
  function clearDownload() { if (url) URL.revokeObjectURL(url); url = ''; summary = null; verified = false; }
  async function prepare() {
    if (busy || !password || mode === 'identity') return;
    if (separatePassword && (archivePassword.length < 8 || archivePassword.length > 1024 || archivePassword !== confirmation)) {
      error = 'Пароль копии должен быть от 8 до 1024 символов; подтверждение должно совпадать.'; return;
    }
    clearDownload(); busy = true; error = ''; notice = '';
    const work = ++token, entered = password, protection = separatePassword ? archivePassword : entered, kind = mode;
    password = ''; archivePassword = ''; confirmation = '';
    const guard = () => { if (token !== work) throw new Error('backup_cancelled'); };
    let seed: Uint8Array | undefined, snapshot: Awaited<ReturnType<typeof capture>> | undefined;
    try {
      const vault = await readVault(entered); seed = vault?.mnemonic; guard();
      if (!seed) throw new Error('backup_password');
      snapshot = await capture(seed, guard, kind === 'data'); guard();
      const language = localStorage.getItem('automesh.ui-language.v1');
      const locale: { language?: 'en' | 'ru' } = language === 'en' || language === 'ru' ? { language } : {};
      const profile = snapshot.profiles.find(item => item.accountId === dataAccountId);
      if (kind === 'data' && !profile) throw new Error('backup_wrong_account');
      const result = kind === 'data'
        ? await createDataBackup({ profile: profile!, password: protection, accountId: dataAccountId, ...locale, guard })
        : await createFullBackup({ seed, password: protection, accountId, nickname, ...snapshot, ...locale, guard }); guard();
      summary = result.summary; backupId = result.backupId;
      name = `Automesh-${kind}-${new Date().toISOString().slice(0,10)}.${kind === 'data' ? 'automesh-data' : 'automesh-backup'}`;
      url = URL.createObjectURL(result.file);
    } catch (cause) {
      if (work === token) {
        const code = cause instanceof Error ? cause.message : '';
        error = code === 'backup_too_large' ? 'Копия превышает лимит этой версии — 128 МБ. Файл не создан, данные не обрезаны.' :
          code === 'backup_password' ? 'Неверный текущий пароль.' :
          code === 'backup_password_short' ? 'Для копии нужен пароль от 8 до 1024 символов. Укажите отдельный пароль копии.' :
          code === 'backup_file_corrupt' ? 'Одно из локальных вложений повреждено. Копия не создана.' :
          'Не удалось подготовить копию. Проверьте хранилище и повторите. Данные не удалены.';
      }
    } finally { seed?.fill(0); if (snapshot) disposeFullBackup({ profiles: snapshot.profiles } as never); if (work === token) busy = false; }
  }
  async function verify(backup: OpenedBackup) {
    if (backup.full?.backupId !== backupId) { error = 'Выберите только что созданную полную копию.'; return false; }
    verified = true; error = ''; return true;
  }
  async function verifyData(data: DataBackupContents) {
    if (data.backupId !== backupId) { error = 'Выберите только что созданную копию данных.'; return false; }
    verified = true; error = ''; return true;
  }
  async function restore(data: DataBackupContents, guard: () => void) {
    if (!restoreData || busy) return false;
    const result = await restoreData(data, guard);
    if (result) notice = 'Данные восстановлены в текущем профиле. Сид и права устройств не изменены.';
    return result;
  }
  onMount(() => {
    // A mobile download/file picker may hide the page. Keep the encrypted
    // download URL and reader mounted; only cancel active plaintext work.
    const hide = () => { if (document.hidden) { if (busy) cancel(); else { password = ''; archivePassword = ''; confirmation = ''; } } };
    document.addEventListener('visibilitychange', hide);
    return () => { cancel(); clearDownload(); document.removeEventListener('visibilitychange', hide); };
  });
</script>

<section aria-label={$i18n.text("Резервные копии")}>
  <label>{$i18n.text("Что сохранить")}<select aria-label={$i18n.text("Что сохранить")} bind:value={mode} disabled={busy} onchange={() => { cancel(); clearDownload(); error = ''; notice = ''; }}>
    <option value="full">{$i18n.text("Полная копия — доступ и данные")}</option>
    <option value="data">{$i18n.text("Только данные — без сида")}</option>
    <option value="identity">{$i18n.text("Только доступ к аккаунту — сид")}</option>
  </select></label>
  {#if mode === 'identity'}
    <p class="help-text">{$i18n.text("Этот файл восстанавливает личность и список профилей, но не переписку. Бумажный сид остаётся отдельным способом восстановления.")}</p>
    <EncryptedBackup {accountId} {nickname} {readProfiles} {readVault} onVerified={onIdentityVerified} {onClose} />
  {:else}
  <h4>{mode === 'data' ? $i18n.text("Данные текущего профиля — без сида") : $i18n.text("Полная резервная копия")}</h4>
  <p>{mode === 'data' ? $i18n.text("Переписка, контакты, настройки и сохранённые вложения открытого профиля. Вход в аккаунт эта копия не восстанавливает.") : $i18n.text("Сид, профили, контакты, история, настройки и сохранённые вложения — в одном зашифрованном файле.")}</p>
  <p class="help-text">{mode === 'data' ? $i18n.text("Для восстановления сначала войдите в нужный профиль. Данные можно импортировать только в пустую историю.") : $i18n.text("Файл даёт доступ к аккаунту. Храните его отдельно от устройства. Восстановление — на экране входа.")}</p>
  <HelpInfo label={$i18n.text("Справка: состав и ограничения резервной копии")} text={$i18n.text("В копию входят доступные на этом устройстве вложения, аватары, GIF и стикеры. Максимум — 128 МБ. Исчезающие сообщения, незавершённые загрузки, ключи ожидающих конвертов и разрешения нод не переносятся. Восстановление не перезаписывает чаты и не повторяет старые отправки. Копия данных не содержит сида, ключей входа и других профилей.")} />
  <form onsubmit={(event) => { event.preventDefault(); void prepare(); }}>
    <label>{$i18n.text("Текущий пароль")}<input type="password" autocomplete="current-password" bind:value={password} disabled={busy} /></label>
    <label class="option"><input type="checkbox" bind:checked={separatePassword} disabled={busy} onchange={() => { archivePassword = ''; confirmation = ''; }} /> {$i18n.text("Использовать отдельный пароль для этой копии")}</label>
    {#if separatePassword}
      <label>{$i18n.text("Пароль новой копии")}<input type="password" autocomplete="new-password" minlength="8" maxlength="1024" bind:value={archivePassword} disabled={busy} /></label>
      <label>{$i18n.text("Повторите пароль копии")}<input type="password" autocomplete="new-password" maxlength="1024" bind:value={confirmation} disabled={busy} /></label>
    {/if}
    <p class="help-text">{$i18n("m_ed8d160f64f0", {v0: (separatePassword ? $i18n.text("Копия открывается отдельным паролем. Не теряйте его.") : $i18n.text("Копия защищена текущим паролем аккаунта."))})}</p>
    <button type="submit" disabled={busy || !password}>{busy ? $i18n.text("Собираем и шифруем…") : mode === 'data' ? $i18n.text("Создать копию данных без сида") : $i18n.text("Создать полную копию")}</button>
    {#if busy}<button type="button" onclick={cancel}>{$i18n.text("Отменить")}</button>{/if}
  </form>
  {#if url && summary}
    <p role="status">{$i18n("m_eeef1ac5326b", {v0: (summary.profiles), v1: (summary.contacts), v2: (summary.messages), v3: (summary.files)})}</p>
    {#if summary.missingFiles}<p role="status">{$i18n("m_539338820ce0", {v0: (summary.missingFiles)})}</p>{/if}
    <p><a class="download" href={url} download={name}>{mode === 'data' ? $i18n.text("Скачать копию данных") : $i18n.text("Скачать полную копию")}</a></p>
    <p>{$i18n.text("После скачивания выберите файл для проверки. Это не восстановит его поверх текущих данных.")}</p>
    {#if mode === 'data'}
      <DataBackupReader accountId={dataAccountId} onOpened={verifyData} label={$i18n.text("Подтвердить проверку копии данных")} />
    {:else}
      <BackupReader expectedAccountId={accountId} onOpened={verify} label={$i18n.text("Проверить скачанную копию")} />
    {/if}
    {#if verified}<p role="status">{$i18n.text("Копия расшифрована и проверена, включая содержимое файлов.")}</p>{/if}
  {/if}
  {#if mode === 'data' && restoreData}
    <details><summary>{$i18n.text("Восстановить данные из файла")}</summary>
      <p class="help-text">{$i18n.text("Только в пустую историю текущего профиля. Эта версия не объединяет существующие переписки. Сохраните полную копию перед восстановлением.")}</p>
      <DataBackupReader accountId={dataAccountId} onOpened={restore} />
    </details>
  {/if}
  {#if notice}<p role="status">{$i18n.text(notice)}</p>{/if}
  {#if error}<p role="alert">{$i18n.text(error)}</p>{/if}
  <button type="button" onclick={onClose} disabled={busy}>{$i18n.text("Закрыть")}</button>
  {/if}
</section>

<style>
  label { display:flex; flex-direction:column; gap:8px; margin:12px 0; }
  .option { flex-direction:row; align-items:center; }
  input, select { max-width:100%; }
  .download { display:inline-flex; padding:12px 16px; border:1px solid currentColor; border-radius:14px; }
</style>
