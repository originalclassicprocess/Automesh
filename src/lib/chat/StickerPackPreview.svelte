<script lang="ts">
 import{onMount}from'svelte';import{tr as i18n}from'$lib/i18n/language';import CompactDialog from'$lib/application/CompactDialog.svelte';import type{PreparedPack}from'./sticker-pack';import type{PreparedMedia}from'./media-library';
 let{value,installed,canSend,busy=false,onAdd,onSend,onClose}:{value:PreparedPack;installed:boolean;canSend:boolean;busy?:boolean;onAdd():Promise<void>;onSend(file:PreparedMedia):Promise<void>;onClose():void}=$props();
 let urls=$state<Record<string,string>>({}),working=$state(false),error=$state('');
 onMount(()=>{const created:string[]=[];for(const f of value.files){const url=URL.createObjectURL(new Blob([f.bytes as BlobPart],{type:f.asset.mime}));created.push(url);urls[f.asset.hash]=url;}return()=>created.forEach(u=>URL.revokeObjectURL(u));});
 async function act(work:()=>Promise<void>){if(working||busy)return;working=true;error='';try{await work();}catch(e){error=e instanceof Error?e.message:'Не удалось выполнить действие.';}finally{working=false;}}
</script>
<CompactDialog title={value.pack.name} literalTitle onClose={()=>{if(!working&&!busy)onClose();}}>
 <div class="toolbar"><span>{value.pack.assets.length} {$i18n.text('стикеров')}</span>{#if installed}<span>{$i18n.text('Уже в библиотеке')}</span>{:else}<button disabled={busy||working} onclick={()=>void act(onAdd)}>{$i18n.text('Добавить набор')}</button>{/if}</div>
 <p>{$i18n.text('Нажмите на стикер, чтобы отправить его в этот чат.')}</p>
 {#if error}<p role="alert">{error}</p>{/if}
 <div class="grid">{#each value.pack.assets as hash(hash)}{@const file=value.files.find(f=>f.asset.hash===hash)!}<button disabled={busy||working||!canSend} aria-label={$i18n.text('Отправить')+' '+file.asset.name} onclick={()=>void act(()=>onSend(file))}>{#if urls[hash]}<img src={urls[hash]} alt={file.asset.name} loading="lazy"/>{/if}</button>{/each}</div>
</CompactDialog>
<style>.toolbar{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}.toolbar span,p{font-size:13px;color:var(--muted)}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.grid button{min-width:0;height:110px;padding:5px;background:transparent;border:1px solid var(--line);border-radius:12px}.grid img{max-width:100%;max-height:98px;object-fit:contain}</style>
