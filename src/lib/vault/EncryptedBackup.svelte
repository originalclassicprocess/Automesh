<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import { onMount } from 'svelte';
  import { loadVault } from './vault';
  import { backupFileName, createEncryptedBackup } from './encrypted-backup';
  import BackupReader from './BackupReader.svelte';
  import type { OpenedBackup } from './encrypted-backup';
  import type { ProfileRegistry } from '$lib/core/profiles';
  import { canonicalJson } from '$lib/core/canonical';
  let { accountId, nickname, onVerified, onClose, readVault = loadVault, readProfiles }: {
    accountId: string; nickname: string; onVerified: () => Promise<boolean>; onClose: () => void;
    // An isolated browser fixture can exercise this UI without touching a user vault.
    readVault?: typeof loadVault;
    readProfiles?: (seed: Uint8Array) => Promise<ProfileRegistry | undefined>;
  } = $props();
  let phase = $state<'export' | 'download' | 'success'>('export');
  let password = $state('');
  let separatePassword = $state(false), filePassword = $state(''), confirmFilePassword = $state('');
  let includeNickname = $state(false);
  let busy = $state(false);
  let error = $state('');
  let downloadedName = $state('');
  let downloadUrl = $state('');
  let progress = $state('');
  let expectedProfiles = '';
  let profileCount = $state(0);
  let token = 0;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const urls = new Set<string>();
  function stopCreation(message: string): void {
    token++;
    clearTimeout(deadline);
    password = ''; filePassword = ''; confirmFilePassword = ''; busy = false; progress = ''; error = message;
  }
  async function prepareBackup(): Promise<void> {
    if (busy || !password) return;
    if (separatePassword && (filePassword.length < 8 || filePassword.length > 1024 || filePassword !== confirmFilePassword)) {
      error = 'Пароль файла должен быть от 8 до 1024 символов; подтверждение должно совпадать.'; return;
    }
    const entered = password;
    const protection = separatePassword ? filePassword : entered;
    password = ''; filePassword = ''; confirmFilePassword = ''; error = ''; busy = true;
    const work = ++token;
    progress = 'Проверяем пароль аккаунта…';
    deadline = setTimeout(() => {
      if (work === token) stopCreation('Подготовка заняла слишком долго. Введите пароль и попробуйте снова.');
    }, 30_000);
    let seed: Uint8Array | undefined;
    try {
      const vault = await readVault(entered);
      seed = vault?.mnemonic;
      if (work !== token) return;
      if (!seed) { error = 'Неверный пароль аккаунта.'; return; }
      progress = 'Шифруем резервную копию…';
      const profiles = await readProfiles?.(seed);
      if (work !== token) return;
      const encrypted = await createEncryptedBackup(seed, protection, accountId, nickname, profiles);
      if (work !== token) return;
      expectedProfiles = profiles ? canonicalJson(profiles) : '';
      profileCount = profiles?.profiles.length ?? 0;
      downloadedName = backupFileName(includeNickname ? nickname : '');
      for (const previous of urls) URL.revokeObjectURL(previous);
      urls.clear();
      const url = URL.createObjectURL(new Blob([encrypted], { type: 'application/json' }));
      urls.add(url);
      downloadUrl = url;
      // A real, user-clicked download link also works on browsers that require
      // fresh user activation after asynchronous key derivation.
      phase = 'download';
    } catch (cause) {
      if (work === token) {
        const code = cause instanceof Error ? cause.message : '';
        error = code === 'backup_password_short'
          ? 'Для резервного файла нужен пароль от 8 символов. Укажите отдельный пароль файла или смените пароль аккаунта.'
          : code === 'backup_account_mismatch'
            ? 'Сохранённый аккаунт не совпадает с открытым. Войдите в нужный аккаунт и повторите создание копии.'
            : 'Не удалось создать файл. Введите пароль и попробуйте ещё раз.';
      }
    }
    finally {
      seed?.fill(0);
      if (work === token) { clearTimeout(deadline); busy = false; progress = ''; }
    }
  }
  async function confirm(backup: OpenedBackup): Promise<boolean> {
    const work = token;
    if (expectedProfiles && (!backup.profiles || canonicalJson(backup.profiles) !== expectedProfiles)) {
      error = 'Выберите только что созданный файл: в нём должен быть полный список профилей.';
      return false;
    }
    if (!await onVerified()) return false;
    if (work !== token) return false;
    phase = 'success';
    return true;
  }
  onMount(() => {
    const hide = () => {
      if (!document.hidden) return;
      if (busy) stopCreation('Подготовка отменена при уходе приложения в фон. Введите пароль и повторите.');
      else { password = ''; filePassword = ''; confirmFilePassword = ''; }
    };
    document.addEventListener('visibilitychange', hide);
    return () => { token++; clearTimeout(deadline); password = ''; filePassword = ''; confirmFilePassword = ''; for (const url of urls) URL.revokeObjectURL(url); urls.clear(); document.removeEventListener('visibilitychange', hide); };
  });
