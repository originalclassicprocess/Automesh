<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import { connectionIndicators, deliveryIndicators } from './connection-indicators';
  import { connectionOverview } from './connection-indicators';
  import ChatIcon from '$lib/chat/ChatIcon.svelte';
  import type { CourierStatus } from '$lib/node/courier-controller';
  import type { NodeState } from './RoutedWebRTCTransport';
  let { nodes, directCount, serversEnabled, internetEnabled = true, onOpen, courierEnabled, courierStatus, courierPending, trusted, receiveKeys, deliveryOverride,
    compact = false, responsive = false, expanded = false, onToggle = () => {}, radioState }:
    { nodes: NodeState[]; directCount: number; serversEnabled: boolean; onOpen: (section: 'direct' | 'servers' | 'outgoing' | 'incoming' | 'radio') => void;
      courierEnabled: boolean; courierStatus: CourierStatus; courierPending: number; trusted: boolean; receiveKeys: number; internetEnabled?: boolean;
      compact?: boolean; responsive?: boolean; expanded?: boolean; onToggle?: () => void; deliveryOverride?: import('./connection-indicators').ConnectionIndicator[]; radioState?: 'connected' | 'connecting' | 'offline' } = $props();
  const indicators = $derived([...connectionIndicators(nodes, directCount, serversEnabled, internetEnabled), ...(deliveryOverride ?? deliveryIndicators(courierEnabled, courierStatus, courierPending,
    trusted, serversEnabled && nodes.some(n => n.status === 'connected'), receiveKeys)), ...(radioState ? [{label:'LoRa',state:radioState,section:'radio' as const,detail:radioState==='connected'?'Радиомодуль подключён. Доступность собеседника определяется подтверждениями сообщений.':'Радиомодуль не подключён или подключается.'}] : [])]);
  const summary = $derived(connectionOverview(indicators, courierStatus.connection === 'connected'));
</script>
{#if compact}
  <div class:responsive-summary={responsive}>
  <button class="network-summary" type="button" onclick={onToggle} aria-expanded={expanded} aria-haspopup="dialog"
    title={$i18n("m_d17350054cd4", {v0: ($i18n.text(summary.label))})} aria-label={$i18n("m_f5a9f5d4192b", {v0: ($i18n.text(summary.label))})}>
    <ChatIcon name="network" /><span class="summary-dot" class:connected={summary.connected} class:connecting={summary.connecting}></span>
  </button>
  </div>
{/if}
{#if !compact || responsive}
<div class="connections" class:responsive-connections={responsive} aria-label={$i18n.text("Состояние связи")}>
  {#each indicators as item}
    <button type="button" onclick={() => onOpen(item.section ?? 'servers')} title={$i18n.system(item.detail)} aria-label={`${$i18n.system(item.label)}: ${$i18n.system(item.detail)}`}>
      <span class="dot" class:connected={item.state === 'connected'} class:connecting={item.state === 'connecting'}></span>
      {$i18n.system(item.label)}<span class="sr-only">: {$i18n.system(item.detail)}</span>
    </button>
  {/each}
</div>
{/if}
<style>
  .connections { display:flex; gap:5px; flex-wrap:wrap; }
  .responsive-connections { display:none; }
  @container (min-width:1000px) {
    .responsive-summary { display:none; }
    .responsive-connections { display:flex; flex-wrap:nowrap; }
  }
  button { display:flex; align-items:center; gap:5px; padding:5px 8px; min-height:30px; border:1px solid var(--line); border-radius:14px; background:var(--surface-alt); font-size:11px; cursor:pointer; }
  @media(pointer:coarse) { button { min-height:36px; } }
  .dot { width:7px; height:7px; background:var(--line-strong); border-radius:50%; }
  .connected { background:var(--success); } .connecting { background:var(--warning); }
  .network-summary { position:relative; display:grid; place-items:center; min-width:44px; min-height:44px; padding:6px; border-radius:10px; background:var(--surface); }
  .summary-dot { position:absolute; right:3px; top:3px; width:8px; height:8px; border-radius:50%; background:var(--line-strong); outline:2px solid var(--surface); }
  .summary-dot.connected { background:var(--success); } .summary-dot.connecting { background:var(--warning); }
  .sr-only { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); }
</style>
