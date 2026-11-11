<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import ChatIcon from './ChatIcon.svelte';
  import { selectionSummary } from './message-selection';
  let { messages, selected, busy = false, onToggleAll, onForward, onDownload, onDelete, onCopy }:
    { messages: { id: string }[]; selected: string[]; busy?: boolean; onToggleAll(): void;
      onForward(): void; onDownload(): void; onDelete(): void;onCopy?:()=>void } = $props();
  const summary = $derived(selectionSummary(messages, selected));
</script>
<div class="selection-toolbar" role="region" aria-label={$i18n.text("Действия с выбранными сообщениями")}>
  <label title={summary.all ? $i18n.text("Снять выбор со всех сообщений") : $i18n.text("Выбрать все сообщения")}>
    <input type="checkbox" checked={summary.all} indeterminate={summary.partial} disabled={busy || !summary.total}
      aria-label={summary.all ? $i18n.text("Снять выбор со всех сообщений") : $i18n.text("Выбрать все сообщения")} onchange={onToggleAll} />
  </label>
  <span class="selection-count" aria-live="polite" aria-label={$i18n("m_9d4d72ada7e0", {v0: (summary.count), v1: (summary.total)})}>{summary.count}<small>/{summary.total}</small></span>
  {#if onCopy}<button type="button" onclick={onCopy} disabled={busy||!summary.count} aria-label={$i18n.text("Скопировать текст")}><ChatIcon name="copy"/></button>{/if}
  <button type="button" onclick={onForward} disabled={busy || !summary.count} aria-label={$i18n.text("Переслать выбранные сообщения")} title={$i18n.text("Переслать")}><ChatIcon name="forward" /></button>
  <button type="button" onclick={onDownload} disabled={busy || !summary.count} aria-label={$i18n.text("Скачать выбранные сообщения")} title={$i18n.text("Скачать")}><ChatIcon name="download" /></button>
  <button type="button" onclick={onDelete} disabled={busy || !summary.count} aria-label={$i18n.text("Удалить выбранные сообщения у меня")} title={$i18n.text("Удалить у меня")}><ChatIcon name="trash" /></button>
</div>
