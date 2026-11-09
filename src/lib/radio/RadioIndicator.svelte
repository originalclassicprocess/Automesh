<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import type { SessionChats } from '$lib/chat/session-chats';
  import { radioQueueView } from './queue-view';
  let {chats,connecting,expanded=false,board='',onOpen}:
    {chats:SessionChats;connecting:boolean;expanded?:boolean;board?:string;onOpen():void}=$props();
  const items=$derived(radioQueueView(chats));
  const tone=$derived(items.some(i=>i.kind==='retry')?'danger':items.some(i=>i.kind==='sending'||i.kind==='awaiting')||connecting?'waiting':items.some(i=>i.kind==='board')?'success':'neutral');
</script>
<button type="button" class="radio-indicator {tone}" onclick={onOpen} aria-haspopup="dialog" aria-expanded={expanded} title={board?`LoRa · ${board}`:'LoRa'} aria-label={`${$i18n.text('Очередь LoRa')}${board?` · ${board}`:''}`}>
 <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 20h8M10 20l2-10 2 10M7 14a7 7 0 0 1 0-10m10 10a7 7 0 0 0 0-10M4 17a11 11 0 0 1 0-16m16 16a11 11 0 0 0 0-16"/><circle cx="12" cy="8" r="1.7"/></svg>
 <span class="count" aria-hidden="true">{items.length>99?'99+':items.length}</span>
</button>
<style>
 .radio-indicator{position:relative;display:inline-grid;place-items:center;box-sizing:border-box;width:44px;min-width:44px;max-width:44px;height:44px;min-height:44px;flex:0 0 44px;padding:6px;border-radius:10px;color:var(--muted);background:var(--surface);border:1px solid var(--line)}.success{color:var(--success)}.waiting{color:var(--warning)}.danger{color:var(--danger)}.count{position:absolute;top:1px;right:2px;font-size:10px;font-weight:600;line-height:12px;padding:0 2px;background:var(--surface);border-radius:5px;font-variant-numeric:tabular-nums}
</style>
