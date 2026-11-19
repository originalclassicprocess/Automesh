<script lang="ts">
 import {tr as i18n} from '$lib/i18n/language';
 import {REACTIONS} from './reactions';
 let {options=REACTIONS,selected='',onSelect,onClose}:{options?:readonly string[];selected?:string;onSelect(emoji:string):void;onClose():void}=$props();
 function mount(node:HTMLDialogElement){
  const previous=document.activeElement as HTMLElement|null;
  node.showModal();(node.querySelector<HTMLButtonElement>('[aria-pressed="true"]')??node.querySelector('button'))?.focus({preventScroll:true});
  return{destroy(){node.close();if(previous?.isConnected)previous.focus({preventScroll:true});}};
 }
 function outside(event:MouseEvent){const node=event.currentTarget as HTMLDialogElement,r=node.getBoundingClientRect();if(event.target===node&&(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom))onClose();}
 function keys(event:KeyboardEvent){
  const node=event.currentTarget as HTMLDialogElement,buttons=[...node.querySelectorAll<HTMLButtonElement>('button')],index=buttons.indexOf(event.target as HTMLButtonElement);
  if(index<0)return;const delta:Record<string,number>={ArrowLeft:-1,ArrowRight:1,ArrowUp:-6,ArrowDown:6};
  const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:event.key in delta?Math.max(0,Math.min(buttons.length-1,index+delta[event.key])):-1;
  if(next>=0){event.preventDefault();buttons[next]?.focus();}
 }
</script>
<dialog class="reaction-dialog" use:mount aria-label={$i18n.text('Реакция на сообщение')} oncancel={event=>{event.preventDefault();onClose();}} onclick={outside} onkeydown={keys}>
 <div class="reaction-grid">{#each options as emoji}<button type="button" aria-pressed={selected===emoji} aria-label={$i18n.text('Реакция на сообщение')+' '+emoji} onclick={()=>onSelect(emoji)}>{emoji}</button>{/each}</div>
</dialog>
<style>
 .reaction-dialog{width:min(312px,calc(100vw - 24px));max-height:80dvh;overflow:auto;box-sizing:border-box;padding:10px;border:1px solid var(--line-strong);border-radius:18px;background:var(--surface);color:var(--text)}
 .reaction-dialog::backdrop{background:var(--overlay)}
 .reaction-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:3px}
 button{display:grid;place-items:center;padding:0;border:0;background:transparent;border-radius:10px;min-width:0;height:44px;font-size:27px;line-height:1;font-family:'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif}
 button:hover,button[aria-pressed=true]{background:var(--accent-soft)}
</style>
