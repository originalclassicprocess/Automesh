<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import {formatBytes} from '$lib/application/storage-summary';
  let { files, disabled, onRemove,onMove,preview=$bindable<number|null>(null) }: { files: File[]; disabled: boolean; onRemove(index: number): void;onMove?:(index:number,offset:number)=>void;preview?:number|null } = $props();
  let urls = $state<string[]>([]);
  $effect(() => {
    const created = files.map(file => URL.createObjectURL(file)); urls = created;
    return () => created.forEach(url => URL.revokeObjectURL(url));
  });
  $effect(()=>{if(preview!==null&&(!files.length||preview>=files.length))preview=files.length?files.length-1:null;});
  const active=$derived(preview===null?undefined:files[preview]);
  function move(offset:number){if(preview===null||disabled||!onMove)return;const next=preview+offset;if(next<0||next>=files.length)return;onMove(preview,offset);preview=next;}
</script>
{#if files.length}
  <section class="pasted-images" aria-label={$i18n.text("Вложения к отправке")}>
    {#if active&&preview!==null}
      <div class="draft-preview" aria-label={$i18n.text('Предпросмотр вложения')}>
        <header><strong>{preview+1}/{files.length} · {active.name}</strong><button type="button" onclick={()=>preview=null} aria-label={$i18n.text('Закрыть')}>×</button></header>
        {#if /^image\/(png|jpeg|gif|webp|avif)$/.test(active.type)}<img class="large" src={urls[preview]} alt={active.name}/>
        {:else if active.type.startsWith('video/')}<video class="large" controls preload="metadata" src={urls[preview]}><track kind="captions"/></video>
        {:else if active.type.startsWith('audio/')}<audio controls preload="metadata" src={urls[preview]}></audio>{/if}
        <footer><small>{formatBytes(active.size)}</small>{#if onMove}<button type="button" disabled={disabled||preview===0} onclick={()=>move(-1)} aria-label={$i18n.text('Раньше в очереди')}>←</button><button type="button" disabled={disabled||preview===files.length-1} onclick={()=>move(1)} aria-label={$i18n.text('Позже в очереди')}>→</button>{/if}<button type="button" disabled={disabled} onclick={()=>onRemove(preview!)}>{$i18n.text('Убрать вложение')}</button></footer>
      </div>
    {/if}
    <div class="previews">{#each files as file, index}
      <article><button type="button" class="preview-button" aria-pressed={preview===index} onclick={()=>preview=preview===index?null:index} aria-label={$i18n.text('Предпросмотр вложения')+' '+file.name}>{#if /^image\/(png|jpeg|gif|webp|avif)$/.test(file.type)}<img src={urls[index]} alt={file.name || $i18n.text("Вставленная картинка")} />{:else}<span>{file.name}<br /><small>{$i18n("m_23efda167fd1", {v0: ((file.size/1024).toFixed(1))})}</small></span>{/if}</button><button class="remove" disabled={disabled} onclick={() => onRemove(index)} aria-label={$i18n("m_679b953757d0", {v0: (index + 1)})}>×</button></article>
    {/each}</div>
  </section>
{/if}
<style>
  .pasted-images { padding:10px; border:1px solid var(--line); border-radius:14px; margin:8px 0; }
  small { font-size:12px; color:var(--muted); } .previews { display:flex; gap:8px; overflow-x:auto; }
  article { position:relative; flex:0 0 86px; border-radius:12px; background:var(--surface-alt); }
  article span { display:block; padding:32px 6px 6px; font-size:12px; overflow-wrap:anywhere; }
  img { width:86px; height:86px; object-fit:contain; border-radius:12px; display:block; }
  .remove { position:absolute; right:0; top:0; border-radius:50%; width:32px; height:32px; padding:0; font-size:22px; }
  .preview-button{display:block;padding:0;width:86px;height:86px;overflow:hidden;border-radius:12px;font-size:12px;text-align:left}.preview-button span{padding:14px 4px 4px}
  .draft-preview{margin-bottom:8px;max-height:36dvh;overflow:auto}header,footer{display:flex;gap:6px;align-items:center}header strong{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}header button{min-height:32px;padding:0 8px}footer{margin-top:6px;flex-wrap:wrap}footer small{margin-right:auto}footer button{font-size:12px;padding:6px}.large{display:block;max-width:100%;width:auto;height:auto;max-height:180px;margin:6px auto;object-fit:contain}audio{max-width:100%;margin:6px 0}
</style>
