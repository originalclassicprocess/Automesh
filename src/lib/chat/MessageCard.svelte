<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import type { Snippet } from 'svelte';
  import { selectionGesture } from './message-selection-gesture';
  let { children, outgoing = false, sticker = false, selecting = false, selected = false, highlighted = false, busy = false, preview, onSelect, onBeginSelect }:
    { children: Snippet; outgoing?: boolean; sticker?: boolean; selecting?: boolean; selected?: boolean; highlighted?: boolean; busy?: boolean; preview: string; onSelect: () => void; onBeginSelect?: () => void } = $props();
</script>
<div class="chat-message" use:selectionGesture={{canBegin:()=>!selecting&&!busy&&!!onBeginSelect,onBegin:()=>onBeginSelect?.()}} class:outgoing class:sticker class:touch-selectable={!!onBeginSelect} class:selectable={selecting} class:selected class:highlighted>
  {#if selecting}
    <button type="button" class="message-select" aria-label={$i18n("m_8c7a74e7de74", {v0: (preview)})} aria-pressed={selected} disabled={busy} onclick={onSelect}>
      <span aria-hidden="true">{selected ? '✓' : ''}</span>
    </button>
  {/if}
  <div class="message-content" inert={selecting}>{@render children()}</div>
</div>
<style>
  .chat-message { position:relative; width:fit-content; max-width:85%; min-width:125px; margin:0 0 12px; padding:10px 12px; border:1px solid var(--line); border-radius:12px 12px 12px 3px; background:var(--surface); overflow-wrap:anywhere; }
  .outgoing { margin-left:auto; background:var(--outgoing); border-color:var(--outgoing-line); border-radius:12px 12px 3px 12px; }
  .sticker { background:transparent; border-color:transparent; }
  .message-content > :global(small) { color:var(--muted); font-size:11px; }
  .message-content > :global(small img) { width:16px; height:16px; }
  .highlighted { background:var(--highlight); border-color:var(--highlight-line); }
  .selected { border-color:var(--accent); box-shadow:0 0 0 1px var(--accent); }
  .selectable .message-content { padding-right:28px; }
  .message-select { position:absolute; inset:0; z-index:2; width:100%; height:100%; border:0; border-radius:inherit; background:transparent; display:flex; align-items:flex-start; justify-content:flex-end; padding:10px; }
  .message-select:hover:not(:disabled), .message-select[aria-pressed="true"] { background:transparent; }
  .message-select span { width:20px; height:20px; border:1px solid var(--muted); border-radius:5px; background:var(--surface); color:var(--accent); font-weight:700; display:grid; place-items:center; }
  .message-select[aria-pressed="true"] span { background:var(--accent); border-color:var(--accent); color:var(--on-accent); }
  @media(max-width:700px) { .chat-message { max-width:94%; padding:9px 10px; } }
  @media(pointer:coarse) { .touch-selectable { -webkit-touch-callout:none; user-select:none; } .touch-selectable :global(a) { -webkit-touch-callout:default; user-select:text; } }
</style>
