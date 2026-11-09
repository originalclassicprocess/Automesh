<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import { onMount } from 'svelte';
  let { words }: { words: string[] } = $props();
  let revealed = $state(false);
  function hide(): void { revealed = false; }
  function hold(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget instanceof HTMLElement && event.currentTarget.setPointerCapture(event.pointerId);
    revealed = true;
  }
  onMount(() => {
    const visibility = () => { if (document.hidden) hide(); };
    window.addEventListener('blur', hide);
    window.addEventListener('pointerup', hide);
    document.addEventListener('visibilitychange', visibility);
    return () => { hide(); window.removeEventListener('blur', hide); window.removeEventListener('pointerup', hide); document.removeEventListener('visibilitychange', visibility); };
  });
</script>

<p><small>{$i18n.text("Удерживайте область со словами, чтобы увидеть фразу. На клавиатуре — удерживайте пробел.")}</small></p>
<button type="button" class="seed" aria-label={$i18n.text("Удерживайте, чтобы увидеть seed-фразу")}
  onpointerdown={hold} onpointerup={hide} onpointercancel={hide} onlostpointercapture={hide} onpointerleave={hide} onblur={hide}
  onkeydown={(event) => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); revealed = true; } }}
  onkeyup={(event) => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); hide(); } }}
  oncontextmenu={(event) => event.preventDefault()} oncopy={(event) => event.preventDefault()} oncut={(event) => event.preventDefault()}>
  {#each words as word, index}<span class="word"><small>{index + 1}.</small> {revealed ? word : '••••••'}</span>{/each}
</button>

<style>
  .seed { display:grid; width:100%; text-align:left; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:12px; padding:14px; border:1px solid var(--line-strong); user-select:none; touch-action:none; overflow-wrap:anywhere; background:var(--surface-alt); color:var(--text); }
  .seed small { color:var(--muted); }
  @media (max-width:400px) { .seed { grid-template-columns:repeat(2, minmax(0, 1fr)); } }
</style>
