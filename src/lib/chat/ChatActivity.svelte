<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import type { ChatEntry } from './session-chats';
  import { chatActivity } from './chat-activity';
  import TransferBadges from './TransferBadges.svelte';
  import NodeQueueBadges from './NodeQueueBadges.svelte';
  import DeliveryAttention from './DeliveryAttention.svelte';
  import { activeNodeTransfer } from './node-transfer';
  import { transferActivity } from './transfer-activity';
  let { messages, compact = false, onJump, onClear, onRemind, reminderDisabled=false, reminderBusy=false, reminderNote='' }: {
    messages: readonly ChatEntry[]; compact?: boolean; onJump?: (id: string) => void; onClear?: () => void;
    onRemind?:()=>void;reminderDisabled?:boolean;reminderBusy?:boolean;reminderNote?:string;
  } = $props();
  const activity = $derived(chatActivity(messages,{summarizeTransfers:false}));
  const transfers = $derived(transferActivity(messages));
  const hasTransfers = $derived(transfers.outgoing.count+transfers.incoming.count>0);
  const keepOpen = $derived(transfers.outgoing.active+transfers.outgoing.waiting+transfers.incoming.active+transfers.incoming.waiting>0);
</script>
{#snippet headline()}
  {#if activity}<span class="signal {activity.tone}" aria-hidden="true"></span>
    <span class="label">{$i18n.system(activity.label)}</span>
    {#if activity.transfer}<span class="transfer">{activity.transfer}</span>{/if}{/if}
{/snippet}
{#if compact}
  <TransferBadges {messages} compact {onJump} />
  {#if activity}<span class="activity-line" title={$i18n.system(activity.detail)} aria-label={`${$i18n.system(activity.label)}${activity.transfer ? `. ${activity.transfer}` : ''}`}>{@render headline()}</span>{/if}
{:else if hasTransfers || activity}
  <div class="chat-activity" class:split={hasTransfers && !!activity}>
    <div class="transfer-pane"><TransferBadges {messages} {onJump} showHelp={keepOpen} />
      {#if onRemind}<button class="remind" type="button" onclick={onRemind} disabled={reminderBusy||reminderDisabled}
        title={$i18n.text(reminderDisabled?'Для напоминаний включите уведомления в настройках приложения.':'Попросить отправителя вернуться и продолжить передачу')}>{$i18n.text(reminderBusy?'Отправляем…':'Напомнить отправителю')}</button>{/if}
      {#if reminderNote}<small class="reminder-note" role="status">{$i18n.text(reminderNote)}</small>{/if}
    </div>
    {#if activity}
      <details class="activity-details">
        <summary aria-label={$i18n("m_4963c03090ab", {v0: ($i18n.system(activity.label))})}>
          <span class="activity-line">{@render headline()}</span>
        </summary>
        <div class="activity-content">
          {#if messages.some(m=>!m.file&&activeNodeTransfer(m))}<p>{$i18n.text("Передаём сообщения на ноду. До подтверждения приёма оставьте приложение открытым.")}</p>{/if}
          <NodeQueueBadges {messages} {onJump} {onClear} />
          <DeliveryAttention {messages} />
        </div>
      </details>
    {/if}
  </div>
{/if}
<style>
  .chat-activity{position:relative;display:grid;grid-template-columns:minmax(0,1fr);gap:6px;align-items:start;flex-shrink:0;margin:0 0 5px;min-width:0}
  .chat-activity.split{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
  .transfer-pane{display:flex;flex-wrap:wrap;gap:3px;align-items:center;min-width:0}.remind{font-size:10px;min-height:26px;padding:3px 6px}.reminder-note{font-size:11px;color:var(--muted);flex-basis:100%;overflow-wrap:anywhere}
  .chat-activity :global(.transfer-badges){margin:0;padding:0;min-height:28px;gap:3px}
  .chat-activity :global(.transfer-badge){font-size:11px;padding:2px 5px;min-height:28px}
  .chat-activity :global(.meter){width:17px;height:17px}
  .activity-line{display:flex;align-items:center;gap:5px;min-width:0;max-width:100%;font-size:11px;line-height:18px;color:var(--muted);font-variant-numeric:tabular-nums}
  .signal{width:6px;height:6px;border-radius:50%;background:var(--muted);flex-shrink:0}
  .signal.success{background:var(--success)}.signal.warning{background:var(--warning)}.signal.danger{background:var(--danger)}
  .label{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
  .transfer{white-space:nowrap;margin-left:auto;font-size:10px}
  .activity-details{flex-shrink:0;min-width:0;margin:0;font-size:12px}
  summary{display:flex;align-items:center;gap:6px;list-style:none;cursor:pointer;min-height:28px;border-radius:8px;padding:2px 30px 2px 7px;background:var(--surface-alt)}
  summary::-webkit-details-marker{display:none}summary .activity-line{flex:1}
  summary:hover{background:var(--accent-soft)}
  .activity-content{position:absolute;z-index:20;inset-inline:0;top:100%;padding:7px;background:var(--surface);border:1px solid var(--line);border-radius:8px;margin-top:4px;max-height:35dvh;overflow:auto;box-shadow:0 8px 24px var(--shadow-color)}
  .activity-content p{margin:4px 0;font-size:12px;color:var(--muted)}
</style>
