<script lang="ts">
  import { onMount } from 'svelte';
  import type { ManagedFile } from './storage-summary';
  let {file, imageUrl = '', load}: {file:ManagedFile; imageUrl?:string; load?:(file:ManagedFile)=>Promise<Blob|null>} = $props();
  let node:HTMLSpanElement, url=$state('');
  onMount(()=>{
    if (imageUrl || !load || file.category!=='image') return;
    let disposed=false, ownUrl='';
    const observer=new IntersectionObserver(entries=>{
      if (!entries.some(entry=>entry.isIntersecting)) return;
      observer.disconnect();
      void load!(file).then(blob=>{
        if (!blob || disposed) return;
        ownUrl=URL.createObjectURL(blob);url=ownUrl;
      }).catch(()=>{}); // A failed thumbnail never blocks viewing or deleting a file.
    },{rootMargin:'100px'});
    observer.observe(node);
    return ()=>{disposed=true;observer.disconnect();if(ownUrl)URL.revokeObjectURL(ownUrl);};
  });
</script>
<span class="thumbnail" bind:this={node}>
  {#if (url||imageUrl)&&file.category==='image'}<img src={url||imageUrl} alt="" loading="lazy" />
  {:else}<span class="file-icon" aria-hidden="true">{file.category==='image'?'▧':file.category==='video'?'▷':file.category==='audio'?'♫':'▤'}</span>{/if}
</span>
<style>
  .thumbnail{display:grid;place-items:center;overflow:hidden;height:108px;border-radius:7px;background:var(--surface-alt)}img{width:100%;height:100%;object-fit:contain}.file-icon{font-size:32px;color:var(--muted)}
</style>
