<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import type { ChatEntry } from './session-chats';
  import { transferActivity, transferLabel } from './transfer-activity';
  import HelpInfo from '$lib/application/HelpInfo.svelte';
  let { messages, compact = false, onJump, showHelp = false }: {messages: readonly ChatEntry[];compact?:boolean;onJump?:(id:string)=>void;showHelp?:boolean} = $props();
  let previous:Record<string,string>={};
  function jump(direction:'outgoing'|'incoming'){
    const ids=messages.filter(m=>transferActivity([m])[direction].count>0).map(m=>m.id);
    const id=ids[(ids.indexOf(previous[direction])+1)%ids.length];if(id){previous[direction]=id;onJump?.(id);}
  }
  const summary = $derived(transferActivity(messages));
</script>
{#if summary.outgoing.count || summary.incoming.count}
  <span class="transfer-badges" class:compact aria-label={$i18n.text("Передачи файлов")}>
    {#each ['outgoing','incoming'] as direction}
      {@const group = summary[direction as keyof typeof summary]}
      {#if group.count}
        {#if compact}<span class="transfer-badge" class:failed={group.failed>0} title={$i18n.system(transferLabel(group,direction==='outgoing'))} aria-label={$i18n.system(transferLabel(group,direction==='outgoing'))}>{direction==='outgoing'?$i18n.text("↑ Отправка"):$i18n.text("↓ Приём")} {group.count} · {group.percent}%{group.failed?' !':''}</span>
        {:else}<button type="button" disabled={!onJump} onclick={()=>jump(direction as 'outgoing'|'incoming')} class="transfer-badge" class:failed={group.failed > 0} title={$i18n.system(transferLabel(group,direction === 'outgoing'))}
          aria-label={$i18n.system(transferLabel(group,direction === 'outgoing'))}>
          <span class="meter" style:--progress={`${group.percent}%`} aria-hidden="true">{direction === 'outgoing' ? '↑' : '↓'}</span>
          <span>{!compact ? (direction === 'outgoing' ? $i18n.text("Отправка") : $i18n.text("Получение")) : ''}{group.count}<span class="percent">{` · ${group.percent}%${group.percent===100&&group.waiting&&!group.active?$i18n.text("· ждём"):''}`}</span>{#if group.failed}<span aria-hidden="true"> !</span>{/if}</span>
        </button>{/if}
      {/if}
    {/each}
    {#if !compact&&showHelp}<HelpInfo label={$i18n.text("Справка о передаче файлов")} text={$i18n.text("Для продолжения передачи оставьте приложение открытым. Между чатами можно переключаться.")} />{/if}
  </span>
{/if}
<style>
  .transfer-badges { display:flex;flex-wrap:wrap;gap:5px;padding:3px 0;min-width:0;flex-shrink:0; }
  .transfer-badge { display:inline-flex;align-items:center;gap:5px;max-width:100%;border:1px solid var(--line);background:var(--warning-soft);color:var(--warning);border-radius:12px;padding:3px 7px;font-size:12px;font-weight:600;line-height:1.4;font-variant-numeric:tabular-nums; }
  .transfer-badge:disabled{opacity:1} button.transfer-badge{font-family:inherit;min-height:28px}
  .meter { display:inline-grid;place-items:center;width:20px;height:20px;flex-shrink:0;border-radius:50%;background:radial-gradient(closest-side,var(--surface) 73%,transparent 76%),conic-gradient(currentColor var(--progress),var(--line) 0); }
  .failed { color:var(--danger);border-color:var(--danger);background:var(--surface); }
  .compact { padding:2px 0; }.compact .transfer-badge { font-size:11px;padding:2px 6px; }.percent{font-weight:400;white-space:nowrap}
</style>
