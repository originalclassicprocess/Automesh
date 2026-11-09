<script lang="ts">
  import {tick,untrack} from 'svelte';
  import {tr as i18n} from '$lib/i18n/language';
  import ChatIcon from '$lib/chat/ChatIcon.svelte';
  import MessageText from '$lib/chat/MessageText.svelte';
  import HelpInfo from '$lib/application/HelpInfo.svelte';
  import RadioReception from './RadioReception.svelte';
  import RadioBoardName from './RadioBoardName.svelte';
  import {CHANNEL_TEXT_BYTES,channelText,channelSignature,channelFailureLabel,type NativeChannels,type NativeChannel} from './native-channels';
  let {data,selected,live,connected,busy,board,link,onSelect,onEnabled,onSignature,onSend,onSettings,onBack,onClear}:
    {data:NativeChannels;selected:string;live:string[];connected:boolean;busy:boolean;board:string;link:string;
      onSelect(value:string):void;onEnabled(value:boolean):Promise<void>;onSignature(c:NativeChannel,value:boolean):Promise<void>;onSend(c:NativeChannel,text:string):Promise<void>;onSettings():void;onBack():void;onClear(c:NativeChannel):Promise<void>}=$props();
  const token=(c:NativeChannel)=>`${c.node}:${c.key}`;
  const current=$derived(data.channels.find(c=>token(c)===selected)??data.channels.find(c=>live.includes(token(c)))??data.channels[0]);
  let draft=$state(''),error=$state(''),working=$state(false),clear=$state(false),history=$state<HTMLDivElement>(),nearBottom=$state(true);
  let optionsOpen=$state(false);
  const composed=$derived.by(()=>{try{return channelText(draft,current?.signature??false,link);}catch{return '';}});
  const bytes=$derived(new TextEncoder().encode(draft.trim()+(current?.signature?`\n${channelSignature(link)}`:'')).length);
  const available=$derived(connected&&!!current&&live.includes(token(current))&&data.enabled);
  $effect(()=>{const key=current?token(current):'';void key;untrack(()=>{draft='';error='';clear=false;optionsOpen=false;nearBottom=true;});});
  $effect(()=>{const key=current?token(current):'',count=current?.messages.length;void key;void count;untrack(()=>{if(nearBottom)void tick().then(()=>{history?.scrollTo({top:history.scrollHeight});});});});
  async function action(work:()=>Promise<void>){working=true;error='';try{await work();}catch(e){error=e instanceof Error?e.message:'Не удалось выполнить действие.';}finally{working=false;}}
  async function send(){if(optionsOpen||!current||!available||!composed||working||busy)return;const c=current,text=draft;await action(async()=>{await onSend(c,text);draft='';nearBottom=true;});}
  function optionsDialog(node:HTMLDialogElement){node.showModal();return{destroy(){node.close();}};}
  function sendPress(node:HTMLButtonElement){
    let timer:ReturnType<typeof setTimeout>|undefined,held=false,x=0,y=0;
    const stop=()=>{clearTimeout(timer);timer=undefined;};
    const down=(event:PointerEvent)=>{if(event.button!==0||node.disabled)return;stop();held=false;x=event.clientX;y=event.clientY;timer=setTimeout(()=>{held=true;optionsOpen=true;},500);};
    const move=(event:PointerEvent)=>{if(Math.hypot(event.clientX-x,event.clientY-y)>10)stop();};
    const cancel=()=>{stop();held=false;};
    const click=(event:MouseEvent)=>{stop();if(held){held=false;event.preventDefault();event.stopImmediatePropagation();}};
    node.addEventListener('pointerdown',down);window.addEventListener('pointermove',move);window.addEventListener('pointerup',stop);window.addEventListener('pointercancel',cancel);window.addEventListener('blur',cancel);node.addEventListener('click',click,true);
    return{destroy(){stop();node.removeEventListener('pointerdown',down);window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',stop);window.removeEventListener('pointercancel',cancel);window.removeEventListener('blur',cancel);node.removeEventListener('click',click,true);}};
  }
  const label=(status:string)=>status==='mesh'?'Доставлено в сеть':status==='accepted'?'Передано плате':status==='queued'?'Отправляем…':status==='failed'?'Доставка в сеть не подтверждена':'Нет подтверждения платы';
</script>
<div class="native-channels">
  <header><button class="icon" onclick={onBack} aria-label={$i18n.text('Все чаты')}>←</button><div><strong>Meshtastic</strong><small><RadioBoardName name={board||$i18n.text('Радиомодуль отключён')}/></small></div><button class="icon" onclick={onSettings} aria-label={$i18n.text('Настройки LoRa')}><ChatIcon name="radio"/></button></header>
  <div class="toolbar"><label class="check"><input type="checkbox" checked={data.enabled} disabled={working||busy} onchange={e=>void action(()=>onEnabled(e.currentTarget.checked))}/>{$i18n.text('Принимать каналы Meshtastic')}</label>
    <HelpInfo label={$i18n.text('О каналах Meshtastic')} text={$i18n.text('Сообщения отправляются от имени платы. Это обычные каналы Meshtastic, без подписей аккаунтов Automesh. Общедоступный ключ не обеспечивает приватность. История хранится зашифрованной в этом профиле: последние 100 сообщений на канал. Приём канала можно выключить. Подтверждение вашей платы не означает получение всеми участниками. MQTT и пересылки не включаются.')} />
    <HelpInfo label={$i18n.text('Статусы отправки Meshtastic')} text={$i18n.text('Передано плате — плата приняла сообщение в очередь. Доставлено в сеть — прошивка подтвердила ретрансляцию соседним узлом. Это не подтверждение всех участников и не прочтение. Ошибки показываются по ответам платы. Повторы в эфире выполняет сама прошивка; приложение не рассылает сообщение повторно автоматически.')} />
  </div>
  {#if current}<select aria-label={$i18n.text('Канал Meshtastic')} value={token(current)} onchange={e=>onSelect(e.currentTarget.value)}>{#each data.channels as c (token(c))}<option value={token(c)}>{c.name||$i18n.text('По умолчанию')} · !{c.node.toString(16).padStart(8,'0')}{c.unread?` (${c.unread})`:''}</option>{/each}</select>
    <div class="channel-info"><small>{$i18n.text(current.public?'Общедоступный канал':'Канал с собственным ключом')} · {$i18n.text('Отправитель — плата Meshtastic')}</small><button disabled={working||!current.messages.length} onclick={()=>clear=!clear}>{$i18n.text('Очистить историю')}</button></div>
    {#if clear}<div class="toolbar"><small>{$i18n.text('Удалить историю этого радиоканала только из приложения?')}</small><button onclick={()=>void action(async()=>{await onClear(current!);clear=false;})}>{$i18n.text('Удалить')}</button><button onclick={()=>clear=false}>{$i18n.text('Отмена')}</button></div>{/if}
  {/if}
  <div class="history" bind:this={history} onscroll={()=>{if(history)nearBottom=history.scrollHeight-history.scrollTop-history.clientHeight<90;}}>
    {#if current}{#each current.messages as m (`${m.from}:${m.id}`)}<article class:own={m.outgoing}><small><strong><RadioBoardName name={m.name||`!${m.from.toString(16).padStart(8,'0')}`}/></strong> · !{m.from.toString(16).padStart(8,'0')} · {new Date(m.timestamp).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</small><p><MessageText text={m.text} markdownLinks/></p>{#if m.reception&&!m.outgoing}<RadioReception reception={m.reception}/>{/if}{#if m.outgoing}<small class="status" class:success={m.status==='mesh'} class:danger={m.status==='failed'}>{$i18n.text(label(m.status))}</small>{#if m.failure}<small class="failure">{$i18n.text(channelFailureLabel(m.failure))}</small>{/if}{/if}</article>{:else}<p class="empty">{$i18n.text('В этом радиоканале пока нет сообщений.')}</p>{/each}
    {:else}<p class="empty">{$i18n.text('Подключите плату: здесь появятся настроенные каналы Meshtastic.')}</p>{/if}
  </div>
  {#if error}<p class="error" role="alert">{$i18n.system(error)}</p>{/if}
  <form onsubmit={e=>{e.preventDefault();void send();}}><textarea bind:value={draft} maxlength="600" disabled={!available||working||busy} aria-label={$i18n.text('Сообщение в канал Meshtastic')} placeholder={$i18n.text('Короткое сообщение от имени платы')} onkeydown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();void send();}}}></textarea><button type="button" class="icon primary" class:send-unavailable={!available||!composed} use:sendPress onclick={()=>void send()} oncontextmenu={e=>{e.preventDefault();if(current&&!working&&!busy)optionsOpen=true;}} disabled={!current||working||busy} aria-label={$i18n.text('Отправить')} aria-haspopup="dialog" aria-expanded={optionsOpen} title={$i18n.text('Удерживайте кнопку для настроек отправки')}><ChatIcon name="send"/></button></form>
  <small class:danger={bytes>CHANNEL_TEXT_BYTES}>{bytes}/{CHANNEL_TEXT_BYTES} {$i18n.text('байт')} · {$i18n.text('Без автоматических повторов')}</small>
  {#if optionsOpen&&current}
    <dialog use:optionsDialog aria-labelledby="meshtastic-send-options" oncancel={e=>{e.preventDefault();if(!working)optionsOpen=false;}}>
      <header><h3 id="meshtastic-send-options">{$i18n.text('Настройки отправки')}</h3><button class="icon" disabled={working} onclick={()=>optionsOpen=false} aria-label={$i18n.text('Закрыть настройки отправки')}>✕</button></header>
      <label class="check"><input type="checkbox" checked={current.signature} disabled={working||busy} onchange={e=>void action(()=>onSignature(current!,e.currentTarget.checked))}/>{$i18n.text('Добавлять мой контакт Automesh')}</label>
      {#if current.signature}<p class="signature-preview"><MessageText text={channelSignature(link)} markdownLinks/></p>{/if}
      <p class="options-hint">{$i18n.text('Ссылка будет видна всем читателям канала и входит в лимит сообщения.')}</p>
      <small class:danger={bytes>CHANNEL_TEXT_BYTES}>{bytes}/{CHANNEL_TEXT_BYTES} {$i18n.text('байт')}</small>
      {#if error}<p class="error" role="alert">{$i18n.system(error)}</p>{/if}
      <footer><button disabled={working} onclick={()=>optionsOpen=false}>{$i18n.text('Готово')}</button></footer>
    </dialog>
  {/if}
</div>
<style>
 dialog{width:min(400px,calc(100vw - 24px));max-height:85dvh;overflow:auto}dialog header{justify-content:space-between}dialog h3{font-size:17px;margin:0}dialog .check{margin:18px 0}.options-hint{font-size:12px;color:var(--muted);line-height:1.5}dialog footer{display:flex;justify-content:flex-end;margin-top:14px}.send-unavailable{opacity:.55}
 .native-channels{height:100%;min-height:0;display:flex;flex-direction:column;gap:8px;padding:0 2px}header{display:flex;align-items:center;gap:10px}header div{min-width:0;flex:1}header small{display:block;color:var(--muted);overflow-wrap:anywhere}.icon{display:inline-grid;place-items:center;width:44px;height:44px;min-width:44px;padding:6px}.toolbar,.channel-info{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.toolbar .check{flex:1}.check{display:flex;gap:8px;align-items:center;font-size:13px;min-height:32px}select{width:100%;min-width:0;font-size:13px}.channel-info small{flex:1}.channel-info button{font-size:12px;min-height:32px}.history{flex:1;overflow:auto;min-height:100px;border:1px solid var(--line);border-radius:12px;padding:10px;background:var(--surface-alt);display:flex;flex-direction:column;gap:8px}article{max-width:90%;align-self:flex-start;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--surface);overflow-wrap:anywhere}article.own{align-self:flex-end;background:var(--outgoing)}p{margin:8px 0}small{font-size:11px;color:var(--muted)}.status{display:block;text-align:right;color:var(--warning)}.success{color:var(--success)}.danger,.error{color:var(--danger)}.empty{color:var(--muted);font-size:13px}.signature-preview{overflow-wrap:anywhere;max-height:54px;overflow:auto}form{display:flex;gap:6px;align-items:flex-end}textarea{resize:vertical;min-height:44px;max-height:120px;width:100%;min-width:0;font-family:inherit;font-size:14px}button{font-size:13px}.error{font-size:12px;margin:0}
</style>
