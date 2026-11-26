<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { tr as i18n } from '$lib/i18n/language';
  import { formatBytes } from '$lib/application/storage-summary';
  import ChatIcon from '$lib/chat/ChatIcon.svelte';
  import InlineAudio from '$lib/chat/InlineAudio.svelte';
  import InlineVideo from '$lib/chat/InlineVideo.svelte';
  import StickerPackCard from '$lib/chat/StickerPackCard.svelte';
  import { inlineMediaFor } from '$lib/chat/media-preview';
  import { isStickerPackFile, type PreparedPack } from '$lib/chat/sticker-pack';
  import type { FileOffer } from '$lib/chat/file-transfer';

  let { file, load, obtain, download, onReady, openMedia, loadPack, openPack, saveGif,
    connected = '', fileNode, fileRequested = false, autoReceive = false, blocked = false, autoplay = false }: {
    file: FileOffer; load(): Promise<Uint8Array | null>; obtain(automatic: boolean): Promise<Uint8Array | null>;
    download(): Promise<void>; onReady(): void; openMedia(): void;
    loadPack(): Promise<PreparedPack>; openPack(): void; saveGif(): void;
    connected?: string; fileNode?: string; fileRequested?: boolean; autoReceive?: boolean; blocked?: boolean; autoplay?: boolean;
  } = $props();

  const media = $derived(inlineMediaFor(file));
  const sticker = $derived(file.details?.media?.kind === 'sticker');
  const pack = $derived(isStickerPackFile(file.name));
  let host: HTMLDivElement;
  let ready = $state(false), busy = $state(false), requested = $state(false), imageError = $state(false);
  let visible = $state(false), mounted = false, reading = false;
  let url = $state(''), imageHeight = $state(0);

  function show(bytes: Uint8Array | null) {
    if (!bytes) return;
    try {
      if (!mounted) return;
      if (visible && media?.kind === 'image' && !url) {
        imageError = false;
        url = URL.createObjectURL(new Blob([bytes as BlobPart], { type:media.mime }));
      }
      ready = true;
      onReady();
    } finally { bytes.fill(0); }
  }

  function read(force = false) {
    if (reading && !force || ready && (media?.kind !== 'image' || url)) return;
    reading = true;
    void load().then(show).catch(() => {}).finally(() => { reading = false; });
  }

  onMount(() => {
    mounted = true;
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) read();
      else {
        if (url) URL.revokeObjectURL(url);
        url = '';
      }
    });
    observer.observe(host);
    return () => { mounted = false; observer.disconnect(); if (url) URL.revokeObjectURL(url); };
  });

  async function receive(automatic: boolean) {
    if (busy || blocked || ready || !mounted) return;
    if (!automatic) requested = true;
    busy = true;
    try { show(await obtain(automatic)); }
    catch { /* The offer remains available while either route reconnects. */ }
    finally { if (mounted) busy = false; }
  }

  $effect(() => {
    if (fileNode && visible) untrack(() => read(true));
  });

  $effect(() => {
    const manual = requested || fileRequested;
    if (!visible || blocked || ready || !connected || (!autoReceive && !manual)) return;
    const retry = () => { if (!document.hidden) void receive(!manual); };
    untrack(retry);
    const timer = setInterval(retry, 7000);
    return () => clearInterval(timer);
  });

  async function loadMedia() {
    const bytes = await load();
    if (!bytes || !media) throw new Error('group_file_unavailable');
    return { bytes, mime:media.mime };
  }
</script>

<div class="attachment" bind:this={host}>
  {#if ready && pack}
    <StickerPackCard name={file.name.replace(/\.automesh-stickers\.zip$/i, '') || $i18n.text('Стикерпак')} load={loadPack} onOpen={openPack} busy={blocked} />
  {:else if ready && media?.kind === 'image'}
    <button type="button" class="message-image" class:message-sticker={sticker}
      onclick={openMedia} aria-label={$i18n('m_931b83c229d4', {v0:file.name})}>
      {#if url && !imageError}
        <img src={url} alt={file.name} loading="lazy"
          onload={event => imageHeight = event.currentTarget.getBoundingClientRect().height} onerror={() => imageError = true} />
      {:else if imageError}{$i18n.text('Не удалось показать миниатюру')}
      {:else if imageHeight}<div aria-hidden="true" style:height={`${imageHeight}px`}></div>
      {:else}{$i18n.text('🖼️ Открыть изображение')}{/if}
    </button>
    {#if !sticker && file.mime === 'image/gif'}<button onclick={saveGif} disabled={blocked}>{$i18n.text('В GIF')}</button>{/if}
  {:else if ready && media?.kind === 'audio'}
    <InlineAudio load={loadMedia} />
  {:else if ready && media?.kind === 'video'}
    <InlineVideo load={loadMedia} {autoplay} />
    <button onclick={openMedia}>{$i18n.text('⛶ Открыть видео')}</button>
  {:else}
    <button type="button" class="file-tile" onclick={() => ready ? void download() : void receive(false)} disabled={blocked || busy}
      aria-label={(ready ? $i18n.text('Скачать файл') : $i18n.text('Получить файл')) + ' · ' + file.name}>
      <ChatIcon name={ready ? 'attachment' : 'download'} />
      <span><strong>{file.name}</strong><small>{busy ? $i18n.text('Получаем') + '…'
        : (requested || fileRequested) && !ready ? $i18n.text('Ожидает загрузки') : $i18n.system(formatBytes(file.size))}</small></span>
    </button>
  {/if}
</div>

<style>
  .attachment { min-width:0; display:grid; justify-items:start; gap:6px; margin:6px 0; }
  .file-tile { display:flex; align-items:center; gap:8px; max-width:100%; text-align:start; padding:6px 8px; }
  .file-tile :global(svg) { flex-shrink:0; width:19px; height:19px; }
  .file-tile span { min-width:0; display:grid; gap:2px; }
  strong { overflow-wrap:anywhere; }
  small { color:var(--muted); font-size:.75em; }
</style>
