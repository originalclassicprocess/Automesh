<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import ChatIcon from './ChatIcon.svelte';
  import { selectionSummary } from './message-selection';
  let { messages, selected, busy = false, onToggleAll, onForward, onDownload, onDelete, onCopy, onRetry, onCancel, retryCount=0, cancelCount=0, downloadCount }:
    { messages: { id: string }[]; selected: string[]; busy?: boolean; onToggleAll(): void;
      onForward(): void; onDownload(): void; onDelete(): void;onCopy?:()=>void;onRetry?:()=>void;onCancel?:()=>void;retryCount?:number;cancelCount?:number;downloadCount?:number } = $props();
  let more=$state(false);
  const summary = $derived(selectionSummary(messages, selected));
</script>
{#if summary.total}
<div class="selection-toolbar" role="region" aria-label={$i18n.text("Действия с выбранными сообщениями")}>
  <label title={summary.all ? $i18n.text("Снять выбор со всех сообщений") : $i18n.text("Выбрать все сообщения")}>
    <input type="checkbox" checked={summary.all} indeterminate={summary.partial} disabled={busy || !summary.total}
      aria-label={summary.all ? $i18n.text("Снять выбор со всех сообщений") : $i18n.text("Выбрать все сообщения")} onchange={onToggleAll} />
  </label>
  <span class="selection-count" aria-live="polite">{#if summary.count}<span aria-label={$i18n("m_9d4d72ada7e0", {v0: (summary.count), v1: (summary.total)})}>{summary.count}<small>/{summary.total}</small></span>{/if}</span>
  {#if summary.count}
  {#if onCopy}<button type="button" onclick={onCopy} disabled={busy||!summary.count} aria-label={$i18n.text("Скопировать текст")}><ChatIcon name="copy"/></button>{/if}
  <button type="button" onclick={onForward} disabled={busy || !summary.count} aria-label={$i18n.text("Переслать выбранные сообщения")} title={$i18n.text("Переслать")}><ChatIcon name="forward" /></button>
  {#if downloadCount??summary.count}<button type="button" onclick={onDownload} disabled={busy} aria-label={$i18n.text("Скачать выбранные сообщения")} title={$i18n.text("Скачать")}><ChatIcon name="download" /></button>{/if}
  <button type="button" onclick={onDelete} disabled={busy || !summary.count} aria-label={$i18n.text("Удалить выбранные сообщения у меня")} title={$i18n.text("Удалить у меня")}><ChatIcon name="trash" /></button>
  {#if onRetry&&retryCount>0||onCancel&&cancelCount>0}<details class="bulk-more" bind:open={more}><summary aria-label={$i18n.text('Другие действия с выбранными сообщениями')}>⋯</summary><div>
    {#if onRetry&&retryCount>0}<button type="button" disabled={busy} onclick={()=>{more=false;onRetry?.();}}>{$i18n.text('Повторить отправку')} · {retryCount}</button>{/if}
    {#if onCancel&&cancelCount>0}<button type="button" disabled={busy} onclick={()=>{more=false;onCancel?.();}}>{$i18n.text('Отменить отправки')} · {cancelCount}</button>{/if}
  </div></details>{/if}
  {/if}
</div>
{/if}
<style>.bulk-more{position:relative}.bulk-more summary{list-style:none;display:grid;place-items:center;box-sizing:border-box;width:100%;min-width:32px;height:44px;padding:0;cursor:pointer;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--text);font-size:22px;line-height:1}.bulk-more summary::-webkit-details-marker{display:none}.bulk-more summary::after,.bulk-more[open]>summary::after{display:none;content:none}.bulk-more summary:hover{background:var(--surface-alt);border-color:var(--line-strong)}.bulk-more>div{position:absolute;right:0;top:48px;z-index:30;min-width:220px;padding:8px;background:var(--surface);border:1px solid var(--line);border-radius:12px;box-shadow:0 8px 24px var(--shadow-color)}.bulk-more>div button{width:100%;text-align:left;font-size:13px;margin:4px 0}</style>