</script>

<section aria-label={$i18n.text("Зашифрованная резервная копия")}>
  <h4>{phase === 'success' ? $i18n.text("Файл проверен") : $i18n.text("Копия доступа к аккаунту")}</h4>
  {#if phase === 'export'}
    <p>{$i18n.text("В файл войдут seed-фраза, ник и сохранённая связка профилей, если она есть, но не переписка и не ключи ожидающих сообщений.")}</p>
    <p><small>{$i18n.text("Храните файл отдельно от устройства. Смена пароля приложения не меняет пароль этого файла.")}</small></p>
    <form aria-busy={busy} onsubmit={(event) => { event.preventDefault(); void prepareBackup(); }}>
      <label>{$i18n.text("Текущий пароль")} <input type="password" bind:value={password} autocomplete="current-password" disabled={busy} /></label>
      <p><label><input type="checkbox" bind:checked={separatePassword} disabled={busy} onchange={() => { filePassword = ''; confirmFilePassword = ''; }} /> {$i18n.text("Отдельный пароль файла доступа")}</label></p>
      {#if separatePassword}
        <p><label>{$i18n.text("Пароль файла доступа")} <input type="password" bind:value={filePassword} autocomplete="new-password" minlength="8" maxlength="1024" disabled={busy} /></label></p>
        <p><label>{$i18n.text("Повторите пароль файла доступа")} <input type="password" bind:value={confirmFilePassword} autocomplete="new-password" maxlength="1024" disabled={busy} /></label></p>
      {/if}
      <p><small>{separatePassword ? $i18n.text("Файл будет защищён отдельным паролем. Без него восстановление из файла невозможно.") : $i18n.text("Файл будет защищён текущим паролем аккаунта.")}</small></p>
      {#if nickname}
        <p><label><input type="checkbox" bind:checked={includeNickname} disabled={busy} /> {$i18n.text("Добавить ник в имя файла")}</label><br />
        <small>{$i18n.text("Имя файла не зашифровано: по нему можно узнать ник.")}</small></p>
      {/if}
      <button type="submit" disabled={busy || !password}>{busy ? $i18n.text("Шифруем…") : $i18n.text("Создать зашифрованный файл")}</button>
    </form>
    {#if busy}
      <p role="status">{$i18n.text(progress)}</p>
      <button type="button" onclick={() => stopCreation('Подготовка отменена. Для повтора введите пароль.')}>{$i18n.text("Отменить подготовку")}</button>
    {/if}
  {:else if phase === 'download'}
    <p role="status">{$i18n.text("Файл готов. Шаг 1: скачайте резервную копию.")}</p>
    {#if profileCount}<p>{$i18n("m_f6bbdcff34d6", {v0: (profileCount)})}</p>{/if}
    <p><a class="download" href={downloadUrl} download={downloadedName}>{$i18n("m_9238a3259387", {v0: (downloadedName)})}</a></p>
    <p>{$i18n.text("Шаг 2: выберите скачанный файл ниже и введите его пароль.")}</p>
    <p><small>{$i18n.text("Если скачивание не началось, нажмите ссылку ещё раз. Предупреждение о резервной копии исчезнет только после успешной проверки файла.")}</small></p>
    <BackupReader expectedAccountId={accountId} onOpened={confirm} label={$i18n.text("Проверить сохранённый файл")} />
    <button type="button" onclick={() => { phase = 'export'; error = ''; }}>{$i18n.text("Создать другой файл")}</button>
  {:else}
    <p>{$i18n("m_cbd7b9b3938d", {v0: (profileCount ? $i18n.text("; список профилей также проверен") : '')})}</p>
  {/if}
  {#if error}<p role="alert">{$i18n.text(error)}</p>{/if}
  <button type="button" onclick={onClose} disabled={busy}>{phase === 'success' ? $i18n.text("Продолжить") : $i18n.text("Позже")}</button>
</section>

<style>
  .download { display:inline-block; padding:8px 12px; border:1px solid currentColor; border-radius:4px; }
</style>
