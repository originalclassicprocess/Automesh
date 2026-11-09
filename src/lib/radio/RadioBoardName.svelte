<script lang="ts">
  import {standaloneEmoji} from '$lib/chat/emoji';
  let {name}:{name:string}=$props();
  const parts=$derived([...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(name)].map(part=>({text:part.segment,emoji:standaloneEmoji(part.segment)})));
</script>
<span class="board-name">{#each parts as part}<span class:emoji={part.emoji}>{part.text}</span>{/each}</span>
<style>
  .board-name{overflow-wrap:anywhere;white-space:pre-wrap}.emoji{font-family:'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif;font-size:clamp(20px,1.75em,28px);line-height:1.15;vertical-align:middle}
</style>
