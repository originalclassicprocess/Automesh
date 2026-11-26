<script lang="ts">
  import { locale } from '$lib/i18n/language';
  import { tr as i18n } from '$lib/i18n/language';
  import { categoryNames, fileBytes, filterStoredFiles, formatBytes, storageBreakdown, sumBytes,
    type ManagedFile, type ChatStorageUsage, type LocalTranscriptStorage, type StorageCleanup, type StorageOverview } from './storage-summary';
  import HelpInfo from './HelpInfo.svelte';
  import StorageFilePreview from './StorageFilePreview.svelte';
  import ChoiceMenu from './ChoiceMenu.svelte';
  import type { Snippet } from 'svelte';
  let { files, usage, volatile, busy, error, packCount, gifCount,
    refresh, clean, download, openLibrary, openProfiles, chats = [], localChats = [], name = peer => peer, openChat, canClearChat, urls = {}, loadPreview, modelStorage }: {
    files: ManagedFile[]; usage: StorageOverview | null; volatile: boolean; busy: boolean; error: string;
    packCount: number; gifCount: number; openLibrary?: () => void; openProfiles: () => void;
    refresh: () => void; clean: (choice: StorageCleanup) => void; download: (peer: string, id: string) => void;
    chats?: ChatStorageUsage[]; localChats?: LocalTranscriptStorage[]; name?: (peer: string) => string; openChat?: (peer: string) => void;
    canClearChat?: (peer: string) => boolean;
    urls?: Record<string,string>; loadPreview?: (file:ManagedFile)=>Promise<Blob|null>;
    modelStorage?: Snippet;
  } = $props();
  let category = $state('all'), query = $state(''), from = $state(''), to = $state(''), sort = $state('size');
  let peer = $state<string | null>(null), selected = $state<string[]>([]), selectedChats = $state<string[]>([]);
  let limit = $state(36), allChats = $state(false);
  let shown = $derived(filterStoredFiles(files, {category, query, from, to, sort, peer}));
  let visible = $derived(shown.slice(0, limit));
  let selectedFiles = $derived(files.filter(file => selected.includes(file.id)));
  const groupInfo = {
    app: { label: 'Приложение', color: '#5aaec9', target: 'storage-app' },
    history: { label: 'Переписка и данные профиля', color: '#8e9ae6', target: 'storage-chats' },
    files: { label: 'Файлы чатов', color: '#59bcb2', target: 'storage-files' },
    models: { label: 'Модели ИИ', color: '#d8ac53', target: 'storage-models' },
    library: { label: 'GIF и стикеры', color: '#cb8aaf', target: 'storage-library' },
    profiles: { label: 'Другие профили', color: '#aa92ce', target: '' },
    browser: { label: 'Остальное по оценке браузера', color: '#78909e', target: '' },
  } as const;
  const breakdown = $derived(usage ? storageBreakdown(usage, files) : null);
  const groups = $derived((breakdown?.groups ?? []).filter(group => group.id !== 'browser' || group.bytes > 0).map(group => ({ ...group, ...groupInfo[group.id] })));
  const tabOnly = $derived(sumBytes(files.filter(file => !file.bytes).map(file => file.memoryBytes)));
  const types = $derived(Object.entries(categoryNames).map(([kind,label]) => ({
    kind, label, bytes: sumBytes(files.filter(file => file.category === kind && (peer === null || peer === file.peer)).map(file => file.bytes)),
  })));
  let wheel = $derived.by(() => {
    if (!breakdown?.total) return 'var(--line)';
    const total = breakdown.total;
    let start = 0;
    return `conic-gradient(${groups.filter(group => group.bytes).map(group => {
      const end = start + group.bytes / total * 100;
      const part = `${group.color} ${start}% ${end}%`; start = end; return part;
    }).join(',')})`;
  });
  // Cancellation and failed deletion preserve selection; refreshed inventory removes only deleted IDs.
  $effect(() => {const existing=new Set(files.map(file=>file.id));if(selected.some(id=>!existing.has(id)))selected=selected.filter(id=>existing.has(id));});
  $effect(() => {
    const withFiles = new Set(chats.filter(chat => chat.files).map(chat => chat.peer));
    if (selectedChats.some(peer => !withFiles.has(peer))) selectedChats = selectedChats.filter(peer => withFiles.has(peer));
  });
  function toggle(id:string) {selected=selected.includes(id)?selected.filter(value=>value!==id):[...selected,id];}
  function changeCategory(value:string) {category=value;limit=36;}
  function reset() {category='all';query='';from='';to='';peer=null;limit=36;}
  function showChat(value:string) {peer=value;category='all';query='';from='';to='';limit=36;}
  function jump(id: string) {
    const section = document.getElementById(id);
    if (section instanceof HTMLDetailsElement) section.open = true;
    section?.scrollIntoView({ block: 'start' });
  }
  function selectShown() {selected=[...new Set([...selected,...shown.map(file=>file.id)])];}
  function date(timestamp?:number) {return timestamp ? new Date(timestamp).toLocaleDateString($locale) : $i18n.text('Дата неизвестна');}
