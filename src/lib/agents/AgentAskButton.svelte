<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';

  let { disabled, working, ask }: { disabled: boolean; working: boolean; ask: () => void } = $props();
</script>

<button type="button" class="icon-button" {disabled} aria-busy={working} onclick={ask}
  aria-label={$i18n.text('Спросить ИИ')} title={$i18n.text('Спросить ИИ')}>AI</button>

<style>
  button { color: var(--accent); font-size: 12px; font-weight: 700; }
</style>
