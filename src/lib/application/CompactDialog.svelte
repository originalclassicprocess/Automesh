<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import { onMount, type Snippet } from 'svelte';
  import ChatIcon from '$lib/chat/ChatIcon.svelte';
  let { title, children, onClose }: { title: string; children: Snippet; onClose(): void } = $props();
  let dialog: HTMLDialogElement;
  onMount(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    return () => { dialog.close(); if (previous?.isConnected && !previous.closest('[inert]')) previous.focus({ preventScroll: true }); };
  });
</script>
<dialog bind:this={dialog} aria-label={$i18n.text(title)} oncancel={event => { event.preventDefault(); onClose(); }}>
  <header><h3>{$i18n.text(title)}</h3><button type="button" onclick={onClose} aria-label={$i18n.text("Закрыть")} title={$i18n.text("Закрыть")}><ChatIcon name="close" /></button></header>
  {@render children()}
</dialog>
<style>
  dialog { width:min(420px, calc(100vw - 32px)); max-height:calc(100dvh - 40px); overflow:auto; padding:16px; box-sizing:border-box; }
  header { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:12px; }
  h3 { margin:0; font-size:19px; } button { display:grid; place-items:center; min-width:44px; min-height:44px; padding:6px; }
</style>
