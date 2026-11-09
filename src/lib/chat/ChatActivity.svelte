<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import type { ChatEntry } from './session-chats';
  import { chatActivity } from './chat-activity';
  import TransferBadges from './TransferBadges.svelte';
  import NodeQueueBadges from './NodeQueueBadges.svelte';
  import DeliveryAttention from './DeliveryAttention.svelte';
  import { activeNodeTransfer } from './node-transfer';
  import { transferActivity } from './transfer-activity';
  let { messages, compact = false, onJump, onClear }: {
    messages: readonly ChatEntry[]; compact?: boolean; onJump?: (id: string) => void; onClear?: () => void;
  } = $props();
  const activity = $derived(chatActivity(messages,{summarizeTransfers:false}));
  const transfers = $derived(transferActivity(messages));
  const keepOpen = $derived(transfers.outgoing.active+transfers.outgoing.waiting+transfers.incoming.active+transfers.incoming.waiting>0);
</script>
<TransferBadges {messages} {compact} {onJump} showHelp={keepOpen} />
{#if activity}
  {#snippet headline()}
    <span class="signal {activity.tone}" aria-hidden="true"></span>
    <span class="label">{$i18n.system(activity.label)}</span>
    {#if activity.transfer}<span class="transfer">{activity.transfer}</span>{/if}
  {/snippet}
  {#if compact}
    <span class="activity-line" title={$i18n.system(activity.detail)} aria-label={`${$i18n.system(activity.label)}${activity.transfer ? `. ${activity.transfer}` : ''}`}>{@render headline()}</span>
  {:else}
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
{/if}
<style>
  .activity-line{display:flex;align-items:center;gap:5px;min-width:0;max-width:100%;font-size:11px;line-height:18px;color:var(--muted);font-variant-numeric:tabular-nums}
  .signal{width:6px;height:6px;border-radius:50%;background:var(--muted);flex-shrink:0}
  .signal.success{background:var(--success)}.signal.warning{background:var(--warning)}.signal.danger{background:var(--danger)}
  .label{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
  .transfer{white-space:nowrap;margin-left:auto;font-size:10px}
  .activity-details{flex-shrink:0;min-width:0;margin:0 0 5px;font-size:12px}
  summary{display:flex;align-items:center;gap:6px;list-style:none;cursor:pointer;min-height:30px;border-radius:8px;padding:2px 36px 2px 7px;background:var(--surface-alt)}
  summary::-webkit-details-marker{display:none}summary .activity-line{flex:1}
  summary:hover{background:var(--accent-soft)}
  .activity-content{padding:5px 7px;border:1px solid var(--line);border-radius:8px;margin-top:4px;max-height:35dvh;overflow:auto}
  .activity-content p{margin:4px 0;font-size:12px;color:var(--muted)}
</style>
