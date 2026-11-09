<script lang="ts">
  import { availableLanguages, language, setLanguage, tr, type Language } from './language';
  let warning=$state(false);
  function choose(value: Language) {
    let storage:Storage|undefined;try{storage=localStorage;}catch{/* Works in memory. */}
    setLanguage(value,storage);try{warning=!storage||storage.getItem('automesh.ui-language.v1')!==value;}catch{warning=true;}
  }
</script>
<nav class="language-choice" aria-label={$tr('language.title')}>
  {#each $availableLanguages as option}<button type="button" lang={option.value.replace('local:','')} aria-pressed={$language===option.value} onclick={()=>choose(option.value)}>{option.label}</button>{/each}
</nav>
{#if warning}<small role="status">{$tr('language.preferenceMemory')}</small>{/if}
<style>
  .language-choice { display:flex; flex-wrap:wrap; gap:6px; }
  button { border:1px solid var(--line); border-radius:12px; min-height:36px; padding:6px 10px; background:var(--surface); color:var(--text); font-size:13px;max-width:100%;overflow-wrap:anywhere }
  button[aria-pressed="true"] { background:var(--accent-soft); border-color:var(--accent); }
  small{display:block;color:var(--muted);font-size:12px;margin-top:6px}
</style>
