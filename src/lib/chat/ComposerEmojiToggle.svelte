<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import ChatIcon from './ChatIcon.svelte';
  let { open, mobile, disabled = false, toggle }: { open: boolean; mobile: boolean; disabled?: boolean; toggle(): void } = $props();
  const label = $derived($i18n.text(open && mobile ? 'Открыть клавиатуру' : 'Эмодзи, стикеры и GIF'));
</script>

<button class="emoji-toggle" data-composer-toggle type="button" onclick={toggle} {disabled}
  aria-label={label} aria-expanded={open} title={label}>
  <ChatIcon name={open && mobile ? 'keyboard' : 'emoji'} />
</button>
