<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import ChoiceMenu from './ChoiceMenu.svelte';
  let { section, items, descriptions, backupWarning = false, onSelect }:
    { section: string; items: { id: string; label: string }[]; descriptions: Record<string, string>; backupWarning?: boolean; onSelect: (id: string) => void } = $props();
</script>
<div class="settings-navigation">
{#if section === 'overview'}
  <p class="intro">{$i18n.text("Настройте приложение под себя.")}</p>
  <nav class="settings-grid" aria-label={$i18n.text("Меню настроек")}>
    {#each items as item}
      <button type="button" onclick={() => onSelect(item.id)}>
        <span><strong>{$i18n.text(item.label)}{#if item.id === 'security' && backupWarning}<span class="warning" aria-label={$i18n.text("Резервная копия не проверена")}>!</span>{/if}</strong>
        <small>{$i18n.text(descriptions[item.id])}</small></span><span aria-hidden="true">›</span>
      </button>
    {/each}
  </nav>
{:else}
  <nav class="settings-menu" aria-label={$i18n.text("Разделы настроек")}>
    <button type="button" onclick={() => onSelect('overview')}>{$i18n.text("Все настройки")}</button>
    <div class="section-choice"><ChoiceMenu value={section} label={$i18n.text("Перейти в раздел")}
      options={items.map(item=>({value:item.id,label:$i18n.text(item.label)+(item.id==='security'&&backupWarning?' · !':'')}))} onChange={onSelect} /></div>
  </nav>
{/if}
</div>
<style>
  .settings-navigation { container-type:inline-size; position:relative; z-index:5; }
  .intro { color:var(--muted); }
  .settings-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; margin:18px 0 8px; }
  .settings-grid button { display:flex; justify-content:space-between; align-items:center; gap:12px; padding:18px; text-align:left; }
  .settings-grid small { display:block; margin-top:6px; color:var(--muted); font-weight:400; font-size:13px; }
  .settings-menu { display:flex; gap:8px; margin:12px 0; align-items:center; }.section-choice{flex:1;min-width:0}
  .settings-menu button { font-size:13px; }
  .warning { display:inline-grid; place-items:center; background:var(--danger); color:var(--on-accent); border-radius:50%; width:1.2em; height:1.2em; margin-left:4px; font-weight:bold; font-size:12px; }
  @container(max-width:520px) { .settings-grid { grid-template-columns:1fr; } }
</style>
