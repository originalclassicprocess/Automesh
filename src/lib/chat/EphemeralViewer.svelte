<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import MessageText from './MessageText.svelte';
  import type { ChatEntry } from './session-chats';
  let { message, url, deadline = 0, onClose, onDownload }: { message: ChatEntry; url?: string; deadline?: number; onClose(): void; onDownload(): void } = $props();
  let now = $state(Date.now());
  function dialog(node: HTMLDialogElement) {
    node.showModal();
    const timer = setInterval(() => { now = Date.now(); if (deadline && now >= deadline) onClose(); }, 250);
    return { destroy() { clearInterval(timer); node.close(); if (url) URL.revokeObjectURL(url); } };
  }
</script>
<dialog use:dialog oncancel={event => { event.preventDefault(); onClose(); }} aria-labelledby="ephemeral-title">
  <header><h3 id="ephemeral-title">{$i18n.text("Исчезающее сообщение")}</h3><button onclick={onClose} aria-label={$i18n.text("Закрыть просмотр")}>✕</button></header>
  {#if deadline}<small role="timer">{$i18n("m_fd388750348f", {v0: (Math.max(0,Math.ceil((deadline-now)/1000)))})}</small>{/if}
  {#if message.file}
    {#if url && message.file.mime.startsWith('image/')}<img src={url} alt={$i18n.text("Исчезающее изображение")} />
    {:else if url && message.file.mime.startsWith('video/')}<video src={url} controls controlslist={message.details?.ephemeral?.allowDownload ? '' : 'nodownload'} playsinline><track kind="captions" /></video>
    {:else if url && message.file.mime.startsWith('audio/')}<audio src={url} controls controlslist={message.details?.ephemeral?.allowDownload ? '' : 'nodownload'}></audio>
    {:else}<p>{$i18n("m_3741040dc6a9", {v0: (message.file.name), v1: ((message.file.size/1024).toFixed(1))})}</p>{/if}
  {:else}<MessageText text={message.text} />{/if}
  {#if message.details?.ephemeral?.allowDownload}<button onclick={onDownload}>{$i18n("m_83ccaefec154", {v0: (message.file ? $i18n.text("файл") : $i18n.text("текст"))})}</button>{/if}
  <p><small>{$i18n.text("Повторное открытие расходует ещё один просмотр. Скриншот и внешние копии не контролируются приложением.")}</small></p>
</dialog>
<style>
  dialog { width:min(650px,calc(100vw - 24px)); max-height:90dvh; overflow:auto; box-sizing:border-box; }
  header { display:flex; align-items:center; justify-content:space-between; gap:8px; } h3 { font-size:18px; margin:0; }
  img,video { display:block; max-width:100%; max-height:65dvh; margin:12px auto; object-fit:contain; } audio { max-width:100%; }
  small { color:var(--muted); font-size:12px; }
</style>
