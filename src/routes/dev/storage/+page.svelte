<script lang="ts">
  import { onMount } from 'svelte';
  import { setLanguage } from '$lib/i18n/language';
  import ThemeSelector from '$lib/application/ThemeSelector.svelte';
  import StoragePanel from '$lib/application/StoragePanel.svelte';
  import AccountNotices from '$lib/application/AccountNotices.svelte';
  import ProfileLinks from '$lib/chat/ProfileLinks.svelte';
  import type { ManagedFile, ChatStorageUsage, StorageCleanup, StorageOverview } from '$lib/application/storage-summary';
  import type {ProfileLink} from '$lib/chat/profile-links';
  onMount(()=>setLanguage('ru'));
  let narrow=$state(false);
  let backup=$state(true),devices=$state(true),tab=$state('storage'),note=$state(''),confirmation=$state<StorageCleanup|null>(null);
  let packCount=$state(3), historyBytes=$state(48500);
  const usage = $derived<StorageOverview>({app:{shell:220000,scripts:3800000,styles:180000,ai:9000000},
    modelBytes:104857600,history:historyBytes,other:150000,incomplete:false,media:{gifs:1400000,packs:packCount?6500000:0,shared:0,cached:120000}});
  let links=$state<ProfileLink[]>([{label:'Наш сайт',url:'https://example.com/'},{label:'Сообщество',url:'https://example.org/community'}]);
  let files=$state<ManagedFile[]>(Array.from({length:17},(_,i)=>({id:`chat-${i%3}:${i}`,peer:`chat-${i%3}`,messageId:String(i),name:['Поездка.jpg','Встреча.mp4','Голосовое.ogg','Документ.pdf'][i%4],category:(['image','video','audio','other'] as const)[i%4],bytes:(i+1)*145879,memoryBytes:i%3===0?100000:0,timestamp:new Date(2026,10,11-i,14).getTime()})));
  const name=(peer:string)=>({'chat-0':'Сохранённые','chat-1':'Александра','chat-2':'Поход'}[peer]??peer);
  let chats=$derived(['chat-0','chat-1','chat-2'].map(peer=>({peer,bytes:files.filter(f=>f.peer===peer).reduce((n,f)=>n+f.bytes,0),files:files.filter(f=>f.peer===peer).length,historyBytes:12000,messages:48})) satisfies ChatStorageUsage[]);
  let urls=$derived(Object.fromEntries(files.filter(f=>f.category==='image').map(f=>[f.id,'/icon-192.png'])));
  function cleanDemo() {
    const choice=confirmation;
    confirmation=null;
    if(!choice)return;
    if(choice.kind==='history')historyBytes=0;
    if(choice.kind==='sticker-packs')packCount=0;
    if(choice.kind==='all-files')files=[];
    if(choice.kind==='chat')files=files.filter(file=>file.peer!==choice.peer);
    if(choice.kind==='chat-files')files=files.filter(file=>!choice.peers.includes(file.peer));
    if(choice.kind==='files')files=files.filter(file=>!choice.ids.includes(file.id));
  }
</script>
<svelte:head><title>Локальный обзор изменений</title></svelte:head>
<div class="review" class:narrow><p>Локальный обзор настоящих компонентов · демонстрационные данные</p><ThemeSelector /><button onclick={()=>setLanguage('ru')}>Русский</button> <button onclick={()=>setLanguage('en')}>English</button><label><input type="checkbox" bind:checked={narrow} /> Узкий экран</label>
  <AccountNotices {backup} {devices} openBackup={()=>note='В приложении откроются резервные копии.'} openDevices={()=>note='В приложении откроется подключение устройств.'} dismiss={kind=>{if(kind==='backup')backup=false;else devices=false;}} />
  <nav><button onclick={()=>tab='storage'}>Хранилище</button><button onclick={()=>tab='profile'}>Ссылки профиля</button><a href="/">Открыть приложение</a></nav>
  <section class="account-shell">{#if tab==='storage'}<StoragePanel {files} {chats} {name} {urls} {usage} {packCount} gifCount={2} volatile={false} busy={false} error="" refresh={()=>note='Размеры обновлены.'} clean={choice=>{confirmation=choice;}} download={()=>note='Пример без настоящих файлов.'} openChat={peer=>note=`Перейти в чат: ${name(peer)}`} openProfiles={()=>note='В приложении откроются профили.'} />{:else}<ProfileLinks {links} onSave={async value=>{links=value;return true;}} />{/if}</section>
  {#if confirmation}<dialog open><p>{confirmation.kind}</p><p>Очистить выбранные демонстрационные данные?</p><button onclick={cleanDemo}>Удалить</button><button onclick={()=>confirmation=null}>Отмена</button></dialog>{/if}
  {#if note}<p role="status">{note}</p>{/if}
</div>
<style>.review{width:100%;max-width:1000px;margin:auto}.review.narrow{max-width:390px}.review>p{font-size:13px;color:var(--muted)}nav{display:flex;gap:10px;align-items:center;margin:16px 0;flex-wrap:wrap}.account-shell{margin-bottom:20px}dialog[open]{position:fixed;inset:0;margin:auto;z-index:100;box-shadow:0 0 0 100vmax #0008;max-width:90vw}dialog p{font-size:14px}</style>
