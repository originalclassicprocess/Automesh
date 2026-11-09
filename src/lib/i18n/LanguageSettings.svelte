<script lang="ts">
  import {onDestroy} from 'svelte';
  import {language,localTranslations,tr,installTranslation,removeTranslation} from './language';
  import {MAX_PACK_BYTES} from './packs';
  import {translationTemplate} from './packs';
  import {messageIds} from './catalog';
  import LanguageSelector from './LanguageSelector.svelte';
  import HelpInfo from '$lib/application/HelpInfo.svelte';
  let busy=$state(false),error=$state(''),notice=$state(''),url=$state('');
  let generation=0;
  const translated=$derived($localTranslations.find(pack=>`local:${pack.locale}`===$language));
  function storage(){try{return localStorage;}catch{return undefined;}}
  async function upload(event:Event){
    const field=event.currentTarget as HTMLInputElement,file=field.files?.[0];field.value='';if(!file)return;
    const token=++generation;busy=true;error='';notice='';
    try{
      if(file.size>MAX_PACK_BYTES)throw new Error('translation_pack_too_large');
      const text=await file.text();if(token!==generation)return;
      const result=installTranslation(text,storage());notice=result.persisted?'language.imported':'language.memory';
    }catch(failure){if(token===generation)error=failure instanceof Error&&failure.message==='translation_pack_too_large'?'language.tooLarge':failure instanceof Error&&failure.message==='translation_pack_limit'?'language.limit':'language.invalid';}
    finally{if(token===generation)busy=false;}
  }
  function download(){if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(new Blob([JSON.stringify(translationTemplate(),null,2)],{type:'application/json'}));}
  function remove(){if(!translated)return;error='';notice='';if(!removeTranslation($language,storage()))error='language.removeFailed';}
  onDestroy(()=>{generation++;if(url)URL.revokeObjectURL(url);});
</script>
<section class="language-settings" aria-label={$tr('language.title')}>
  <h4>{$tr('language.title')}</h4>
  <LanguageSelector />
  <div class="translation-actions">
    <button type="button" onclick={download}>{$tr('language.template')}</button>
    <label class="import-button" class:busy>{busy?$tr('language.reading'):$tr('language.import')}
      <input type="file" accept=".json,application/json" aria-label={$tr('language.import')} disabled={busy} onchange={upload} />
    </label>
    {#if translated}<button type="button" disabled={busy} onclick={remove}>{$tr('language.remove')}</button>{/if}
  </div>
  {#if url}<a href={url} download="automesh-translation-template.json">{$tr('language.download')}</a>{/if}
  <p class="language-help">{$tr('language.local')} <HelpInfo label={$tr('language.helpLabel')} text={$tr('language.help')} /></p>
  {#if translated}<p class="language-help">{$tr('language.coverage',{count:Object.keys(translated.messages).length,total:messageIds.length})}</p>{/if}
  {#if error}<p role="alert">{$tr(error)}</p>{/if}
  {#if notice}<p role="status">{$tr(notice)}</p>{/if}
</section>
<style>
  .translation-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:14px 0}
  .import-button{position:relative;display:inline-flex;align-items:center;min-height:44px;padding:8px 12px;border:1px solid var(--line);border-radius:14px;cursor:pointer;font-size:14px;background:var(--surface);max-width:100%}
  .import-button input{position:absolute;width:1px;height:1px;opacity:0;overflow:hidden}.import-button:focus-within{outline:3px solid var(--focus);outline-offset:3px}.import-button.busy{opacity:.5;cursor:wait}
  .language-help{font-size:13px;color:var(--muted);line-height:1.5}h4{margin-top:0}p[role=alert]{color:var(--danger)}a{overflow-wrap:anywhere}
</style>
