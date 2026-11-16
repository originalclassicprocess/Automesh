<script lang="ts">
  import {tr as i18n} from '$lib/i18n/language';
  let {muted,until=0,onChange,disabled=false}:{muted:boolean;until?:number;disabled?:boolean;onChange:(duration:number)=>Promise<boolean>}=$props();
  let open=$state(false),busy=$state(false),notice=$state('');
  const options=[{duration:3600000,label:'На 1 час'},{duration:28800000,label:'На 8 часов'},{duration:86400000,label:'На сутки'},{duration:-1,label:'Навсегда'}];
  async function change(duration:number){busy=true;notice='';try{const synced=await onChange(duration);open=false;if(!synced)notice='Сохранено локально. Для закрытого браузера настройка применится после подключения к провайдеру.';}catch{notice='Не удалось сохранить настройку уведомлений.';}finally{busy=false;}}
</script>
<div class="chat-notifications">
  <details bind:open><summary aria-label={$i18n.text(muted?'Уведомления чата отключены':'Уведомления чата')} title={$i18n.text(muted?'Уведомления чата отключены':'Уведомления чата')}>
    <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>{#if muted}<path d="m3 3 18 18"/>{/if}</svg>
  </summary>
  <div class="options">
    <strong>{$i18n.text('Уведомления чата')}</strong>
    {#if muted}<small>{$i18n.text(until===-1?'Отключены навсегда':'Временно отключены')}</small><button disabled={busy||disabled} onclick={()=>void change(0)}>{$i18n.text('Включить уведомления чата')}</button>{/if}
    {#each options as option}<button disabled={busy||disabled} onclick={()=>void change(option.duration)}>{$i18n.text(option.label)}</button>{/each}
    <small>{$i18n.text('Только этот профиль на этом устройстве. Сообщения продолжат поступать.')}</small>
  </div>
  </details>
  {#if notice}<p role="status">{$i18n.text(notice)}</p>{/if}
</div>
<style>.chat-notifications{position:relative;flex:0 0 auto}summary{display:grid;place-items:center;width:36px;height:36px;cursor:pointer;list-style:none;border:1px solid var(--line);border-radius:12px}summary::-webkit-details-marker{display:none}.options{position:absolute;z-index:30;right:0;top:42px;width:min(250px,75vw);padding:12px;background:var(--surface);border:1px solid var(--line);border-radius:14px;box-shadow:0 8px 24px var(--shadow-color)}strong,small{display:block}small{font-size:12px;color:var(--muted);margin:6px 0}.options button{display:block;width:100%;min-height:40px;text-align:left;margin:4px 0}p{position:absolute;right:0;width:min(270px,75vw);z-index:31;background:var(--surface);border:1px solid var(--line);padding:12px;border-radius:12px;font-size:12px}</style>
