<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import type { MessageStatus } from './message-presentation';
  let { status, provenance = '', onDetails }: { status: MessageStatus; provenance?: string; onDetails(): void } = $props();
</script>
<span class="delivery-summary">
  {#if provenance}<span class="copy-note" title={$i18n.text(provenance)} aria-label={$i18n.text(provenance)}>↔</span>{/if}
  <button type="button" class="delivery-status" class:confirmed={status.tone === 'success'} class:failed={status.tone === 'error'} class:warning={status.tone === 'waiting'}
    title={[$i18n.system(status.detail), $i18n.text(provenance)].filter(Boolean).join(' ')} aria-label={$i18n("m_5fb5440ae978", {v0: ($i18n.system(status.label))})} onclick={onDetails}>
    <span aria-hidden="true">{status.icon}</span> {$i18n.system(status.label)}
  </button>
</span>
<style>
  .delivery-summary{display:flex;justify-content:flex-end;align-items:center;gap:6px;margin-left:auto;margin-top:6px;font-size:11px;color:var(--muted)}
  .delivery-status{border:0;background:transparent;color:var(--muted);font-size:11px;padding:2px 0;text-align:right;min-height:24px}
  .delivery-status.confirmed{color:var(--success)}.delivery-status.failed{color:var(--danger)}.delivery-status.warning{color:var(--warning)}.copy-note{cursor:help}
</style>
