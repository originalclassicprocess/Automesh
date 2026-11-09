<script lang="ts">
  import {locale as uiLocale} from '$lib/i18n/language';
  import { tr as i18n } from '$lib/i18n/language';
  import ChatIcon from '$lib/chat/ChatIcon.svelte';
  import { callRecordLabel, type CallRecord } from './history';
  let { record, disabled = false, onCall, onDelete }: { record: CallRecord; disabled?: boolean; onCall(): void; onDelete(): void } = $props();
</script>
<section class="call-history" aria-label={$i18n.text("Запись звонка")} class:outgoing={record.outgoing}>
  <ChatIcon name="phone" />
  <div><strong>{$i18n.system(callRecordLabel(record))}</strong><small><time datetime={new Date(record.created).toISOString()}>{new Date(record.created).toLocaleTimeString($uiLocale, { hour: '2-digit', minute: '2-digit' })}</time> {$i18n.text("· На этом устройстве")}</small></div>
  {#if record.phase === 'ended'}<button aria-label={$i18n.text("Позвонить снова")} title={$i18n.text("Позвонить снова")} {disabled} onclick={onCall}><ChatIcon name="phone" /></button>{/if}
  <button aria-label={$i18n.text("Удалить запись звонка")} title={$i18n.text("Удалить запись звонка")} onclick={onDelete}><ChatIcon name="close" /></button>
</section>
<style>
  .call-history { display:flex; align-items:center; gap:10px; padding:12px; margin:0 0 12px; border:1px solid var(--line); border-radius:14px; background:var(--surface); max-width:85%; width:fit-content; }
  .outgoing { margin-left:auto; background:var(--accent-soft); }
  .call-history div { min-width:0; } strong { font-size:14px; overflow-wrap:anywhere; } small { display:block; color:var(--muted); font-size:11px; margin-top:5px; }
  button { display:grid; place-items:center; padding:8px; min-width:40px; min-height:40px; border-radius:50%; flex-shrink:0; }
  @media(max-width:700px) { .call-history { max-width:100%; box-sizing:border-box; gap:6px; } }
</style>
