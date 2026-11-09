<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import ChatIcon from './ChatIcon.svelte';
  import type { OfflineKeyBudget } from './offline-key-budget';
  let { budget, configured, connected, expanded = false, onOpen, radioSelected=false, radioConnected=false }: { budget: OfflineKeyBudget; configured: boolean;
    connected: boolean; expanded?: boolean; onOpen(): void; radioSelected?:boolean; radioConnected?:boolean } = $props();
</script>
<button type="button" class="offline-key-badge" class:unconfigured={!configured} onclick={onOpen}
  title={radioSelected?'LoRa':$i18n.system(budget.label)} aria-label={$i18n.text('Доставка: нода и LoRa')} aria-expanded={expanded} aria-haspopup="dialog">
  {#if radioSelected}<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M8 20h8M10 20l2-10 2 10M7 14a7 7 0 0 1 0-10m10 10a7 7 0 0 0 0-10M4 17a11 11 0 0 1 0-16m16 16a11 11 0 0 0 0-16"/><circle cx="12" cy="8" r="1.7"/></svg>{:else}<ChatIcon name="node" />{/if}
  {#if !radioSelected&&configured}<span class="key-count" class:empty={!budget.available}>{budget.badgeText??budget.count}</span>
  {:else if !radioSelected}<span class="unavailable-mark" aria-hidden="true">/</span>{/if}
  <span class="node-dot" class:connected={radioSelected?radioConnected:connected} aria-hidden="true"></span>
</button>
<style>
  .offline-key-badge { position:relative; display:grid; place-items:center; min-width:44px; min-height:44px; padding:6px; color:var(--muted); }
  .key-count { position:absolute; right:-2px; top:-4px; min-width:17px; padding:0 3px; background:var(--accent-soft); color:var(--accent); border:1px solid var(--line); border-radius:8px; font-size:11px; font-weight:600; line-height:17px; }
  .key-count.empty { background:var(--warning-soft); color:var(--warning); }
  .node-dot { position:absolute; bottom:3px; right:3px; width:6px; height:6px; border-radius:50%; background:var(--line-strong); }
  .node-dot.connected { background:var(--success); }
  .unavailable-mark { position:absolute; font-size:28px; line-height:1; color:var(--muted); background:var(--surface); width:8px; transform:rotate(12deg); }
</style>
