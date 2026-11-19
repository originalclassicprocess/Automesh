<script lang="ts">
 import{tr as i18n}from'$lib/i18n/language';
 let{text,onSave,onClose}:{text:string;onSave:(text:string)=>Promise<void>;onClose:()=>void}=$props();
 let draft=$state(''),busy=$state(false),error=$state('');
 function mount(node:HTMLDialogElement){draft=text;const previous=document.activeElement as HTMLElement|null;node.showModal();return{destroy(){node.close();if(previous?.isConnected)previous.focus({preventScroll:true});}};}
 async function save(){if(busy||!draft.trim())return;busy=true;error='';try{await onSave(draft.trim());onClose();}catch(e){error=e instanceof Error&&e.message==='message_edit_changed'?'Сообщение уже изменилось. Закройте редактор и откройте его ещё раз.':e instanceof Error&&e.message==='message_too_large'?'Текст слишком длинный. Сократите его перед сохранением.':'Не удалось сохранить изменение. Текст остался в редакторе.';}finally{busy=false;}}
</script>
<dialog use:mount aria-label={$i18n.text('Изменить текст')} oncancel={event=>{event.preventDefault();if(!busy)onClose();}}>
 <form onsubmit={event=>{event.preventDefault();void save();}}><header><strong>{$i18n.text('Изменить текст')}</strong><button type="button" disabled={busy} onclick={onClose} aria-label={$i18n.text('Закрыть')}>×</button></header>
 <textarea rows="5" bind:value={draft} aria-label={$i18n.text('Текст сообщения')} disabled={busy}></textarea>
 <small>{$i18n.text('Собеседник увидит правку после её доставки.')}</small>
 {#if error}<p role="alert">{$i18n.text(error)}</p>{/if}<footer><button type="button" disabled={busy} onclick={onClose}>{$i18n.text('Отмена')}</button><button type="submit" class="primary" disabled={busy||!draft.trim()||draft.trim()===text}>{$i18n.text('Сохранить')}</button></footer></form>
</dialog>
<style>dialog{width:min(480px,calc(100vw - 24px))}header,footer{display:flex;align-items:center;gap:8px;justify-content:space-between}textarea{display:block;width:100%;min-height:110px;margin:12px 0;resize:vertical}small{font-size:12px;color:var(--muted)}footer{justify-content:flex-end;margin-top:12px}p{color:var(--danger);font-size:13px}header button{padding:4px 10px}</style>
