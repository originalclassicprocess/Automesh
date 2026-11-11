<script lang="ts">
  import { onMount } from 'svelte';
  import { setLanguage } from '$lib/i18n/language';
  import ThemeSelector from '$lib/application/ThemeSelector.svelte';
  import StoragePanel from '$lib/application/StoragePanel.svelte';
  import AccountNotices from '$lib/application/AccountNotices.svelte';
  import ProfileLinks from '$lib/chat/ProfileLinks.svelte';
  import { type ManagedFile, type ChatStorageUsage } from '$lib/application/storage-summary';
  import type {ProfileLink} from '$lib/chat/profile-links';
  onMount(()=>setLanguage('ru'));
  let narrow=$state(false);
  let backup=$state(true),devices=$state(true),tab=$state('storage'),note=$state(''),confirmation=$state<{kind:string;ids:string[]}|null>(null);
  let links=$state<ProfileLink[]>([{label:'Наш сайт',url:'https://example.com/'},{label:'Сообщество',url:'https://example.org/community'}]);
  let files=$state<ManagedFile[]>(Array.from({length:17},(_,i)=>({id:`chat-${i%3}:${i}`,peer:`chat-${i%3}`,messageId:String(i),name:['Поездка.jpg','Встреча.mp4','Голосовое.ogg','Документ.pdf'][i%4],category:(['image','video','audio','other'] as const)[i%4],bytes:(i+1)*145879,memoryBytes:i%3===0?100000:0,timestamp:new Date(2026,10,11-i,14).getTime()})));
  const name=(peer:string)=>({'chat-0':'Сохранённые','chat-1':'Александра','chat-2':'Поход'}[peer]??peer);
  let chats=$derived(['chat-0','chat-1','chat-2'].map(peer=>({peer,bytes:files.filter(f=>f.peer===peer).reduce((n,f)=>n+f.bytes,0),files:files.filter(f=>f.peer===peer).length,historyBytes:12000,messages:48})) satisfies ChatStorageUsage[]);
  let urls=$derived(Object.fromEntries(files.filter(f=>f.category==='image').map(f=>[f.id,'/icon-192.png'])));
</script>
<svelte:head><title>Локальный обзор изменений</title></svelte:head>
<div class="review" class:narrow><p>Локальный обзор настоящих компонентов · демонстрационные данные</p><ThemeSelector /><button onclick={()=>setLanguage('ru')}>Русский</button> <button onclick={()=>setLanguage('en')}>English</button><label><input type="checkbox" bind:checked={narrow} /> Узкий экран</label>
  <AccountNotices {backup} {devices} openBackup={()=>note='В приложении откроются резервные копии.'} openDevices={()=>note='В приложении откроется подключение устройств.'} dismiss={kind=>{if(kind==='backup')backup=false;else devices=false;}} />
  <nav><button onclick={()=>tab='storage'}>Хранилище</button><button onclick={()=>tab='profile'}>Ссылки профиля</button><a href="/">Открыть приложение</a></nav>
  <section class="account-shell">{#if tab==='storage'}<StoragePanel {files} {chats} {name} {urls} historyBytes={48500} otherBytes={0} cacheBytes={4200000} volatile={false} busy={false} error="" refresh={()=>note='Размеры обновлены.'} clean={(kind,ids)=>confirmation={kind,ids}} download={()=>note='Пример без настоящих файлов.'} openChat={peer=>note=`Перейти в чат: ${name(peer)}`} />{:else}<ProfileLinks {links} onSave={async value=>{links=value;return true;}} />{/if}</section>
  {#if confirmation}<dialog open><p>{confirmation.kind}</p><p>Удалить выбранные демонстрационные файлы?</p><button onclick={()=>{files=confirmation!.kind==='history'?[]:files.filter(f=>!confirmation!.ids.includes(f.id));confirmation=null;}}>Удалить</button><button onclick={()=>confirmation=null}>Отмена</button></dialog>{/if}
  {#if note}<p role="status">{note}</p>{/if}
</div>
<style>.review{width:100%;max-width:1000px;margin:auto}.review.narrow{max-width:390px}.review>p{font-size:13px;color:var(--muted)}nav{display:flex;gap:10px;align-items:center;margin:16px 0;flex-wrap:wrap}.account-shell{margin-bottom:20px}dialog[open]{position:fixed;inset:0;margin:auto;z-index:100;box-shadow:0 0 0 100vmax #0008;max-width:90vw}dialog p{font-size:14px}</style>
