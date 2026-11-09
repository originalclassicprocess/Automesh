<script lang="ts">
  import QRCode from 'qrcode';
  import { tr as i18n } from '$lib/i18n/language';
  import HelpInfo from '$lib/application/HelpInfo.svelte';
  let {contact}:{contact:string}=$props();
  let open=$state(false),qr=$state(''),copied=$state(false),error=$state('');
  $effect(()=>{const text=contact,shown=open;let canceled=false;qr='';copied=false;
    if(text&&shown)void QRCode.toDataURL(text,{width:320,margin:2,errorCorrectionLevel:'L'}).then(url=>{if(!canceled)qr=url;}).catch(()=>{});
    return()=>{canceled=true;};});
  async function copy(){try{await navigator.clipboard.writeText(contact);copied=true;error='';}catch{open=true;error='Не удалось скопировать. Выделите текст радиоконтакта.';}}
</script>
<section class="radio-share">
  <div class="title"><h4>LoRa · {$i18n.text('Мой радиоконтакт')}</h4><HelpInfo label={$i18n.text('Как подключить LoRa')} text={$i18n.text('Этот радиоконтакт действует 24 часа. В нём публичный адрес платы и ключ приёма, без сида и общего ключа радиоканала. Отправьте его из чата: собеседник сможет ответить своей карточкой.')} /></div>
  <div class="actions"><button onclick={()=>void copy()}>{$i18n.text(copied?'Скопировано.':'Копировать радиоконтакт')}</button><button aria-expanded={open} onclick={()=>open=!open}>{$i18n.text(open?'Скрыть QR':'Показать QR')}</button></div>
  {#if open}{#if qr}<img src={qr} width="256" height="256" alt={$i18n.text('QR радиоконтакта')}/>{/if}<textarea readonly value={contact} aria-label={$i18n.text('Мой радиоконтакт')}></textarea>{/if}
  {#if error}<p role="alert">{$i18n.text(error)}</p>{/if}
</section>
<style>
 .radio-share{padding:14px;border:1px solid var(--line);border-radius:12px;background:var(--surface-alt);margin-top:16px}.title,.actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}h4{margin:0;font-size:14px}.actions{margin-top:10px}button{font-size:14px;min-height:40px}img{display:block;max-width:100%;height:auto;margin:12px 0}textarea{width:100%;box-sizing:border-box;min-height:80px;overflow-wrap:anywhere}p{color:var(--danger);font-size:13px}
</style>
