<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import { untrack } from 'svelte';
  import CompactDialog from '$lib/application/CompactDialog.svelte';
  import { addMedia, pruneMedia, type MediaAsset, type MediaLibrary, type PreparedMedia, type StickerPack } from './media-library';
  import { type PreparedPack } from './sticker-pack';
  import { prepareMediaImport } from './media-import';
  import { formatBytes } from '$lib/application/storage-summary';
  import { removeMediaSelection } from './media-removal';
  let { library, initialTab = 'stickers', canSend, persistent, load, commit, send, share, exportPack, onClose }:
    { library: MediaLibrary; initialTab?: 'gifs' | 'stickers'; canSend: boolean; persistent: boolean;
      load(hash: string): Promise<Uint8Array | null>; commit(next: MediaLibrary, files?: PreparedMedia[]): Promise<void>;
      send(asset: MediaAsset, pack?: StickerPack): Promise<void>; share(pack: StickerPack): Promise<void>;
      exportPack(pack: StickerPack): Promise<void>; onClose(): void } = $props();
  let tab = $state(untrack(()=>initialTab)); let query = $state(''); let favoriteOnly = $state(false);
  let selectedPack = $state(''); let name = $state('Мои стикеры'); let input = $state<HTMLInputElement>(); let zipInput = $state<HTMLInputElement>();
  let busy = $state(false); let error = $state(''); let notice = $state(''); let pending = $state<PreparedPack | null>(null);
  let remove = $state<StickerPack | MediaAsset | null>(null); let urls = $state<Record<string,string>>({});
  let removeFromPack = $state<StickerPack | null>(null);
  let limit = $state(60);
  let dragging = $state(false);
  let selecting = $state(false), checked = $state<string[]>([]), packPickerOpen = $state(false);
  let bulkRemove = $state<{hashes: string[]; tab: 'gifs' | 'stickers'; packId: string} | null>(null);
  const selected = $derived(library.packs.find(p => p.id === selectedPack));
  const hashes = $derived(tab === 'gifs' ? library.gifs : selected ? selected.assets : [...new Set(library.packs.flatMap(p => p.assets))]);
  const assets = $derived(library.assets.filter(a => hashes.includes(a.hash) && (!favoriteOnly || a.favorite) && a.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())).sort((a,b) => b.usedAt-a.usedAt));
  $effect(() => { tab; selectedPack; query; favoriteOnly; checked=[]; selecting=false; });
  function toggle(hash: string) { checked = checked.includes(hash) ? checked.filter(value=>value!==hash) : [...checked,hash]; }
  async function confirmBulkRemove() {
    const choice=bulkRemove; if (!choice) return;
    await run(async () => {
      await commit(await removeMediaSelection(library,choice.hashes,choice.tab,choice.packId));
      bulkRemove=null; checked=[]; selecting=false; selectedPack=''; notice='Выбранное удалено из библиотеки. Сообщения в чатах сохранены.';
    });
  }
  async function run(action: () => Promise<void>) { if (busy) return; busy=true; error=''; notice=''; try { await action(); } catch(e) { error=e instanceof Error ? e.message : 'Не удалось выполнить действие.'; } finally { busy=false; } }
  $effect(() => {
    const shown = assets.slice(0,limit); let alive=true; const created: string[]=[];
    urls={};
    void (async () => { for (const asset of shown) {
      try { const bytes=await load(asset.hash); if (!alive) return; if (!bytes) continue;
        const url=URL.createObjectURL(new Blob([bytes as BlobPart],{type:asset.mime})); created.push(url); urls={...urls,[asset.hash]:url};
      } catch { /* Missing data is shown as a placeholder, not silently fetched. */ }
    } })();
    return () => { alive=false; for (const url of created) URL.revokeObjectURL(url); };
  });
  async function choose(event: Event) {
    const field=event.currentTarget as HTMLInputElement; const files=Array.from(field.files ?? []); field.value='';
    await importFiles(files);
  }
  async function importFiles(files: File[]) {
    if (!files.length || pending || remove || bulkRemove) return;
    const destination = tab;
    await run(async () => {
      const result = await prepareMediaImport(files, destination, name);
      if (result.kind === 'gifs') { await commit(addMedia(library,result.files),result.files); notice=`GIF добавлены: ${result.files.length}.`; }
      else pending={pack:result.pack,files:result.files};
    });
  }
  function fileDrag(event: DragEvent): boolean { return Boolean(event.dataTransfer?.types.includes('Files')); }
  function dragOver(event: DragEvent) {
    if (!fileDrag(event)) return;
    event.preventDefault(); event.stopPropagation();
    const allowed = !busy && !pending && !remove && !bulkRemove;
    if (event.dataTransfer) event.dataTransfer.dropEffect = allowed ? 'copy' : 'none';
    dragging = allowed;
  }
  function dragLeave(event: DragEvent) {
    if (!(event.relatedTarget instanceof Node) || !(event.currentTarget as HTMLElement).contains(event.relatedTarget)) dragging = false;
  }
  function drop(event: DragEvent) {
    event.preventDefault(); event.stopPropagation(); dragging=false;
    if (busy || pending || remove || bulkRemove) return;
    void importFiles(Array.from(event.dataTransfer?.files ?? []));
  }
  // Never navigate the browser to a dropped file, even on the dialog header/backdrop.
  function preventFileNavigation(event: DragEvent) { if (fileDrag(event)) event.preventDefault(); }
  async function favorite(asset: MediaAsset) { await run(()=>commit({...library,assets:library.assets.map(a=>a.hash===asset.hash?{...a,favorite:!a.favorite}:a)})); }
  async function confirmRemove() { const item=remove; if (!item) return; await run(async()=> {
    let next: MediaLibrary;
    if (!('assets' in item) && removeFromPack) {
      next=await removeMediaSelection(library,[item.hash],'stickers',removeFromPack.id);
    } else next='assets' in item ? {...library,packs:library.packs.filter(p=>p.id!==item.id)} : {...library,gifs:library.gifs.filter(h=>h!==item.hash)};
    await commit(pruneMedia(next)); remove=null; removeFromPack=null; selectedPack=''; checked=[]; selecting=false; notice='Удалено из библиотеки. Сообщения в чатах сохранены.';
  }); }
