<script lang="ts">
  import {tr as i18n} from '$lib/i18n/language';
  let { items, label, onSelect }: { items: {id:string;label:string;detail:string;disabled?:boolean}[];label:string;onSelect(id:string):void } = $props();
</script>
<nav class="settings-links" aria-label={$i18n.text(label)}>
  {#each items as item}
    <button type="button" disabled={item.disabled} onclick={() => onSelect(item.id)}><span><strong>{$i18n.text(item.label)}</strong><small>{$i18n.text(item.detail)}</small></span><span aria-hidden="true">›</span></button>
  {/each}
</nav>
<style>
  nav{display:grid;gap:8px;margin:16px 0}button{display:flex;align-items:center;justify-content:space-between;gap:12px;text-align:left;padding:14px;min-height:56px;width:100%}small{display:block;margin-top:4px;color:var(--muted);font-size:12px;font-weight:400}strong{font-size:14px}
</style>
