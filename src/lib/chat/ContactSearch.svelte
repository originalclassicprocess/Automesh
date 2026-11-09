<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import { onDestroy } from 'svelte';
  import NodeScanner from '$lib/transport/NodeScanner.svelte';
  import { readQrImage } from '$lib/transport/qr-reader';
  import { contactReferenceFromInput } from './contact-input';
  import QrImageButton from '$lib/application/QrImageButton.svelte';
  let { query = $bindable(''), ownId, onOpen }: {
    query?: string; ownId: string; onOpen: (id: string, signalingUrl?: string) => void;
  } = $props();
  let scanner = $state(false);
  let camera = $state(false);
  let error = $state('');
  let reading = $state(false);
  let token = 0;
  onDestroy(() => { token++; });
  const canOpen = $derived.by(() => { try { contactReferenceFromInput(query, ownId); return true; } catch { return false; } });
  function close() { token++; scanner = false; camera = false; error = ''; reading = false; }
  function open(value = query) {
    try { const contact = contactReferenceFromInput(value, ownId); query = ''; close(); onOpen(contact.accountId, contact.signalingUrl); }
    catch (e) { camera = false; error = e instanceof Error ? e.message : 'Не удалось прочитать Mesh ID.'; }
  }
  async function image(event: Event) {
    const input = event.currentTarget as HTMLInputElement; const file = input.files?.[0]; input.value = '';
    if (!file) return;
    const attempt = ++token; reading = true; error = '';
    try { const value = await readQrImage(file); if (attempt === token) open(value); }
    catch { if (attempt === token) error = 'QR не найден. Выберите изображение PNG, JPEG или WebP до 5 МБ.'; }
    finally { if (attempt === token) reading = false; }
  }
</script>

<div class="search-row">
  <input type="search" bind:value={query} placeholder={$i18n.text("Имя, Mesh ID или ссылка контакта")}
    aria-label={$i18n.text("Найти контакт или добавить по Mesh ID или ссылке")} maxlength="2048" oninput={() => error = ''}
    onkeydown={(event) => { if (event.key === 'Enter' && !event.isComposing && canOpen) { event.preventDefault(); open(); } }} />
  {#if canOpen}<button type="button" onclick={() => open()} aria-label={$i18n.text("Открыть чат по Mesh ID")}>＋</button>{/if}
  <button type="button" onclick={() => scanner ? close() : scanner = true} aria-label={$i18n.text("Сканировать QR Mesh ID")} title={$i18n.text("Добавить по QR")} aria-expanded={scanner}>
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" d="M1 1h7v7H1zm2 2v3h3V3zm9-2h7v7h-7zm2 2v3h3V3zM1 12h7v7H1zm2 2v3h3v-3zm9-4h3v3h-3zm4 2h3v3h-3zm-6 4h3v3h-3zm5 0h4v3h-4z" /></svg>
  </button>
</div>
{#if scanner}
  <section class="scanner" aria-label={$i18n.text("Добавить контакт по QR")}>
    <div class="scan-actions">
      <button class="scan-camera" type="button" disabled={reading} aria-pressed={camera} onclick={() => { camera = !camera; error = ''; }}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 7h4l2-3h6l2 3h4v13H3Z"/><circle cx="12" cy="13" r="4"/></svg>
        <span>{camera ? $i18n.text("Выключить камеру") : $i18n.text("Камера")}</span>
      </button>
      <div class="image-source"><QrImageButton label={$i18n.text("Выбрать изображение QR контакта")} onImage={image} disabled={reading} /></div>
      <button class="scan-close" type="button" onclick={close} aria-label={$i18n.text("Закрыть сканирование")}>✕</button>
    </div>
    {#if camera}<NodeScanner label={$i18n.text("QR Mesh ID собеседника")} onResult={open} onClose={() => camera = false} />{/if}
    {#if reading}<small role="status">{$i18n.text("Читаем QR…")}</small>{/if}
  </section>
{/if}
{#if error}<p role="alert">{$i18n.text(error)}</p>{/if}

<style>
  .search-row { display:flex; gap:6px; margin-bottom:8px; }
  input[type="search"] { flex:1; min-width:0; box-sizing:border-box; padding:8px; font-size:16px; }
  button { min-width:36px; min-height:36px; }
  .scanner { padding:10px; border:1px solid var(--line);border-radius:12px;background:var(--surface-alt);margin-bottom:10px;container-type:inline-size; }
  .scan-actions { display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) 40px;align-items:stretch;gap:8px; }
  .scan-camera { display:flex;align-items:center;justify-content:center;gap:8px;min-height:44px;font-size:14px;padding:10px 12px; }.scan-camera svg{flex-shrink:0}.scan-camera span{min-width:0;overflow-wrap:anywhere}
  .scan-close{min-height:44px;width:40px;padding:6px;font-size:18px}.image-source{min-width:0;display:flex}
  .image-source > :global(label){width:100%}
  @container(max-width:360px){.scan-actions{grid-template-columns:minmax(0,1fr) 40px}.image-source{grid-column:1 / -1}.scan-close{grid-column:2;grid-row:1}}
  p { color:var(--danger); font-size:.85rem; }
</style>
