<script lang="ts">
  import {tr as i18n} from '$lib/i18n/language';
  let { label, text, open, onToggle }: { label: string; text: string; open?: boolean; onToggle?: () => void } = $props();
  let expanded = $state(false);
  const shown = $derived(open ?? expanded);
</script>
<span class="function-help">
  <button type="button" class="info-button" aria-label={$i18n.text(label)} title={$i18n.text(label)} aria-expanded={shown}
    onclick={() => onToggle ? onToggle() : expanded = !expanded}>?</button>
  {#if shown}<span class="info-copy" role="note">{$i18n.text(text)}</span>{/if}
</span>
<style>
  .function-help { display:inline-flex; align-items:center; flex-wrap:wrap; gap:6px; vertical-align:middle; max-width:100%; }
  .info-button { display:grid; place-items:center; padding:0; width:28px; height:28px; min-height:28px; min-width:28px; border-radius:50%; font-size:13px; color:var(--muted); background:var(--surface-alt); border:1px solid var(--line); }
  .info-copy { display:block; flex-basis:100%; padding:10px 12px; border:1px solid var(--line); border-radius:10px; background:var(--surface-alt); color:var(--muted); font-size:13px; line-height:1.55; max-width:65ch; text-align:left; }
  @media(pointer:coarse) { .info-button { width:36px; height:36px; min-height:36px; min-width:36px; } }
</style>
