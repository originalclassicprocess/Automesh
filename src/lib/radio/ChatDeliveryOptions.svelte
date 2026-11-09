<script lang="ts">
  import RadioBoardName from './RadioBoardName.svelte';
  import { tr as i18n } from '$lib/i18n/language';
  import type { OfflineKeyBudget } from '$lib/chat/offline-key-budget';
  import type { RadioReception as Reception } from './reception';
  import HelpInfo from '$lib/application/HelpInfo.svelte';
  import RadioReception from './RadioReception.svelte';
  import RadioPresence from './RadioPresence.svelte';
  let {budget,nodeUrl='',onNode,radioKnown=false,connected=false,connecting=false,board='',preferred=false,hasRoute=false,eligible=false,busy=false,reception,heard,now,onRadio,onReconnect,connectionError='',onPreferred,onShare}:
    {budget:OfflineKeyBudget;nodeUrl?:string;onNode():void;radioKnown?:boolean;connected?:boolean;connecting?:boolean;board?:string;preferred?:boolean;hasRoute?:boolean;eligible?:boolean;busy?:boolean;reception?:Reception;heard?:number;now:number;onRadio():void;onReconnect?():void;connectionError?:string;onPreferred(value:boolean):Promise<void>;onShare():Promise<void>}=$props();
  let error=$state(''),saving=$state(false);
  const nodeLabel=$derived.by(()=>{try{return nodeUrl?new URL(nodeUrl).host:'';}catch{return '';}});
  async function choose(value:boolean){saving=true;error='';try{await onPreferred(value);}catch(e){error=e instanceof Error?e.message:'Не удалось сохранить настройку.';}finally{saving=false;}}
  async function share(){saving=true;error='';try{await onShare();}catch(e){error=e instanceof Error?e.message:'Не удалось отправить радиоконтакт.';}finally{saving=false;}}
</script>
<div class="delivery-options">
  <section><h4>{$i18n.text('Нода')}{#if nodeLabel}<small>{nodeLabel}</small>{/if}</h4>
    <p>{$i18n.system(budget.label)}</p>
    <div class="actions"><button onclick={onNode}>{$i18n.text('Настроить ноду')}</button><HelpInfo label={$i18n.text('Офлайн-доставка')} text={$i18n.system(budget.detail)}/></div>
  </section>
  <section><h4>LoRa {#if board}<small><RadioBoardName name={board}/></small>{/if}</h4>
    <p>{$i18n.text(connecting?'Восстанавливаем подключение к LoRa…':connected?'Радиомодуль подключён':radioKnown?'Радиомодуль отключён':'Модуль не подключён')}</p>
    <label class="check"><input type="checkbox" checked={preferred} disabled={busy||saving||!eligible||!preferred&&(!connected||!hasRoute)} onchange={e=>void choose(e.currentTarget.checked)}/>{$i18n.text('Отправлять в этом чате по LoRa')}</label>
    {#if connected&&hasRoute}<RadioPresence {connected} {heard} {now}/>{/if}
    {#if reception}<p class="last">{$i18n.text('Последний приём')}: {new Date(reception.receivedAt).toLocaleString()}</p><RadioReception {reception}/>
    {:else}<p class="muted">{$i18n.text('Качество связи пока неизвестно. Оно появится после приёма пакета собеседника.')}</p>{/if}
    {#if connected&&!hasRoute}<p class="muted">{$i18n.text('Для отправки нужен радиоконтакт собеседника.')}</p>{/if}
    {#if !connected&&connectionError}<p class="error">{$i18n.system(connectionError)}</p>{/if}
    <div class="actions">{#if !connected&&radioKnown&&onReconnect}<button disabled={busy||saving||connecting} onclick={onReconnect}>{$i18n.text('Восстановить подключение')}</button>{/if}<button onclick={onRadio}>{$i18n.text('Настройки LoRa')}</button>{#if connected&&eligible}<button disabled={busy||saving} onclick={()=>void share()}>{$i18n.text('Отправить свой радиоконтакт')}</button>{/if}</div>
    <HelpInfo label={$i18n.text('Выбор доставки')} text={$i18n.text('Выбор LoRa действует для этого чата. Только короткий текст; файлы и исчезающие сообщения отправляйте обычным способом. Качество оценено по последнему принятому пакету и не гарантирует текущую доступность собеседника. Дополнительных запросов в эфир нет.')} />
  </section>
  {#if error}<p class="error" role="alert">{$i18n.system(error)}</p>{/if}
</div>
<style>
 .delivery-options{display:grid;gap:12px}section{padding:12px;border:1px solid var(--line);border-radius:12px;background:var(--surface-alt);min-width:0}h4{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 8px;font-size:14px}small{font-size:11px;color:var(--muted);font-weight:400;overflow-wrap:anywhere}p{font-size:13px;margin:8px 0;line-height:1.5}.check{display:flex;align-items:center;gap:8px;margin:12px 0;font-size:14px;min-height:44px}.actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:10px 0}button{font-size:13px;min-height:40px}.muted,.last{color:var(--muted)}.last{font-size:11px}.error{color:var(--danger)}
</style>
