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
    fileReady = false, fileRequested = false, blocked = false, autoplay = false }: {
    file: FileOffer; load(): Promise<Uint8Array | null>; obtain(): Promise<Uint8Array | null>;
    download(): Promise<void>; onReady(): void; openMedia(): void;
    loadPack(): Promise<PreparedPack>; openPack(): void; saveGif(): void;
    fileReady?: boolean; fileRequested?: boolean; blocked?: boolean; autoplay?: boolean;
  } = $props();

  const media = $derived(inlineMediaFor(file));
  const sticker = $derived(file.details?.media?.kind === 'sticker');
  const pack = $derived(isStickerPackFile(file.name));
  let host: HTMLDivElement;
  let ready = $state(false), busy = $state(false), requested = $state(false), imageError = $state(false);
  let visible = $state(false), mounted = false, reading = false, refresh = false;
  let url = $state(''), imageRatio = $state<number>();

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
    if (ready && (media?.kind !== 'image' || url)) return;
    if (reading) { refresh ||= force; return; }
    reading = true;
    void load().then(bytes => {
      if (bytes) show(bytes);
      else if (fileReady && visible && mounted) imageError = true;
    }).catch(() => {
      if (fileReady && visible && mounted) imageError = true;
    }).finally(() => {
      reading = false;
      const retry = refresh;
      refresh = false;
      if (retry && mounted && visible) read();
    });
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
    }, { root:host.closest('.message-scroll'), rootMargin:'200px 0px' });
    observer.observe(host);
    return () => { mounted = false; observer.disconnect(); if (url) URL.revokeObjectURL(url); };
  });

  async function receive() {
    if (busy || blocked || ready || !mounted) return;
    requested = true;
    busy = true;
    try { show(await obtain()); }
    catch { /* The offer remains available while either route reconnects. */ }
    finally { if (mounted) busy = false; }
  }

  $effect(() => {
    if (fileReady && visible) untrack(() => read(true));
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
  {:else if (ready || fileReady) && media?.kind === 'image'}
    <button type="button" class="message-image" class:message-sticker={sticker}
      style:aspect-ratio={imageRatio ?? (sticker ? 1 : 4/3)}
      onclick={openMedia} aria-label={$i18n('m_931b83c229d4', {v0:file.name})}>
      {#if url && !imageError}
        <img src={url} alt={file.name}
          onload={({ currentTarget }) => {
            if (currentTarget instanceof HTMLImageElement && currentTarget.naturalWidth && currentTarget.naturalHeight)
              imageRatio = currentTarget.naturalWidth / currentTarget.naturalHeight;
          }} onerror={() => imageError = true} />
      {:else if imageError}<span>{$i18n.text('Не удалось показать миниатюру')}</span>{/if}
    </button>
    {#if !sticker && file.mime === 'image/gif'}<button onclick={saveGif} disabled={blocked}>{$i18n.text('В GIF')}</button>{/if}
  {:else if ready && media?.kind === 'audio'}
    <InlineAudio load={loadMedia} />
  {:else if ready && media?.kind === 'video'}
    <InlineVideo load={loadMedia} {autoplay} />
    <button onclick={openMedia}>{$i18n.text('⛶ Открыть видео')}</button>
  {:else}
    <button type="button" class="file-tile" onclick={() => ready ? void download() : void receive()} disabled={blocked || busy}
      aria-label={(ready ? $i18n.text('Скачать файл') : $i18n.text('Получить файл')) + ' · ' + file.name}>
      <ChatIcon name={ready ? 'attachment' : 'download'} />
      <span><strong>{file.name}</strong><small>{busy ? $i18n.text('Получаем') + '…'
        : (requested || fileRequested) && !ready ? $i18n.text('Ожидает загрузки') : $i18n.system(formatBytes(file.size))}</small></span>
    </button>
  {/if}
</div>

<style>
  .attachment { min-width:0; max-width:100%; display:grid; grid-template-columns:minmax(0,1fr); justify-items:start; gap:6px; margin:6px 0; }
  .attachment > :global(button), .attachment > :global(video) { box-sizing:border-box; min-width:0; max-width:100%; }
  .message-image { position:relative; max-height:420px; }
  .message-image.message-sticker { max-height:180px; }
  .message-image :is(img, span) { position:absolute; inset:0; width:100%; height:100%; max-height:none; }
  .message-image span { display:grid; place-items:center; padding:8px; box-sizing:border-box; overflow-wrap:anywhere; }
  @media (max-width:700px) { .message-image { max-height:min(420px, 55dvh); } .message-image.message-sticker { max-height:min(180px,55dvh); } }
  .file-tile { display:flex; align-items:center; gap:8px; max-width:100%; text-align:start; padding:6px 8px; }
  .file-tile :global(svg) { flex-shrink:0; width:19px; height:19px; }
  .file-tile span { min-width:0; display:grid; gap:2px; }
  strong { overflow-wrap:anywhere; }
  small { color:var(--muted); font-size:.75em; }
</style>
