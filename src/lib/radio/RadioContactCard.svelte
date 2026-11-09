<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import HelpInfo from '$lib/application/HelpInfo.svelte';
  import type { RadioContactOffer } from './contact-exchange';
  import { verifyChatRadioContact } from './contact-exchange';
  let { offer, peer, outgoing, forwarded = false, network = '', connected = false, active = false, onAccept, onSettings }:
    { offer:RadioContactOffer; peer:string; outgoing:boolean; forwarded?:boolean; network?:string; connected?:boolean; active?:boolean;
      onAccept():Promise<void>; onSettings():void } = $props();
  let checking=$state(true),valid=$state(false),expires=$state(0),node=$state(''),busy=$state(false),error=$state('');
  $effect(()=>{
    const invite=offer.invite, account=peer, selected=network;let canceled=false;
    checking=true;valid=false;
    if(selected)void verifyChatRadioContact(invite,account,selected).then(value=>{
      if(!canceled){valid=true;expires=value.body.expires;node=`!${value.body.node.toString(16).padStart(8,'0')}`;}
    }).catch(()=>{}).finally(()=>{if(!canceled)checking=false;});
    else checking=false;
    return()=>{canceled=true;};
  });
  async function accept(){busy=true;error='';try{await onAccept();}catch(e){error=e instanceof Error?e.message:'Не удалось подключить радиоконтакт.';}finally{busy=false;}}
</script>
<section class="radio-card" aria-label={$i18n.text('Радиоконтакт')}>
  <strong>LoRa · {$i18n.text('Радиоконтакт')}</strong>
  <small>{node}{#if expires} · {$i18n.text('Срок радиоконтакта')}: {new Date(expires).toLocaleString()}{/if}</small>
  {#if outgoing}<p>{$i18n.text(offer.replyTo?'Ответный радиоконтакт отправлен.':'Собеседник сможет подключить LoRa и отправить свой радиоконтакт одной кнопкой.')}</p>
  {:else if active}<p class="success">✓ {$i18n.text('Маршрут LoRa подключён')}</p>{#if !offer.replyTo&&!forwarded}<button disabled={busy} onclick={()=>void accept()}>{$i18n.text('Отправить свой радиоконтакт')}</button>{/if}
  {:else if forwarded}<p>{$i18n.text('Попросите собеседника отправить свой радиоконтакт напрямую.')}</p>
  {:else if !connected}<button onclick={onSettings}>{$i18n.text('Подключить радиомодуль')}</button>
  {:else if checking}<p>{$i18n.text('Проверяем радиоконтакт…')}</p>
  {:else if valid}<button disabled={busy} onclick={()=>void accept()}>{$i18n.text(offer.replyTo?'Подключить LoRa':'Подключить и отправить свой')}</button>
  {:else}<p>{$i18n.text('Радиоконтакт истёк или не подходит к выбранной радиосети. Попросите новый.')}</p>{/if}
  <HelpInfo label={$i18n.text('Как подключить LoRa')} text={$i18n.text('Обеим сторонам нужны адрес платы и публичный ключ друг друга. Ответная карточка передаёт их автоматически через обычный чат. Общий ключ радиоканала и сид не передаются. Платы должны быть настроены на совместимую радиосеть.')} />
  {#if error}<p role="alert" class="error">{$i18n.system(error)}</p>{/if}
</section>
<style>
 .radio-card{display:grid;gap:8px;min-width:0;max-width:340px;padding:10px;border:1px solid var(--line);border-radius:12px;background:var(--surface-alt)}p{margin:0;font-size:13px;line-height:1.5}small{color:var(--muted);font-size:11px}button{font-size:13px;min-height:40px}.success{color:var(--success)}.error{color:var(--danger)}
</style>
