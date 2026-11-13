<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import type {ChatEntry} from './session-chats';
  import {nodeQueueSummary,nextQueueId} from './node-queue';
  let {messages,onJump,onClear,compact=false}:{messages:readonly ChatEntry[];onJump?:(id:string)=>void;onClear?:()=>void;compact?:boolean}=$props();
  const base=$derived(nodeQueueSummary(messages));
  const summary=$derived({...base,stopped:base.stopped.filter(m=>m.nodeQueue==='canceled'),expired:base.stopped.filter(m=>m.nodeQueue==='expired')});
  let previous=$state<Record<string,string>>({});
  function jump(kind:'waiting'|'canceling'|'stopped'|'expired') {
    const id=nextQueueId(summary[kind].map(m=>m.id),previous[kind]);
    if(id){previous={...previous,[kind]:id};onJump?.(id);}
  }
</script>
{#if summary.waiting.length||summary.canceling.length||summary.stopped.length||summary.expired.length}
  <span class="badges" class:compact aria-label={$i18n.text("Очередь этого чата")}>
    {#if compact}
      {#if summary.waiting.length}<span class="pill">☁ {summary.waiting.length}</span>{/if}
      {#if summary.canceling.length}<span class="pill warning">◷ {summary.canceling.length}</span>{/if}
      {#if summary.expired.length}<span class="pill danger">⊘ {summary.expired.length}</span>{/if}
      {#if summary.stopped.length}<span class="pill stopped">⊘ {summary.stopped.length}</span>{/if}
    {:else}
    {#if summary.waiting.length}<button type="button" disabled={!onJump} onclick={()=>jump('waiting')} title={$i18n.text("Сохранено на ноде, получение ещё не подтверждено. Нажимайте, чтобы переходить к сообщениям.")}>☁ {compact?'':$i18n.text("На ноде")}{summary.waiting.length}</button>{/if}
    {#if summary.canceling.length}<button type="button" class="warning" disabled={!onJump} onclick={()=>jump('canceling')} title={$i18n.text("Отмена ещё не подтверждена нодой")}>{$i18n("m_94691b926041", {v0: (summary.canceling.length)})}</button>{/if}
    {#if summary.stopped.length}<button type="button" class="stopped" disabled={!onJump} onclick={()=>jump('stopped')} title={$i18n.text("Отменено вами. В меню сообщения можно отправить снова.")}>⊘ {compact?'':$i18n.text("Отменено вами")}{summary.stopped.length}</button>
    {/if}
    {#if summary.expired.length}<button type="button" class="danger" disabled={!onJump} onclick={()=>jump('expired')} title={$i18n.text("Нода удалила по сроку. В меню сообщения можно отправить снова.")}>{$i18n("m_8d34f7810b92", {v0: (summary.expired.length)})}</button>{/if}
    {#if summary.stopped.length||summary.expired.length}
      {#if onClear}<button type="button" class="clear" onclick={onClear} aria-label={$i18n.text("Очистить счётчик остановленных отправок этого чата")} title={$i18n.text("Скрыть счётчик. История и активная очередь сохранятся.")}>×</button>{/if}
    {/if}
    {/if}
  </span>
{/if}
<style>
  .badges{display:flex;flex-wrap:wrap;gap:5px;margin:3px 0;font-size:12px;align-items:center}
  button,.pill{font:inherit;min-height:28px;padding:3px 8px;border-radius:12px;border:1px solid var(--accent-line);background:var(--accent-soft);color:var(--success)}
  button:disabled{opacity:1}.stopped{color:var(--muted);border-color:var(--line);background:var(--surface)}.danger{color:var(--danger);background:var(--surface);border-color:var(--line)}.warning{color:var(--warning);background:var(--warning-soft);border-color:var(--line)}.clear{min-width:28px;padding:3px}.compact{font-size:11px}
</style>
