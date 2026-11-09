<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import { onMount } from 'svelte';
  import { NoticeTimer, type AppNotice } from './notices';
  import ChatIcon from '$lib/chat/ChatIcon.svelte';
  let { notice, onClose }: { notice: AppNotice; onClose(): void } = $props();
  let detailsOpen = $state(false), hover = $state(false), focused = $state(false), mounted = $state(false);
  const timer = new NoticeTimer(() => onClose());
  onMount(() => { mounted = true; return () => timer.dispose(); });
  $effect(() => { if (mounted) timer.update(notice.durationMs,detailsOpen || hover || focused); return () => timer.dispose(); });
</script>
<section class:error={notice.kind === 'error'} class="toast" aria-label={$i18n.text("Уведомление")} onpointerenter={() => hover = true} onpointerleave={() => hover = false}
  onfocusin={() => focused = true} onfocusout={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) focused = false; }}>
  <div class="notice-line"><span role={notice.kind === 'error' ? 'alert' : 'status'}>{$i18n.text(notice.message)}</span>
    {#if notice.details}<button class="details" type="button" aria-expanded={detailsOpen} onclick={() => detailsOpen = !detailsOpen}>{$i18n.text("Подробнее")}</button>{/if}
    <button class="close" type="button" aria-label={$i18n.text("Закрыть уведомление")} onclick={onClose}><ChatIcon name="close" /></button></div>
  {#if detailsOpen}<p>{$i18n.text(notice.details)}</p>{/if}
</section>
<style>
  .toast { pointer-events:auto; border:1px solid var(--line); border-left:3px solid var(--accent); border-radius:12px; padding:8px 10px; background:var(--surface); box-shadow:0 6px 24px var(--shadow-color); font-size:13px; }
  .toast.error { border-left-color:var(--danger); } .notice-line { display:flex; align-items:center; gap:8px; } span { flex:1; min-width:0; overflow-wrap:anywhere; } .close { display:grid; place-items:center; padding:4px; width:32px; min-width:32px; height:36px; min-height:36px; border:0; background:transparent; } .details { flex-shrink:0; padding:6px; font-size:12px; } p { font-size:12px; color:var(--muted); margin:8px 0 2px; line-height:1.5; }
  @media(max-width:380px) { .notice-line { flex-wrap:wrap; } .details { order:2; } }
</style>
