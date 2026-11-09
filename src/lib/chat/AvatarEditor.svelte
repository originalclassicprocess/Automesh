<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import Avatar from './Avatar.svelte';
  import HelpInfo from '$lib/application/HelpInfo.svelte';
  import AvatarCropper from './AvatarCropper.svelte';
  import type { AvatarCrop } from './avatar-crop';
  let { accountId, photo = '', busy = false, error = '', showPreview = true, onChange }: {
    accountId: string; photo?: string; busy?: boolean; error?: string; showPreview?: boolean; onChange(file: File | null, crop?: AvatarCrop): void;
  } = $props();
  let input: HTMLInputElement;
  let pending = $state<{ file:File; owner:string } | null>(null);
  $effect(() => { if (pending && pending.owner !== accountId) pending = null; });
  function saveCrop(crop: AvatarCrop) {
    if (!pending || pending.owner !== accountId || busy) return;
    const file = pending.file; pending = null; onChange(file,crop);
  }
</script>
<div class="avatar-editor">
  {#if showPreview}<Avatar {accountId} {photo} size={56} />{/if}
  <input bind:this={input} type="file" accept="image/*,.heic,.heif" hidden disabled={busy}
    onchange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) pending = { file,owner:accountId }; }} />
  <button type="button" disabled={busy} onclick={() => input.click()}>{busy ? $i18n.text("Подождите…") : photo ? $i18n.text("Заменить фото") : $i18n.text("Добавить фото")}</button>
  {#if photo}<button type="button" disabled={busy} onclick={() => onChange(null)}>{$i18n.text("Убрать фото")}</button>{/if}
  <HelpInfo label={$i18n.text("Справка: фото профиля")} text={$i18n.text("Перед сохранением можно выбрать область фото и масштаб. Квадратная копия без метаданных; оригинал не меняется. Фото получают только принятые контакты при прямом подключении; после изменения нужно снова побыть онлайн вместе. У каждого профиля своё фото. На доверенном устройстве оно хранится зашифрованным. Пиксельный узор рядом с адресом остаётся прежним.")} />
</div>
{#if pending && pending.owner === accountId}<AvatarCropper file={pending.file} onSave={saveCrop} onCancel={() => pending = null} />{/if}
{#if error}<small role="alert">{$i18n.text(error)}</small>{/if}
<style>
  .avatar-editor { display:flex; align-items:center; flex-wrap:wrap; gap:8px; margin:12px 0; }
  small { display:block; color:var(--danger, #b42332); }
</style>
