<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import { messageLinks, inlineMessageLinks } from './message-links';
  import { standaloneEmoji } from './emoji';
  let { text, markdownLinks=false }: { text: string; markdownLinks?:boolean } = $props();
  const parts = $derived(markdownLinks?inlineMessageLinks(text):messageLinks(text));
</script>
<span class="message-text" class:emoji-only={standaloneEmoji(text)}>{#each parts as part}{#if part.href}<a href={part.href} class:insecure={!part.secure} target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" title={`${part.href} — ${part.secure ? $i18n.text("HTTPS защищает соединение, но не гарантирует безопасность сайта") : $i18n.text("HTTP: соединение с сайтом не зашифровано")}`}>{part.text}</a>{:else}{part.text}{/if}{/each}</span>
<style>
  .message-text { white-space:pre-wrap; overflow-wrap:anywhere; }
  .emoji-only { display:inline-block; font-size:64px; line-height:1.25; font-family:'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif; }
  @media (max-width:600px) { .emoji-only { font-size:58px; } }
  a { color:var(--link); text-decoration:underline; text-underline-offset:3px; }
  a.insecure { color:var(--danger); }
  a:focus-visible { outline:2px solid currentColor; outline-offset:3px; }
</style>
