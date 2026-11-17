<script lang="ts">
 import{onMount}from'svelte';import{tr as i18n}from'$lib/i18n/language';import type{PreparedPack}from'./sticker-pack';
 let{name,load,onOpen,busy=false}:{name:string;load():Promise<PreparedPack>;onOpen():void;busy?:boolean}=$props();let urls=$state<string[]>([]),count=$state(0),failed=$state(false);
 onMount(()=>{let alive=true;const created:string[]=[];void load().then(value=>{if(!alive)return;count=value.pack.assets.length;for(const hash of value.pack.assets.slice(0,4)){const file=value.files.find(f=>f.asset.hash===hash)!;created.push(URL.createObjectURL(new Blob([file.bytes as BlobPart],{type:file.asset.mime})));}urls=[...created];}).catch(()=>{if(alive)failed=true;});return()=>{alive=false;created.forEach(u=>URL.revokeObjectURL(u));};});
</script>
<button class="pack-card" disabled={busy} onclick={onOpen} aria-label={$i18n.text('Посмотреть набор')+' '+name}>
 <span class="stack" aria-hidden="true">{#each urls as url,i}<img src={url} alt="" style:left={i*15+'px'} style:transform={'rotate('+(i*6)+'deg)'} style:z-index={4-i}/>{/each}{#if !urls.length}<span>▧</span>{/if}</span>
 <strong>{name}</strong><small>{count?count+' '+$i18n.text('стикеров'):$i18n.text('Стикерпак')}</small><span class="action">{$i18n.text(failed?'Открыть набор':'Посмотреть набор')}</span>
</button>
<style>.pack-card{display:flex;flex-direction:column;align-items:flex-start;gap:5px;text-align:left;min-width:0;width:min(280px,100%);padding:12px;border-radius:16px;background:var(--surface-alt);border:1px solid var(--line)}.stack{display:block;position:relative;width:180px;height:116px;margin-bottom:5px}.stack img{position:absolute;top:6px;width:110px;height:100px;object-fit:contain;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:4px;box-shadow:0 2px 7px var(--shadow-color)}strong{font-size:16px;overflow-wrap:anywhere}small{color:var(--muted);font-size:12px}.action{font-size:13px;color:var(--accent);margin-top:5px}</style>
