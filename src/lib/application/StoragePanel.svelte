<script lang="ts">
  import { locale } from '$lib/i18n/language';
  import { tr as i18n } from '$lib/i18n/language';
  import { categoryNames, fileBytes, filterStoredFiles, formatBytes, type ManagedFile, type ChatStorageUsage } from './storage-summary';
  import HelpInfo from './HelpInfo.svelte';
  import StorageFilePreview from './StorageFilePreview.svelte';
  import ChoiceMenu from './ChoiceMenu.svelte';
  let { files, historyBytes, otherBytes, cacheBytes, originUsage, quota, volatile, busy, error,
    refresh, clean, download, chats = [], name = peer => peer, openChat, urls = {}, loadPreview }: {
    files: ManagedFile[]; historyBytes: number; otherBytes: number; cacheBytes: number;
    originUsage?: number; quota?: number; volatile: boolean; busy: boolean; error: string;
    refresh: () => void; clean: (kind: string, ids: string[]) => void; download: (peer: string, id: string) => void;
    chats?: ChatStorageUsage[]; name?: (peer: string) => string; openChat?: (peer: string) => void;
    urls?: Record<string,string>; loadPreview?: (file:ManagedFile)=>Promise<Blob|null>;
  } = $props();
  let category = $state('all'), query = $state(''), from = $state(''), to = $state(''), sort = $state('size');
  let peer = $state<string | null>(null), selected = $state<string[]>([]), limit = $state(36), allChats = $state(false);
  let shown = $derived(filterStoredFiles(files, {category, query, from, to, sort, peer}));
  let visible = $derived(shown.slice(0, limit));
  let selectedFiles = $derived(files.filter(file => selected.includes(file.id)));
  let attachmentBytes = $derived(files.reduce((sum,file) => sum + fileBytes(file),0));
  let total = $derived(historyBytes + files.reduce((sum,file) => sum + file.bytes,0));
  const colors: Record<string,string> = {image:'#59bcb2',video:'#8e9ae6',audio:'#d8ac53',other:'#ac89bc'};
  let groups = $derived(Object.entries(categoryNames).map(([kind,label]) => ({kind,label,
    files:files.filter(file=>file.category===kind), bytes:files.filter(file=>file.category===kind).reduce((sum,file)=>sum+fileBytes(file),0)})));
  let wheel = $derived.by(() => {
    if (!attachmentBytes) return 'var(--line)';
    let start = 0;
    return `conic-gradient(${groups.map(group => {const end=start+group.bytes/attachmentBytes*100;const part=`${colors[group.kind]} ${start}% ${end}%`;start=end;return part;}).join(',')})`;
  });
  // Cancellation and failed deletion preserve selection; refreshed inventory removes only deleted IDs.
  $effect(() => {const existing=new Set(files.map(file=>file.id));if(selected.some(id=>!existing.has(id)))selected=selected.filter(id=>existing.has(id));});
  function toggle(id:string) {selected=selected.includes(id)?selected.filter(value=>value!==id):[...selected,id];}
  function changeCategory(value:string) {category=value;limit=36;}
  function reset() {category='all';query='';from='';to='';peer=null;limit=36;}
  function showChat(value:string) {peer=value;category='all';query='';from='';to='';limit=36;}
  function selectShown() {selected=[...new Set([...selected,...shown.map(file=>file.id)])];}
  function date(timestamp?:number) {return timestamp ? new Date(timestamp).toLocaleDateString($locale) : $i18n.text('Дата неизвестна');}
