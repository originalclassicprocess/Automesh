<script lang="ts">
  import {tr as i18n} from '$lib/i18n/language';
  export type ForwardText={key:string;text:string;source:string};
  export type ForwardTarget={id:string;name:string;radio:boolean;signatureBytes?:number};
  let {messages,targets,onSend,onClose,onComplete}:{messages:ForwardText[];targets:ForwardTarget[];onSend(target:string,message:ForwardText):Promise<void>;onClose():void;onComplete():void}=$props();
  let chosen=$state(''),busy=$state(false),error=$state(''),completed=$state<string[]>([]),query=$state('');
  const target=$derived(targets.find(t=>t.id===chosen));
  const visible=$derived(targets.filter(t=>t.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())));
  const invalid=$derived(!target||messages.some(m=>target.radio&&new TextEncoder().encode(m.text).length+(target.signatureBytes??0)>200));
  function mount(node:HTMLDialogElement){const previous=document.activeElement as HTMLElement|null;node.showModal();return{destroy(){node.close();previous?.isConnected&&previous.focus();}};}
  async function send(){if(!target||invalid||busy)return;busy=true;error='';try{for(const m of messages){const key=`${chosen}:${m.key}`;if(completed.includes(key))continue;try{await onSend(chosen,m);}catch(e){if(e&&typeof e==='object'&&'nativeAttemptRecorded' in e){completed=[...completed,key];throw Error('Попытка сохранена в истории канала. Проверьте её статус; повтор доступен в меню сообщения.');}throw e;}completed=[...completed,key];}onComplete();}catch(e){error=e instanceof Error?e.message:'Не удалось выполнить действие.';}finally{busy=false;}}
</script>
<dialog use:mount aria-label={$i18n.text('Переслать в чаты')} oncancel={e=>{e.preventDefault();if(!busy)onClose();}}>
 <header><h3>{$i18n.text('Переслать')}</h3><button disabled={busy} onclick={onClose} aria-label={$i18n.text('Закрыть')}>✕</button></header>
 <input type="search" bind:value={query} disabled={busy} aria-label={$i18n.text('Поиск в списке')} placeholder={$i18n.text('Поиск')}/>
 <div class="targets">{#each visible as t (t.id)}<label><input type="radio" name="forward-text-target" value={t.id} bind:group={chosen} disabled={busy||completed.length>0}/><span>{t.name}<small>{t.radio?$i18n.text('Канал Meshtastic · видно участникам'):'Automesh'}</small></span></label>{/each}</div>
 <details open><summary>{$i18n.text('Предварительный просмотр')}</summary>{#each messages as m (m.key)}<div class="preview"><small>{m.source}</small><p>{m.text}</p>{#if target?.radio}<small class:danger={new TextEncoder().encode(m.text).length+(target.signatureBytes??0)>200}>{new TextEncoder().encode(m.text).length+(target.signatureBytes??0)}/200 {$i18n.text('байт')}</small>{/if}</div>{/each}</details>
 {#if target?.radio}<p>{$i18n.text('Отправка в радиоканал видна его участникам. Проверьте, что в тексте нет личных данных. Файлы по радио не пересылаются.')}</p>{/if}
 {#if invalid&&target}<p class="danger">{$i18n.text('Текст превышает лимит радиоканала. Скопируйте и сократите его перед отправкой.')}</p>{/if}
 {#if completed.length}<small>{$i18n.text('Уже переданные сообщения не отправятся повторно при продолжении.')}</small>{/if}
 {#if error}<p class="danger" role="alert">{$i18n.system(error)}</p>{/if}
 <footer><button disabled={busy||invalid} onclick={()=>void send()}>{busy?$i18n.text('Обрабатываем…'):$i18n.text('Переслать')}</button><button disabled={busy} onclick={onClose}>{$i18n.text('Отмена')}</button></footer>
</dialog>
<style>
 dialog{width:min(480px,calc(100vw - 24px));box-sizing:border-box;max-height:85dvh;overflow:auto}header,footer{display:flex;gap:8px;align-items:center;justify-content:space-between}h3{margin:0}header{margin-bottom:12px}input[type=search]{width:100%;box-sizing:border-box}.targets{max-height:24dvh;overflow:auto;margin:8px 0}.targets label{display:flex;gap:8px;align-items:center;min-height:44px;padding:6px}small{display:block;font-size:11px;color:var(--muted)}.preview{border-top:1px solid var(--line);padding:8px 0;white-space:pre-wrap;overflow-wrap:anywhere}.preview p{margin:6px 0}.danger{color:var(--danger)}details{max-height:26dvh;overflow:auto}summary{cursor:pointer;list-style:none}summary::before{content:'＋';color:var(--accent);margin-right:6px}details[open]>summary::before{content:'−'}summary::-webkit-details-marker{display:none}p{font-size:13px;line-height:1.5}button{min-height:40px}footer{justify-content:flex-end;margin-top:12px}
</style>
