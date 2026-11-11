<script lang="ts">
 import ChatIcon from '$lib/chat/ChatIcon.svelte';
 let {node,size=18}:{node:number;size?:number}=$props();
</script>
<span class="avatar" style:width={`${size}px`} style:height={`${size}px`} style:color={`hsl(${node%360} 50% 65%)`} title={`!${node.toString(16).padStart(8,'0')}`} aria-hidden="true"><ChatIcon name="radio"/></span>
<style>.avatar{display:inline-grid;place-items:center;border-radius:5px;background:var(--surface-alt);flex-shrink:0;padding:1px;box-sizing:border-box}.avatar :global(svg){width:100%;height:100%}</style>