</script>
<section class="storage-panel" aria-label={$i18n.text('Менеджер памяти')}>
  <div class="heading"><h4>{$i18n.text('Хранилище')}</h4><HelpInfo label={$i18n.text('Справка: хранилище приложения')} text={$i18n.text('Это локальные данные текущего аккаунта в этом браузере, не очередь ноды. Очистка не удаляет копии у собеседников. Вложения на диске и в памяти не суммируются дважды. Размер переписки по чатам приблизительный.')} /><button class="refresh" onclick={refresh} disabled={busy}>{busy?$i18n.text('Подождите…'):$i18n.text('Обновить')}</button></div>
  <div class="overview">
    <div class="chart"><div class="wheel" style:background={wheel} role="img" aria-label={$i18n.text('Распределение вложений по типам')}><div><strong>{$i18n.system(formatBytes(attachmentBytes))}</strong><small>{$i18n.text('Вложения')}</small></div></div>
      <div class="legend">{#each groups as group}<button aria-pressed={category===group.kind} onclick={()=>changeCategory(category===group.kind?'all':group.kind)}><span class="dot" style:background={colors[group.kind]}></span><span>{$i18n.text(group.label)} <small>{group.files.length}</small></span><strong>{$i18n.system(formatBytes(group.bytes))}</strong></button>{/each}</div></div>
    <div class="totals"><div><small>{$i18n.text('Переписка и вложения на диске')}</small><strong>{$i18n.system(formatBytes(total))}</strong></div><div><small>{$i18n.text('Кэш приложения')}</small><strong>{$i18n.system(formatBytes(cacheBytes))}</strong></div></div>
  </div>
  {#if volatile}<p class="note">{$i18n.text('Недоверенный режим: новая переписка находится в памяти вкладки. Здесь также видны оставшиеся данные прошлых доверенных сеансов.')}</p>{/if}
  {#if error}<p role="alert">{$i18n.text(error)}</p>{/if}
  <details class="chats" open><summary>{$i18n.text('По чатам')}</summary>
    <div class="chat-list">{#each chats.slice(0,allChats?chats.length:6) as group (group.peer)}<button class:chosen={peer===group.peer} onclick={()=>showChat(group.peer)}><span class="chat-name">{group.peer?name(group.peer):$i18n.text('Файлы вне истории')}<small>{group.files} {$i18n.text('файлов')} · {group.messages} {$i18n.text('сообщений')}</small></span><span class="chat-size"><strong>{$i18n.system(formatBytes(group.bytes+group.historyBytes))}</strong><small>{group.historyBytes?$i18n.text('с учётом оценки переписки'):''} ›</small></span></button>{:else}<p class="note">{$i18n.text('Здесь пока нет данных.')}</p>{/each}</div>
    {#if chats.length>6}<button onclick={()=>allChats=!allChats}>{allChats?$i18n.text('Свернуть'):$i18n.text('Все чаты')}</button>{/if}
  </details>
  <div class="heading files-title"><h4>{peer===null?$i18n.text('Все файлы'):peer?name(peer):$i18n.text('Файлы вне истории')}</h4>{#if peer && openChat}<button onclick={()=>openChat?.(peer!)}>{$i18n.text('Открыть чат')}</button>{/if}{#if peer!==null}<button onclick={()=>peer=null}>{$i18n.text('Все чаты')}</button>{/if}</div>
  <div class="filters"><label class="search"><span>{$i18n.text('Поиск по имени файла')}</span><input type="search" bind:value={query} oninput={()=>limit=36} placeholder={$i18n.text('Название файла')} /></label>
    <label><span>{$i18n.text('С даты')}</span><input type="date" bind:value={from} onchange={()=>limit=36} /></label><label><span>{$i18n.text('По дату')}</span><input type="date" bind:value={to} min={from || undefined} onchange={()=>limit=36} /></label>
    <ChoiceMenu value={category} label={$i18n.text('Тип файлов')} options={[{value:'all',label:$i18n.text('Все файлы')},...Object.entries(categoryNames).map(([value,label])=>({value,label:$i18n.text(label)}))]} onChange={changeCategory}/>
    <ChoiceMenu value={sort} label={$i18n.text('Порядок файлов')} options={[{value:'size',label:$i18n.text('Сначала большие')},{value:'date',label:$i18n.text('Сначала новые')}]} onChange={value=>{sort=value;limit=36;}}/>
    {#if category!=='all'||query||from||to||peer!==null}<button onclick={reset}>{$i18n.text('Сбросить фильтры')}</button>{/if}
  </div>
  {#if from || to}<p class="note">{$i18n.text('Даты относятся к сообщениям. Файлы с неизвестной датой не включаются в выборку.')}</p>{/if}
  <div class="selection"><span>{shown.length} {$i18n.text('файлов')} · {$i18n.system(formatBytes(shown.reduce((sum,file)=>sum+fileBytes(file),0)))}</span><button onclick={selectShown} disabled={busy||!shown.length}>{$i18n.text('Выбрать найденные')}</button>
    {#if selectedFiles.length}<button onclick={()=>selected=[]} disabled={busy}>{$i18n.text('Снять выбор')}</button><button class="danger" disabled={busy} onclick={()=>clean($i18n.text('Выбранные файлы'),selectedFiles.map(file=>file.id))}>{$i18n.text('Удалить выбранные')} · {selectedFiles.length} · {$i18n.system(formatBytes(selectedFiles.reduce((sum,file)=>sum+fileBytes(file),0)))}</button>{/if}
    {#if (from||to) && !selectedFiles.length}<button class="danger" disabled={busy||!shown.length} onclick={()=>clean($i18n.text('Файлы за выбранные даты'),shown.map(file=>file.id))}>{$i18n.text('Удалить за период')}</button>{/if}
  </div>
  <div class="file-grid">{#each visible as file (file.id)}{@const key=`${file.peer}:${file.messageId}`}
    <article class:selected={selected.includes(file.id)}><label class="file-choice"><input type="checkbox" checked={selected.includes(file.id)} disabled={busy} onchange={()=>toggle(file.id)} aria-label={`${$i18n.text('Выбрать файл')}: ${file.name}`} />
      <StorageFilePreview {file} imageUrl={urls[key]} load={loadPreview} /><strong class="filename" title={file.name}>{file.name}</strong></label>
      <small>{$i18n.system(formatBytes(fileBytes(file)))} · {date(file.timestamp)}</small><small class="peer-name">{file.peer?name(file.peer):$i18n.text('Файл вне истории')}</small>
      <div class="file-actions">{#if file.peer}<button disabled={busy} onclick={()=>download(file.peer,file.messageId)}>{$i18n.text('Скачать')}</button>{/if}<button disabled={busy} onclick={()=>clean(file.name,[file.id])}>{$i18n.text('Удалить')}</button></div>
    </article>{:else}<p class="note">{$i18n.text('По этим условиям файлов нет.')}</p>{/each}
  </div>
  {#if shown.length>limit}<button class="more" onclick={()=>limit+=36}>{$i18n.text('Показать ещё')}</button>{/if}
  <details class="advanced"><summary>{$i18n.text('Дополнительно')}</summary>
    {#if originUsage!==undefined}<p class="note">{$i18n.text('Занято этим сайтом в браузере')}: {$i18n.system(formatBytes(originUsage))}{#if quota} / {$i18n.system(formatBytes(quota))}{/if}</p>{/if}
    {#if otherBytes>0}<p class="note">{$i18n.text('Другие аккаунты на этом сайте')}: {$i18n.system(formatBytes(otherBytes))}</p>{/if}
    <p class="note">{$i18n.text('Очистка касается только этого аккаунта. Seed, контакты и настройки сохранятся. Копии в папке загрузок, на нодах и у собеседников остаются.')}</p><button class="danger" onclick={()=>clean('history',[])} disabled={busy}>{$i18n.text('Удалить переписку и вложения')}</button>
  </details>
</section>
<style>
  .storage-panel{container-type:inline-size;font-size:14px;max-width:1000px;margin:auto;min-width:0}.heading{display:flex;align-items:center;gap:8px;flex-wrap:wrap}h4{margin:0;font-size:16px}.refresh{margin-left:auto}.overview{display:grid;gap:14px;margin:16px 0}.chart{display:flex;align-items:center;gap:20px;flex-wrap:wrap;padding:16px;background:var(--surface-alt);border:1px solid var(--line);border-radius:14px}
  .wheel{width:154px;height:154px;border-radius:50%;display:grid;place-items:center;flex-shrink:0}.wheel>div{width:114px;height:114px;border-radius:50%;background:var(--surface-alt);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px}.wheel strong{font-size:18px}.legend{flex:1;min-width:180px;display:grid;gap:4px}.legend button{display:flex;align-items:center;gap:8px;border-color:transparent;text-align:left}.legend strong{margin-left:auto}.dot{width:9px;height:9px;border-radius:50%;flex-shrink:0}
  .totals{display:flex;gap:12px;flex-wrap:wrap}.totals>div{flex:1;min-width:150px;padding:12px;border:1px solid var(--line);border-radius:12px}.totals strong{display:block;margin-top:4px;font-size:18px}small,.note{font-size:12px;color:var(--muted)}
  details{margin:16px 0;border:1px solid var(--line);border-radius:12px;padding:12px}summary{font-weight:600;cursor:pointer}.chat-list{display:grid;margin-top:8px}.chat-list button{display:flex;align-items:center;gap:12px;padding:10px;border:0;border-bottom:1px solid var(--line);border-radius:0;text-align:left}.chat-name{flex:1;min-width:0;overflow-wrap:anywhere}.chat-name small,.chat-size small{display:block;margin-top:3px}.chat-size{text-align:right}.chosen{background:var(--accent-soft)}
  .files-title{margin:22px 0 12px}.filters{display:flex;align-items:end;flex-wrap:wrap;gap:10px}.filters label{display:grid;gap:4px;min-width:0;flex:1 1 130px}.filters .search{flex-basis:100%}.filters label span{font-size:12px;color:var(--muted)}input{min-width:0;box-sizing:border-box;width:100%;font:inherit}.selection{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:14px 0}.selection>span{color:var(--muted);font-size:12px;margin-right:auto}
  .filters :global(.choice-menu){flex:1 1 160px;width:auto;min-width:0}
  .file-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}.file-grid article{min-width:0;padding:9px;border:1px solid var(--line);border-radius:12px}.file-grid article.selected{outline:2px solid var(--accent)}.file-choice{display:block;position:relative;cursor:pointer}.file-choice input{position:absolute;z-index:1;left:6px;top:6px;width:20px;height:20px;margin:0;accent-color:var(--accent)}.filename{font-size:13px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:8px 0 4px}.peer-name{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:4px}.file-actions{display:flex;gap:6px;margin-top:9px;flex-wrap:wrap}.file-actions button{flex:1;font-size:12px;padding:5px 8px}.more{display:block;margin:16px auto}.danger{color:var(--danger,#ba4152)}.storage-panel button{font-size:13px;min-height:34px}.advanced{margin-top:24px}
  @container(min-width:720px){.overview{grid-template-columns:minmax(0,2fr) minmax(150px,1fr)}.totals{flex-direction:column}.filters .search{flex-basis:200px}}
  @media(pointer:coarse){.storage-panel button{min-height:44px}.filters input{font-size:16px}}
</style>