</script>
<svelte:window ondragover={preventFileNavigation} ondrop={preventFileNavigation} />
<CompactDialog title={$i18n.text("GIF и стикеры")} onClose={() => { if (!busy) onClose(); }}>
  <section class="import-area" class:dragging aria-label={$i18n.text("Импорт GIF и стикеров")} ondragover={dragOver} ondragleave={dragLeave} ondrop={drop}>
  <div class="tabs" role="group" aria-label={$i18n.text("Вид библиотеки")}>
    <button disabled={busy} class:active={tab==='stickers'} onclick={()=>{tab='stickers';limit=60;}}><span aria-hidden="true">❤️</span> {$i18n.text("Стикеры")}</button>
    <button disabled={busy} class:active={tab==='gifs'} onclick={()=>{tab='gifs';limit=60;}}><span aria-hidden="true">🖼️</span> GIF</button>
  </div>
  <p class="storage">{$i18n("m_858ed3453b55", {v0: ($i18n.system(formatBytes(library.assets.reduce((s,a)=>s+a.size,0)))), v1: (persistent?$i18n.text("На этом устройстве"):$i18n.text("Только до выхода"))})}</p>
  <p class="drop-hint" role="status">{dragging ? $i18n.text("Отпустите файлы для добавления") : tab === 'gifs' ? $i18n.text("Перетащите сюда GIF — можно несколько сразу.") : $i18n.text("Перетащите сюда ZIP-набор или картинки.")}</p>
  {#if error}<p role="alert" class="error">{$i18n.text(error)}</p>{/if}
  {#if notice}<p role="status">{$i18n.text(notice)}</p>{/if}
  {#if pending}
    <section class="confirm">
      <strong>{pending.pack.name}</strong><p>{$i18n("m_d59d87f74b72", {v0: (pending.pack.assets.length), v1: ($i18n.system(formatBytes(pending.files.reduce((s,f)=>s+f.bytes.length,0))))})}</p>
      <button disabled={busy} onclick={()=>void run(async()=>{const value=pending; if (!value)return; await commit(addMedia(library,value.files,value.pack),value.files); selectedPack=value.pack.id; pending=null; notice='Набор добавлен.';})}>{$i18n.text("Добавить набор")}</button>
      <button disabled={busy} onclick={()=>pending=null}>{$i18n.text("Отмена")}</button>
    </section>
  {:else if bulkRemove}
    <section class="confirm"><p>{$i18n("m_e95283de5b4c", {v0: (bulkRemove.hashes.length), v1: (bulkRemove.tab==='gifs'?$i18n.text("из GIF"):bulkRemove.packId?$i18n.text("из выбранного набора"):$i18n.text("из всех ваших наборов"))})}</p><button disabled={busy} onclick={()=>void confirmBulkRemove()}>{$i18n.text("Удалить выбранное")}</button><button disabled={busy} onclick={()=>bulkRemove=null}>{$i18n.text("Отмена")}</button></section>
  {:else if remove}
    <section class="confirm"><p>{$i18n("m_a555b8ecbde4", {v0: (remove.name), v1: (removeFromPack?$i18n("m_1303144c71bb", {v0: (removeFromPack.name)}):$i18n.text("из библиотеки"))})}</p><button disabled={busy} onclick={()=>void confirmRemove()}>{$i18n.text("Удалить")}</button><button disabled={busy} onclick={()=>{remove=null;removeFromPack=null;}}>{$i18n.text("Отмена")}</button></section>
  {:else}
    <input class="hidden" bind:this={input} type="file" accept={tab==='gifs'?'image/gif':'.png,.webp,.gif,image/png,image/webp,image/gif'} multiple onchange={e=>void choose(e)} />
    <input class="hidden" bind:this={zipInput} type="file" accept=".zip,application/zip" onchange={e=>void choose(e)} />
    {#if tab==='stickers' && library.packs.length}
      <button class="pack-picker" disabled={busy} aria-expanded={packPickerOpen} onclick={()=>packPickerOpen=!packPickerOpen}>{selected?`${selected.name} · ${selected.assets.length}`:$i18n.text("Все наборы")}</button>
      {#if packPickerOpen}<div class="pack-options" role="group" aria-label={$i18n.text("Выбрать набор")}><button disabled={busy} onclick={()=>{selectedPack='';packPickerOpen=false;}}>{$i18n.text("Все наборы")}</button>{#each library.packs as pack}<button disabled={busy} aria-pressed={pack.id===selectedPack} onclick={()=>{selectedPack=pack.id;packPickerOpen=false;}}>{pack.name} · {pack.assets.length}</button>{/each}</div>{/if}
      {#if selected}<button disabled={busy} class="delete-pack" onclick={()=>{remove=selected;removeFromPack=null;}}>{$i18n.text("Удалить набор целиком")}</button>{/if}
    {/if}
    <div class="search"><input aria-label={$i18n.text("Поиск по библиотеке")} bind:value={query} placeholder={$i18n.text("Поиск")} /><button aria-label={$i18n.text("Только избранное")} title={$i18n.text("Избранное")} aria-pressed={favoriteOnly} onclick={()=>favoriteOnly=!favoriteOnly}>★</button></div>
    {#if assets.length}<div class="tools selection-tools">
      <button disabled={busy} aria-pressed={selecting} onclick={()=>{selecting=!selecting;checked=[];}}>{selecting?$i18n.text("Отмена выбора"):$i18n.text("Выбрать несколько")}</button>
      {#if selecting}<button disabled={busy} onclick={()=>checked=assets.map(asset=>asset.hash)}>{$i18n("m_d5bf7fd246e3", {v0: (assets.length)})}</button><button disabled={busy || !checked.length} onclick={()=>bulkRemove={hashes:[...checked],tab,packId:selectedPack}}>{$i18n("m_325670185bb8", {v0: (checked.length)})}</button>{/if}
    </div>{/if}
    {#if !assets.length}<p class="empty">{tab==='gifs'?$i18n.text("Добавьте GIF с устройства."):$i18n.text("Создайте набор из PNG, WebP или GIF либо импортируйте ZIP Automesh.")}</p>{/if}
    <div class="grid">
      {#each assets.slice(0,limit) as asset (asset.hash)}
        <article class:checked={selecting && checked.includes(asset.hash)}>
          <button class="tile" disabled={busy || (!selecting && !canSend)} aria-pressed={selecting?checked.includes(asset.hash):undefined} title={selecting?$i18n.text("Выбрать"):canSend?$i18n("m_02e85d29ad00", {v0: (asset.name)}):asset.name} aria-label={`${selecting?$i18n.text("Выбрать"):$i18n.text("Отправить")} ${asset.name}`} onclick={()=>{if(selecting)toggle(asset.hash);else void run(()=>send(asset,tab==='stickers'?(selected??library.packs.find(p=>p.assets.includes(asset.hash))):undefined));}}>
            {#if urls[asset.hash]}<img src={urls[asset.hash]} alt={asset.name} loading="lazy" />{:else}<span>…</span>{/if}
          </button>
          {#if selecting}<span class="selection-mark" aria-hidden="true">{checked.includes(asset.hash)?'●':'○'}</span>{:else}<div class="item-tools"><button disabled={busy} aria-label={asset.favorite?$i18n.text("Убрать из избранного"):$i18n.text("В избранное")} aria-pressed={asset.favorite} onclick={()=>void favorite(asset)}>{asset.favorite?'★':'☆'}</button>{#if tab==='gifs' || selected}<button disabled={busy} aria-label={$i18n("m_ac211154a076", {v0: (asset.name)})} onclick={()=>{remove=asset;removeFromPack=tab==='stickers'?selected??null:null;}}>×</button>{/if}</div>{/if}
        </article>
      {/each}
    </div>
    {#if assets.length>limit}<button onclick={()=>limit+=60}>{$i18n.text("Показать ещё")}</button>{/if}
    <details open={!library.assets.length}>
      <summary>{$i18n.text("Добавить и управлять")}</summary>
      <div class="tools">
        {#if tab==='stickers'}<input aria-label={$i18n.text("Название нового набора")} bind:value={name} maxlength="64" placeholder={$i18n.text("Название набора")} />{/if}
        <button disabled={busy} onclick={()=>input?.click()}>{tab==='gifs'?$i18n.text("Добавить GIF"):$i18n.text("Создать из картинок")}</button>
        {#if tab==='stickers'}<button disabled={busy} onclick={()=>zipInput?.click()}>{$i18n.text("Импорт ZIP")}</button>{/if}
      </div>
      {#if tab==='stickers' && selected}
        <div class="tools"><button disabled={busy} onclick={()=>void run(async()=>{await exportPack(selected);notice='ZIP экспортирован.';})}>{$i18n.text("Экспорт")}</button><button disabled={busy || !canSend} onclick={()=>void run(async()=>{await share(selected);notice='Набор добавлен в очередь.';})}>{$i18n.text("Отправить набор")}</button></div>
        <p class="storage">{$i18n.text("Экспортированный ZIP не зашифрован.")}</p>
      {/if}
    </details>
    {#if busy}<p role="status">{$i18n.text("Обрабатываем…")}</p>{/if}
  {/if}
  </section>
</CompactDialog>
<style>
  .import-area { border-radius:10px; }
  .import-area.dragging { outline:2px dashed var(--accent,#176b63); outline-offset:5px; background:var(--accent-soft,#e4f3ef); }
  .drop-hint { font-size:13px; color:var(--text-muted,#536b77); margin:8px 0; }
  .tabs,.tools,.search,.item-tools { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
  .tabs button { flex:1; } .active { background:var(--accent-soft,#e4f3ef); border-color:var(--accent,#176b63); }
  button { min-height:40px; padding:8px 10px; font-size:16px; } input { font-size:16px; min-width:0; max-width:100%; box-sizing:border-box; padding:10px; }
  .tools,.search { margin:12px 0; } .tools input { flex:1 1 100%; width:100%; } .search input { flex:1; width:120px; }
  .storage,.empty { font-size:13px; color:var(--text-muted,#536b77); } .error { color:var(--danger); }
  .grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; } article { min-width:0; }
  .pack-picker { width:100%; text-align:left; border-radius:14px; } .pack-options { display:flex; flex-direction:column; gap:6px; padding:8px; border:1px solid var(--line); border-radius:14px; max-height:240px; overflow:auto; }
  .pack-options button { text-align:left; border-radius:12px; } .delete-pack { margin-top:8px; color:var(--danger); } .checked .tile { border:2px solid var(--accent); background:var(--accent-soft); }
  .selection-mark { display:block; text-align:center; color:var(--accent); font-size:22px; } .tile { border-radius:14px; }
  .tile { width:100%; height:100px; padding:5px; display:grid; place-items:center; background:var(--surface,#f5f9fa); }
  .tile img { max-width:100%; max-height:88px; object-fit:contain; } .item-tools { justify-content:center; }
  .item-tools button { min-width:40px; } .hidden { display:none; } .confirm { padding:12px; background:var(--accent-soft,#e4f3ef); border-radius:12px; }
  details { margin-top:12px; } summary { cursor:pointer; padding:8px 36px 8px 0; color:var(--muted); font-size:14px; }
  @media(max-width:350px) { .grid { grid-template-columns:repeat(2,minmax(0,1fr)); } }
</style>
