<script lang="ts">
  import { onMount } from 'svelte';
  import { tr as i18n } from '$lib/i18n/language';
  import { formatBytes } from '$lib/application/storage-summary';
  import ChatIcon from '$lib/chat/ChatIcon.svelte';
  import InlineAudio from '$lib/chat/InlineAudio.svelte';
  import InlineVideo from '$lib/chat/InlineVideo.svelte';
  import { inlineMediaFor } from '$lib/chat/media-preview';
  import type { FileOffer } from '$lib/chat/file-transfer';

  let { file, load, obtain, save, autoKey = '', blocked = false }: {
    file: FileOffer; load(): Promise<Uint8Array | null>;
    obtain(automatic: boolean): Promise<Uint8Array | null>;
    save(bytes: BlobPart, name: string): void;
    autoKey?: string; blocked?: boolean;
  } = $props();

  const media = $derived(inlineMediaFor(file));
  const sticker = $derived(file.details?.media?.kind === 'sticker');
  let host: HTMLDivElement;
  let ready = $state(false), checking = $state(true), busy = $state(false), failed = $state(false), imageError = $state(false);
  let visible = $state(false);
  let imageHeight = $state(0);
  let url = $state(''), attempted = '', mounted = false;

  function show(bytes: Uint8Array | null) {
    if (!bytes) return;
    try {
      if (!mounted) return;
      if (visible && media?.kind === 'image' && !url) {
        imageError = false;
        url = URL.createObjectURL(new Blob([bytes as BlobPart], { type:media.mime }));
      }
      ready = true;
    } finally { bytes.fill(0); }
  }

  onMount(() => {
    mounted = true;
    let reading = false;
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (!visible) {
        if (url) URL.revokeObjectURL(url);
        url = '';
        return;
      }
      if (reading || (ready && media?.kind !== 'image')) return;
      reading = true;
      void load().then(show).catch(() => {}).finally(() => { reading = false; if (mounted) checking = false; });
    });
    observer.observe(host);
    return () => { mounted = false; observer.disconnect(); if (url) URL.revokeObjectURL(url); };
  });

  async function receive(automatic: boolean) {
    if (busy || blocked) return;
    busy = true; failed = false;
    try {
      const bytes = await obtain(automatic);
      if (!bytes && !automatic && mounted) failed = true;
      show(bytes);
    } catch { if (mounted && !automatic) failed = true; }
    finally { if (mounted) busy = false; }
  }

  $effect(() => {
    if (!autoKey) attempted = '';
    if (visible && !checking && !blocked && !ready && !busy && autoKey && autoKey !== attempted) {
      attempted = autoKey;
      void receive(true);
    }
  });

  async function loadMedia() {
    const bytes = await load();
    if (!bytes || !media) throw new Error('group_file_unavailable');
    return { bytes, mime:media.mime };
  }

  async function download() {
    if (!mounted || busy || blocked) return;
    busy = true; failed = false;
    let bytes: Uint8Array | null = null;
    try {
      bytes = await load();
      if (!bytes) throw new Error('group_file_unavailable');
      if (mounted) save(bytes as BlobPart, file.name);
    } catch { if (mounted) { ready = false; failed = true; } }
    finally { bytes?.fill(0); if (mounted) busy = false; }
  }
</script>

<div class="attachment" bind:this={host}>
  {#if !sticker || !ready || imageError}
    <div class="file-name"><ChatIcon name="attachment" /><strong>{file.name}</strong> <small>{$i18n.system(formatBytes(file.size))}</small></div>
  {/if}
  {#if url && !imageError}
    <img class:sticker src={url} alt={file.name} loading="lazy"
      onload={event => imageHeight = event.currentTarget.getBoundingClientRect().height} onerror={() => imageError = true} />
  {:else if ready && imageHeight && !imageError}
    <div aria-hidden="true" style:height={`${imageHeight}px`}></div>
  {:else if ready && media?.kind === 'audio'}
    <InlineAudio load={loadMedia} />
  {:else if ready && media?.kind === 'video'}
    <InlineVideo load={loadMedia} />
  {/if}
  {#if busy}<small role="status">{$i18n.text('Получаем')}…</small>
  {:else if ready}
    <button type="button" class="file-action" onclick={() => void download()} disabled={blocked}>
      <ChatIcon name="download" /> {$i18n.text('Скачать')}
    </button>
  {:else}
    <button type="button" class="file-action" onclick={() => void receive(false)} disabled={blocked}>
      <ChatIcon name="download" /> {$i18n.text('Получить файл')}
    </button>
  {/if}
  {#if failed}<small role="status">{$i18n.text('Не удалось получить файл. Повторите, когда участник с файлом будет на связи.')}</small>{/if}
</div>

<style>
  .attachment { display:grid; justify-items:start; gap:6px; margin:6px 0; }
  .file-name, .file-action { display:flex; align-items:center; flex-wrap:wrap; gap:6px; }
  .file-name :global(svg), .file-action :global(svg) { flex-shrink:0; width:17px; height:17px; }
  .file-action { min-height:34px; padding:4px 8px; }
  img { display:block; max-width:min(100%, 320px); max-height:300px; border-radius:8px; object-fit:contain; }
  img.sticker { width:150px; height:150px; }
  small { color:var(--muted); }
</style>
