<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import type {ChatEntry} from './session-chats';
  import {deliveryAttention} from './delivery-attention';
  let {messages,compact=false}:{messages:readonly ChatEntry[];compact?:boolean}=$props();
  const attention=$derived(deliveryAttention(messages));
</script>
{#if attention}
  {#if compact}
    <span class="attention {attention.tone}" class:action={attention.tone==='action'} title={$i18n.system(attention.detail)} aria-label={$i18n("m_478e4da86746", {v0: ($i18n.system(attention.label)), v1: (attention.count), v2: ($i18n.system(attention.detail))})}>
      <span aria-hidden="true">{attention.tone==='action'?'!':'◷'}</span> {$i18n.system(attention.label)}{#if attention.count>1} · {attention.count}{/if}
    </span>
  {:else}
    <details class="attention-detail"><summary aria-label={$i18n("m_9c815cba987f", {v0: ($i18n.system(attention.label))})}><span class="attention {attention.tone}" class:action={attention.tone==='action'}>{attention.tone==='action'?'!':'◷'} {$i18n.system(attention.label)}{#if attention.count>1} · {attention.count}{/if}</span></summary><p>{$i18n.system(attention.detail)}</p></details>
  {/if}
{/if}
<style>
  .attention{display:inline-flex;align-items:center;gap:4px;max-width:100%;padding:2px 7px;margin-top:4px;border:1px solid var(--line);border-radius:9px;background:var(--surface-alt);color:var(--muted);font-size:11px;line-height:1.5;font-weight:500;overflow-wrap:anywhere;text-align:left}
  .danger{color:var(--danger)}.success{color:var(--success)}.radio-waiting{color:var(--warning)}.action{color:var(--warning);background:var(--warning-soft)}.attention-detail{flex-shrink:0;font-size:12px;margin:0 0 4px;max-width:100%}.attention-detail summary{padding:0 36px 0 0;min-height:30px;list-style:none}.attention-detail summary::-webkit-details-marker{display:none}.attention-detail p{padding:8px 10px;margin:4px 0;background:var(--surface-alt);border-radius:9px;overflow-wrap:anywhere}
</style>
