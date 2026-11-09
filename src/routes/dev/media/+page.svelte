<script lang="ts">
  import { onMount } from 'svelte';
  import MediaLibraryPanel from '$lib/chat/MediaLibraryPanel.svelte';
  import MessageText from '$lib/chat/MessageText.svelte';
  import { addMedia, emptyMediaLibrary, makePack, prepareMedia, type MediaLibrary, type PreparedMedia } from '$lib/chat/media-library';
  import { exportStickerPack } from '$lib/chat/sticker-pack';
  let library=$state<MediaLibrary>(emptyMediaLibrary()); let open=$state(true); let feedback=$state('');
  const bytes=new Map<string,Uint8Array>();
  onMount(()=>{ void (async()=>{
    const gif=Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'),c=>c.charCodeAt(0));
    const media=await prepareMedia(gif,'Пример.gif'); bytes.set(media.asset.hash,gif);
    const stickers: PreparedMedia[]=[];
    for (const emoji of ['🙂','❤️','👍']) {
      const canvas=document.createElement('canvas'); canvas.width=160; canvas.height=160;
      const context=canvas.getContext('2d')!; context.font='100px sans-serif'; context.textAlign='center'; context.textBaseline='middle'; context.fillText(emoji,80,85);
      const png=Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]),c=>c.charCodeAt(0));
      const sticker=await prepareMedia(png,`${emoji}.png`); bytes.set(sticker.asset.hash,png); stickers.push(sticker);
    }
    library=addMedia(addMedia(library,[media]),stickers,await makePack('Пример',stickers));
  })(); });
  async function commit(next:MediaLibrary,files:PreparedMedia[]=[]){ for(const file of files)bytes.set(file.asset.hash,file.bytes); library=next; }
</script>
<main style="max-width:900px;margin:auto;padding:20px;">
  <h1>Локальная проверка медиа</h1>
  <p>Без аккаунта, внешних запросов и сохранения истории.</p>
  <p><MessageText text="👋🏽" /> <MessageText text="Эмодзи в тексте 👋🏽" /></p>
  <button onclick={()=>open=true}>Открыть библиотеку</button>
  <p role="status">{feedback}</p>
  {#if open}<MediaLibraryPanel {library} canSend={true} persistent={false} load={async hash=>bytes.get(hash)??null}
    {commit} send={async asset=>{feedback=`Выбран файл: ${asset.name}`;open=false;}}
    share={async pack=>{feedback=`Архив: ${exportStickerPack(pack,pack.assets.map(hash=>({asset:library.assets.find(a=>a.hash===hash)!,bytes:bytes.get(hash)!}))).length} Б`;}}
    exportPack={async()=>{feedback='Экспорт проверяется модульными тестами.';}} onClose={()=>open=false} />{/if}
</main>
