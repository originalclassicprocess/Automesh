<script lang="ts">
  import RadioBoardName from './RadioBoardName.svelte';
  import { tr as i18n } from '$lib/i18n/language';
  import CompactDialog from '$lib/application/CompactDialog.svelte';
  import QueueCategory from '$lib/chat/QueueCategory.svelte';
  import type { SessionChats } from '$lib/chat/session-chats';
  import { radioCategories, radioQueueView } from './queue-view';
  let {chats,connected,connecting,error,name,board='',onRetry,onConnect,onSettings,onOpen,onClose}:
    {chats:SessionChats;connected:boolean;connecting:boolean;error:string;board?:string;name(peer:string):string;onRetry(peer:string,id:string):void;onConnect():void;onSettings():void;onOpen(peer:string,id:string):void;onClose():void}=$props();
  let selected=$state('');
  const detailId=$props.id();
  const items=$derived(radioQueueView(chats));
  const failed=$derived(items.some(i=>i.kind==='retry'));
  const relevantError=$derived(error&&(failed||!connected)?error:'');
</script>
<CompactDialog title="LoRa" {onClose}>
  {#if board}<p class="hint"><RadioBoardName name={board}/></p>{/if}
  <p class="module-state"><span class="dot" class:success={connected&&!connecting} class:warning={connecting} aria-hidden="true"></span>{$i18n.text(connecting?'Восстанавливаем подключение к LoRa…':connected?'Радиомодуль подключён':'Радиомодуль отключён')}</p>
  <div class="categories" aria-label={$i18n.text('Очередь LoRa')}>{#each radioCategories as category}
    <QueueCategory label={$i18n.text(category.label)} count={items.filter(i=>i.kind===category.id).length}
      tone={category.tone==='waiting'?'warning':category.tone} active={selected===category.id} controls={detailId}
      onToggle={()=>selected=selected===category.id?'':category.id}/>
  {/each}</div>
  {#if relevantError}<details class="danger"><summary>{$i18n.text('Причина ошибки')}</summary><p>{$i18n.system(relevantError)}</p></details>{/if}
  {#if selected}<div class="rows" id={detailId}>{#each items.filter(i=>i.kind===selected) as item (`${item.peer}:${item.message.id}`)}<div class="row">
    <button class="message" onclick={()=>{onClose();onOpen(item.peer,item.message.id);}}><strong>{name(item.peer)}</strong><span>{item.message.text.slice(0,80)}</span></button>
    {#if connected&&['retry','board','awaiting','paused','stopped'].includes(item.kind)}<button class="retry" onclick={()=>onRetry(item.peer,item.message.id)}>{$i18n.text('Повторить по LoRa')}</button>{/if}
  </div>{:else}<p class="muted">{$i18n.text('Нет незавершённых отправок LoRa.')}</p>{/each}</div>
  {:else}<p class="hint">{$i18n.text('Нажмите на показатель, чтобы увидеть подробности.')}</p>{/if}
  <div class="actions">{#if !connected}<button disabled={connecting} onclick={onConnect}>{$i18n.text('Подключить плату')}</button>{/if}<button onclick={()=>{onClose();onSettings();}}>{$i18n.text('Настройки LoRa')}</button></div>
  <details><summary>{$i18n.text('Что означают цвета?')}</summary>
    <p>{$i18n.text('Жёлтый — передаём или ждём ответа платы: оставьте приложение открытым. Красный — нужна проверка или повтор. Зелёный — все части приняты платой собеседника либо получены Automesh. Серый — отправка остановлена вами.')}</p>
    <p>{$i18n.text('Буфер платы ограничен и не заменяет постоянное хранилище. После сохранения в Automesh сообщение исчезает из этого индикатора, но остаётся в чате. Прочтение — отдельный статус.')}</p>
  </details>
</CompactDialog>
<style>
 .categories{display:flex;flex-wrap:wrap;gap:8px}.dot{flex:0 0 7px;width:7px;height:7px;border-radius:50%;background:var(--line-strong)}.dot.success{background:var(--success)}.dot.warning{background:var(--warning)}
 p{margin:12px 0;color:var(--muted);font-size:13px;line-height:1.5}.module-state{display:flex;align-items:center;gap:7px;margin-top:0}.hint{margin-bottom:0}.rows{max-height:35dvh;overflow:auto;margin-top:12px}.row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px 0;border-top:1px solid var(--line)}.message{min-width:0;flex:1;display:grid;text-align:left;gap:4px;border:0;font-size:14px}.message span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.retry{font-size:12px;padding:6px}.actions{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.actions button{min-height:38px;padding:7px 10px;font-size:13px}.muted,details{color:var(--muted);font-size:13px}details p{margin:8px 0}details.danger{color:var(--danger)}
</style>
