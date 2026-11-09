<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import ChatIcon from './ChatIcon.svelte';
  let { text, onRetry }: { text:string; onRetry():void } = $props();
  let open = $state(false);
  function modal(node: HTMLDialogElement) { node.showModal(); return { destroy() { node.close(); } }; }
</script>
<button class="connection-info" type="button" onclick={() => open = true} aria-label={$i18n.text("Состояние прямого соединения: подробнее")} title={$i18n.text("Подробнее о соединении")}><ChatIcon name="info" /></button>
<span class="sr-only" role="status">{$i18n.text(text)}</span>
{#if open}
  <dialog use:modal aria-label={$i18n.text("Соединение с собеседником")} oncancel={event => { event.preventDefault(); open = false; }}>
    <header><h3>{$i18n.text("Соединение")}</h3><button type="button" aria-label={$i18n.text("Закрыть")} onclick={() => open = false}><ChatIcon name="close" /></button></header>
    <p>{$i18n.text(text)}</p>
    <small>{$i18n.text("Это статус прямого соединения. Доставка через подключённую ноду может работать отдельно.")}</small>
    <button class="retry" type="button" onclick={() => { open = false; onRetry(); }}>{$i18n.text("Повторить подключение")}</button>
  </dialog>
{/if}
<style>
  .connection-info { display:grid; place-items:center; flex-shrink:0; width:32px; min-width:32px; height:36px; min-height:36px; padding:4px; background:transparent; border-color:transparent; color:var(--muted); }
  .sr-only { position:absolute; width:1px; height:1px; margin:-1px; padding:0; border:0; overflow:hidden; clip-path:inset(50%); white-space:nowrap; }
  dialog { box-sizing:border-box; width:min(420px,calc(100vw - 24px)); max-height:calc(100dvh - 24px); overflow:auto; padding:18px; border:1px solid var(--line); border-radius:16px; background:var(--surface); color:var(--text); }
  dialog::backdrop { background:var(--overlay); } header { display:flex; align-items:center; justify-content:space-between; gap:8px; } h3 { margin:0; font-size:18px; } header button { display:grid; place-items:center; padding:8px; } p { font-size:14px; line-height:1.5; } small { display:block; color:var(--muted); font-size:12px; line-height:1.5; } .retry { margin-top:16px; width:100%; }
  @media(pointer:coarse) { .connection-info { min-height:44px; height:44px; width:36px; min-width:36px; } }
</style>