</script>
<section class="storage-panel" aria-label={$i18n.text('Менеджер памяти')}>
  <div class="heading"><h4>{$i18n.text('Хранилище')}</h4><HelpInfo label={$i18n.text('Справка: хранилище приложения')} text={$i18n.text('Объём относится к этому сайту в текущем браузере. Он может включать служебные данные браузера. Скачанные копии и хранилище нод считаются отдельно.')} /><button class="refresh" onclick={refresh} disabled={busy}>{busy?$i18n.text('Подождите…'):$i18n.text('Обновить')}</button></div>
  {#if breakdown}
    <div class="chart" aria-label={$i18n.text('Разбивка места в браузере')}>
      <div class="wheel" style:background={wheel}><div><strong>{$i18n.system(formatBytes(breakdown.total))}</strong><small>{breakdown.estimated ? $i18n.text('Занято в браузере') : $i18n.text('Посчитано')}</small></div></div>
      <ul class="legend">
        {#each groups as group (group.id)}
          <li>
            {#snippet entry()}<span class="dot" style:background={group.color}></span><span>{$i18n.text(group.label)}</span><strong>{$i18n.system(formatBytes(group.bytes))}</strong>{/snippet}
            {#if group.target}<button onclick={() => jump(group.target)}>{@render entry()}</button>
            {:else if group.id === 'profiles' && group.bytes}<button onclick={openProfiles}>{@render entry()}</button>
            {:else}<div>{@render entry()}</div>{/if}
          </li>
        {/each}
      </ul>
    </div>
    {#if breakdown.estimated}<p class="note">{$i18n.text('Итог приблизительный. Источник — оценка браузера.')}</p>
    {:else if breakdown.origin !== undefined}<p class="note">{$i18n.text('Оценка браузера')}: {$i18n.system(formatBytes(breakdown.origin))}. {$i18n.text('На круге показаны измеренные данные. Размеры могут различаться из-за хранения и сжатия.')}</p>
    {:else}<p class="note">{$i18n.text('Браузер не сообщил общий объём. На круге показаны измеренные данные.')}</p>{/if}
  {:else if busy}<p class="note" role="status">{$i18n.text('Измеряем хранилище…')}</p>{/if}
  {#if tabOnly}<p class="note">{$i18n.text('Файлы только в памяти вкладки')}: {$i18n.system(formatBytes(tabOnly))}</p>{/if}
  {#if volatile}<p class="note">{$i18n.text('Недоверенный режим: новая переписка находится в памяти вкладки. Здесь также видны оставшиеся данные прошлых доверенных сеансов.')}</p>{/if}
  {#if error}<p role="alert">{$i18n.text(error)}</p>{/if}
  {#if usage?.incomplete}<p class="note" role="status">{$i18n.text('Часть данных не удалось измерить. Обновите разбивку, чтобы повторить.')}</p>{/if}
  <details class="cleanup"><summary>{$i18n.text('Очистка переписки и файлов')}</summary>
    <p class="note">{$i18n.text('Очистка касается только этого аккаунта. Seed, контакты и настройки сохранятся. Копии в папке загрузок, на нодах и у собеседников остаются.')}</p>
    <div class="section-actions">
      <button class="danger" disabled={busy || !files.length} onclick={() => clean({kind:'all-files'})}>{$i18n.text('Удалить все файлы чатов')}</button>
      <button class="danger" disabled={busy} onclick={() => clean({kind:'history'})}>{$i18n.text('Удалить только переписку')}</button>
    </div>
  </details>
  <details id="storage-app">
    <summary>{$i18n.text('Приложение')}</summary>
    <p class="note">{$i18n.text('Эти компоненты нужны для запуска Automesh и работы без интернета. Обычная очистка их сохраняет.')}</p>
    {#if usage?.app}
      <dl class="breakdown">
        <div><dt>{$i18n.text('Код приложения')}</dt><dd>{$i18n.system(formatBytes(usage.app.scripts))}</dd></div>
        <div><dt>{$i18n.text('Стили')}</dt><dd>{$i18n.system(formatBytes(usage.app.styles))}</dd></div>
        <div><dt>{$i18n.text('Страница запуска и ресурсы')}</dt><dd>{$i18n.system(formatBytes(usage.app.shell))}</dd></div>
      </dl>
    {:else if !busy}<p class="note">{$i18n.text('Размер компонентов недоступен.')}</p>{/if}
  </details>
  {@render modelStorage?.()}
  <details id="storage-library">
    <summary>{$i18n.text('GIF и стикеры')}</summary>
    <p class="note">{$i18n.text('Библиотека сохраняется при очистке чатов. Общие файлы считаются один раз.')}</p>
    {#if usage}
      <dl class="breakdown">
        <div><dt>GIF · {gifCount}</dt><dd>{$i18n.system(formatBytes(usage.media.gifs))}</dd></div>
        <div><dt>{$i18n.text('Стикерпаки')} · {packCount}</dt><dd>{$i18n.system(formatBytes(usage.media.packs))}</dd></div>
        {#if usage.media.shared}<div><dt>{$i18n.text('Общие файлы GIF и стикерпаков')}</dt><dd>{$i18n.system(formatBytes(usage.media.shared))}</dd></div>{/if}
        {#if usage.media.cached}<div><dt>{$i18n.text('Кэш стикеров')}</dt><dd>{$i18n.system(formatBytes(usage.media.cached))}</dd></div>{/if}
      </dl>
    {/if}
    <div class="section-actions">
      {#if openLibrary}<button onclick={openLibrary} disabled={busy}>{$i18n.text('Открыть библиотеку')}</button>{/if}
      {#if packCount}<button class="danger" disabled={busy} onclick={() => clean({ kind: 'sticker-packs' })}>{$i18n.text('Удалить все стикерпаки')}</button>{/if}
    </div>
  </details>
  <details class="chats" id="storage-chats"><summary>{$i18n.text('По чатам')}</summary>
    <p class="note">{$i18n.text('Размер переписки в каждом чате приблизительный. Нажмите на чат, чтобы увидеть его файлы и варианты очистки.')}</p>
    <div class="chat-list">
      {#each chats.slice(0,allChats?chats.length:6) as group (group.peer)}
        <div>
          {#if group.peer && group.files}<input type="checkbox" value={group.peer} bind:group={selectedChats} aria-label={`${$i18n.text('Выбрать чат')}: ${name(group.peer)}`} />{/if}
          <button class:chosen={peer===group.peer} onclick={() => { showChat(group.peer); jump('storage-files'); }}><span class="chat-name">{group.peer?name(group.peer):$i18n.text('Файлы вне истории')}<small>{group.files} {$i18n.text('файлов')} · {group.messages} {$i18n.text('сообщений')}</small></span><span class="chat-size"><strong>{$i18n.system(formatBytes(group.bytes+group.historyBytes))}</strong> ›</span></button>
        </div>
      {/each}
      {#each localChats as group (group.action.kind === 'radio-chat' ? group.action.token : group.action.kind)}
        <div class="local-chat">
          <span class="chat-name">{group.action.kind === 'ai-chat' ? $i18n.text('ИИ-чат') : group.title}<small>{group.messages} {$i18n.text('сообщений')} · {$i18n.system(formatBytes(group.bytes))}</small></span>
          <button class="danger" disabled={busy} onclick={() => clean(group.action)}>{$i18n.text('Очистить чат целиком')}</button>
        </div>
      {/each}
      {#if !chats.length && !localChats.length}<p class="note">{$i18n.text('Здесь пока нет данных.')}</p>{/if}
    </div>
    {#if chats.length>6}<button onclick={()=>allChats=!allChats}>{allChats?$i18n.text('Свернуть'):$i18n.text('Все чаты')}</button>{/if}
    {#if selectedChats.length}<button class="danger" disabled={busy} onclick={() => clean({ kind: 'chat-files', peers: [...selectedChats] })}>{$i18n.text('Удалить файлы выбранных чатов')} · {selectedChats.length}</button>{/if}
  </details>
  <div class="heading files-title" id="storage-files"><h4>{peer===null?$i18n.text('Файлы чатов'):peer?name(peer):$i18n.text('Файлы вне истории')}</h4>{#if peer && openChat}<button onclick={()=>openChat?.(peer!)}>{$i18n.text('Открыть чат')}</button>{/if}{#if peer!==null}<button onclick={reset}>{$i18n.text('Все чаты')}</button>{/if}</div>
  {#if peer}
    <div class="section-actions">
      <button class="danger" disabled={busy || !files.some(file => file.peer === peer)} onclick={() => clean({kind:'chat-files', peers:[peer!]})}>{$i18n.text('Удалить файлы этого чата')}</button>
      {#if !canClearChat || canClearChat(peer)}<button class="danger" disabled={busy || !chats.some(chat => chat.peer === peer && (chat.messages || chat.files))} onclick={() => clean({kind:'chat',peer:peer!})}>{$i18n.text('Очистить чат целиком')}</button>{/if}
    </div>
  {/if}
  <div class="file-types" aria-label={$i18n.text('Тип файлов')}>
    {#each types as type (type.kind)}<button aria-pressed={category===type.kind} onclick={() => changeCategory(category===type.kind?'all':type.kind)}>{$i18n.text(type.label)} <strong>{$i18n.system(formatBytes(type.bytes))}</strong></button>{/each}
  </div>
  <div class="filters"><label class="search"><span>{$i18n.text('Поиск по имени файла')}</span><input type="search" bind:value={query} oninput={()=>limit=36} placeholder={$i18n.text('Название файла')} /></label>
    <label><span>{$i18n.text('С даты')}</span><input type="date" bind:value={from} onchange={()=>limit=36} /></label><label><span>{$i18n.text('По дату')}</span><input type="date" bind:value={to} min={from || undefined} onchange={()=>limit=36} /></label>
    <ChoiceMenu value={category} label={$i18n.text('Тип файлов')} options={[{value:'all',label:$i18n.text('Все файлы')},...Object.entries(categoryNames).map(([value,label])=>({value,label:$i18n.text(label)}))]} onChange={changeCategory}/>
    <ChoiceMenu value={sort} label={$i18n.text('Порядок файлов')} options={[{value:'size',label:$i18n.text('Сначала большие')},{value:'date',label:$i18n.text('Сначала новые')}]} onChange={value=>{sort=value;limit=36;}}/>
    {#if category!=='all'||query||from||to||peer!==null}<button onclick={reset}>{$i18n.text('Сбросить фильтры')}</button>{/if}
  </div>
  {#if from || to}<p class="note">{$i18n.text('Даты относятся к сообщениям. Файлы с неизвестной датой не включаются в выборку.')}</p>{/if}
  <div class="selection"><span>{shown.length} {$i18n.text('файлов')} · {$i18n.system(formatBytes(shown.reduce((sum,file)=>sum+fileBytes(file),0)))}</span><button onclick={selectShown} disabled={busy||!shown.length}>{$i18n.text('Выбрать найденные')}</button>
    {#if selectedFiles.length}<button onclick={()=>selected=[]} disabled={busy}>{$i18n.text('Снять выбор')}</button><button class="danger" disabled={busy} onclick={()=>clean({kind:'files',label:'Выбранные файлы',ids:selectedFiles.map(file=>file.id)})}>{$i18n.text('Удалить выбранные')} · {selectedFiles.length} · {$i18n.system(formatBytes(selectedFiles.reduce((sum,file)=>sum+fileBytes(file),0)))}</button>{/if}
    {#if (from||to) && !selectedFiles.length}<button class="danger" disabled={busy||!shown.length} onclick={()=>clean({kind:'files',label:'Файлы за выбранные даты',ids:shown.map(file=>file.id)})}>{$i18n.text('Удалить за период')}</button>{/if}
  </div>
  <div class="file-grid">{#each visible as file (file.id)}{@const key=`${file.peer}:${file.messageId}`}
    <article class:selected={selected.includes(file.id)}><label class="file-choice"><input type="checkbox" checked={selected.includes(file.id)} disabled={busy} onchange={()=>toggle(file.id)} aria-label={`${$i18n.text('Выбрать файл')}: ${file.name}`} />
      <StorageFilePreview {file} imageUrl={urls[key]} load={loadPreview} /><strong class="filename" title={file.name}>{file.name}</strong></label>
      <small>{file.shared && !fileBytes(file) ? $i18n.text('Общий файл библиотеки') : $i18n.system(formatBytes(fileBytes(file)))} · {date(file.timestamp)}</small><small class="peer-name">{file.peer?name(file.peer):$i18n.text('Файл вне истории')}</small>
      <div class="file-actions">{#if file.peer}<button disabled={busy} onclick={()=>download(file.peer,file.messageId)}>{$i18n.text('Скачать')}</button>{/if}<button disabled={busy} onclick={()=>clean({kind:'files',label:file.name,ids:[file.id]})}>{$i18n.text('Удалить')}</button></div>
    </article>{:else}<p class="note">{$i18n.text('По этим условиям файлов нет.')}</p>{/each}
  </div>
  {#if shown.length>limit}<button class="more" onclick={()=>limit+=36}>{$i18n.text('Показать ещё')}</button>{/if}
</section>
<style>
  .storage-panel{container-type:inline-size;font-size:14px;max-width:1000px;margin:auto;min-width:0}.heading{display:flex;align-items:center;gap:8px;flex-wrap:wrap}h4{margin:0;font-size:16px}.refresh{margin-left:auto}.chart{display:grid;grid-template-columns:1fr;align-items:center;justify-items:center;gap:14px;margin:16px 0 8px;padding:14px;background:var(--surface-alt);border:1px solid var(--line);border-radius:14px}
  .wheel{width:154px;height:154px;border-radius:50%;display:grid;place-items:center}.wheel>div{width:124px;height:124px;border-radius:50%;background:var(--surface-alt);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;text-align:center}.wheel strong{font-size:19px}.legend{width:100%;min-width:0;display:grid;gap:3px;list-style:none;padding:0;margin:0}.legend button,.legend li>div{box-sizing:border-box;display:flex;width:100%;align-items:center;gap:8px;padding:6px 8px;text-align:left;font-size:13px}.legend button{border-color:transparent}.legend strong{margin-left:auto;white-space:nowrap;font-variant-numeric:tabular-nums}.dot{width:9px;height:9px;border-radius:50%;flex-shrink:0}
  small,.note{font-size:12px;color:var(--muted)}.breakdown{margin:8px 0;display:grid;gap:8px}.breakdown>div{display:flex;gap:10px;justify-content:space-between}.breakdown dd{margin:0;white-space:nowrap;font-weight:600}.section-actions,.file-types{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 14px}.file-types button[aria-pressed=true]{background:var(--accent-soft)}.file-types strong{margin-inline-start:4px}.chat-list>div{display:flex;align-items:center;gap:8px}.chat-list input{width:20px;height:20px;flex:none;accent-color:var(--accent)}.chat-list>div>button{flex:1;min-width:0}
  details{margin:16px 0;border:1px solid var(--line);border-radius:12px;padding:12px}summary{font-weight:600;cursor:pointer}.chat-list{display:grid;margin-top:8px}.chat-list button{display:flex;align-items:center;gap:12px;padding:10px;border:0;border-bottom:1px solid var(--line);border-radius:0;text-align:left}.chat-name{flex:1;min-width:0;overflow-wrap:anywhere}.chat-name small{display:block;margin-top:3px}.chat-size{text-align:right}.chosen{background:var(--accent-soft)}
  .files-title{margin:22px 0 12px}.filters{display:flex;align-items:end;flex-wrap:wrap;gap:10px}.filters label{display:grid;gap:4px;min-width:0;flex:1 1 130px}.filters .search{flex-basis:100%}.filters label span{font-size:12px;color:var(--muted)}input{min-width:0;box-sizing:border-box;width:100%;font:inherit}.selection{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:14px 0}.selection>span{color:var(--muted);font-size:12px;margin-right:auto}
  .filters :global(.choice-menu){flex:1 1 160px;width:auto;min-width:0}
  .chat-list .local-chat{padding:6px 0;flex-wrap:wrap}.chat-list .local-chat button{flex:0 1 auto;border:1px solid var(--line);border-radius:8px}
  .file-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}.file-grid article{min-width:0;padding:9px;border:1px solid var(--line);border-radius:12px}.file-grid article.selected{outline:2px solid var(--accent)}.file-choice{display:block;position:relative;cursor:pointer}.file-choice input{position:absolute;z-index:1;left:6px;top:6px;width:20px;height:20px;margin:0;accent-color:var(--accent)}.filename{font-size:13px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:8px 0 4px}.peer-name{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:4px}.file-actions{display:flex;gap:6px;margin-top:9px;flex-wrap:wrap}.file-actions button{flex:1;font-size:12px;padding:5px 8px}.more{display:block;margin:16px auto}.danger{color:var(--danger,#ba4152)}.storage-panel button{font-size:13px;min-height:34px}
  @container(min-width:465px){.chart{grid-template-columns:154px minmax(0,1fr);gap:18px}}
  @container(min-width:720px){.filters .search{flex-basis:200px}}
  @media(pointer:coarse){.storage-panel button{min-height:44px}.filters input{font-size:16px}}
</style>
