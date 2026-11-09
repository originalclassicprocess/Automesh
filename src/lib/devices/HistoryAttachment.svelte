<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import { onDestroy } from 'svelte';
  import type { FileOffer } from '../chat/file-transfer';
  import { sha256Hex, safeFileName } from '../chat/file-transfer';
  import { inlineMediaFor } from '../chat/media-preview';
  import MediaViewer from '../chat/MediaViewer.svelte';
  import { formatBytes } from '../application/storage-summary';
  let { file, available, deleted = false, load, timestamp = 0, sender = '', senderAddress = '', onReply, onShare }: {
    file: FileOffer; available: boolean; deleted?: boolean; load(): Promise<Uint8Array | null>; timestamp?: number; sender?: string; senderAddress?: string; onReply?(): void; onShare?(): void
  } = $props();
  let url = $state(''), busy = $state(false), error = $state(''), viewer = $state(false), decodeError = $state(false), host = $state<HTMLElement>(), alive = true;
  const media = $derived(inlineMediaFor(file));
  // Match the main chat's lazy, local-only preview. No file is fetched from a
  // peer or node here: load reads the already imported encrypted local bytes.
  $effect(() => {
    const node = host, enabled = available && !deleted && !!media;
    if (!node || !enabled) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); void open(); } });
    observer.observe(node); return () => observer.disconnect();
  });
  async function open() {
    if (!available || deleted || busy || url) return; busy = true; error = '';
    let bytes: Uint8Array | null = null;
    try {
      bytes = await load();
      if (!bytes || bytes.length !== file.size || await sha256Hex(bytes) !== file.sha256) throw new Error('history_file');
      if (!alive) return;
      // Use the same passive-format allowlist as the main chat (no SVG/HTML).
      // A decoder failure affects the preview only, never verified download.
      url = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type: media?.mime ?? 'application/octet-stream' }));
    } catch { if (alive) error = 'Вложение недоступно или не прошло проверку целостности.'; }
    finally { bytes?.fill(0); if (alive) busy = false; }
  }
  function download() { if (!url || deleted) return; const a = document.createElement('a'); a.href = url; a.download = safeFileName(file.name); a.click(); }
  onDestroy(() => { alive = false; if (url) URL.revokeObjectURL(url); });
</script>
<div class="history-attachment" bind:this={host}>
  {#if !url || !media || decodeError}<strong>📎 {file.name}</strong><small>{$i18n.system(formatBytes(file.size))}</small>{/if}
  {#if deleted}<p>{$i18n.text("Вложение удалено на этом устройстве.")}</p>
  {:else if !available}<p>{$i18n.text("Файл не был перенесён. Владелец может повторить перенос с доступным вложением.")}</p>
  {:else if !url}<button type="button" disabled={busy} onclick={() => void open()}>{busy ? $i18n.text("Проверяем вложение…") : $i18n.text("Открыть сохранённое вложение")}</button>
  {:else}
    {#if media?.kind === 'image' && !decodeError}<button type="button" class="message-image" aria-label={$i18n("m_931b83c229d4", {v0: (file.name)})} onclick={() => viewer = true}>
      <img src={url} alt={file.name} loading="lazy" onerror={() => decodeError = true} /></button>
    {:else if media?.kind === 'video' && !decodeError}
      <!-- svelte-ignore a11y_media_has_caption -->
      <video src={url} controls playsinline preload="metadata" aria-label={file.name} onerror={() => decodeError = true}></video>
      <button type="button" onclick={() => viewer = true}>{$i18n.text("⛶ Открыть видео")}</button>
    {:else if media?.kind === 'audio' && !decodeError}<audio src={url} controls preload="metadata" aria-label={file.name} onerror={() => decodeError = true}></audio>{/if}
    {#if !media || decodeError}<a href={url} download={safeFileName(file.name)}>{$i18n("m_83ccaefec154", {v0: (file.name)})}</a>{/if}
  {/if}
  {#if error}<p role="alert">{$i18n.text(error)}</p>{/if}
</div>
{#if viewer && url && media && media.kind !== 'audio' && !deleted}<MediaViewer id={file.id} name={file.name} kind={media.kind} {url}
  fileInfo={{ size: file.size, mime: file.mime, timestamp, sender, senderAddress }} index={0} count={1} canReply={!!onReply} canShare={!!onShare} canForward={false}
  onMove={() => {}} onClose={() => viewer = false} onAction={action => { viewer = false; if (action === 'download') download(); else if (action === 'reply') onReply?.(); else if (action === 'share') onShare?.(); }} />{/if}
<style>
  .history-attachment{padding:8px 0;overflow-wrap:anywhere}small{display:block;color:var(--muted)}button,a{display:inline-block;margin-top:8px;min-height:40px}a{color:var(--accent)}
  .message-image{display:block;width:420px;max-width:100%;padding:0;overflow:hidden;border-radius:10px;background:var(--surface-alt)}
  img,video{display:block;width:100%;max-height:420px;object-fit:contain}video{width:440px;max-width:100%;border-radius:10px}audio{max-width:100%;width:300px}
  @media(max-width:700px){img,video{max-height:55dvh}}
</style>
