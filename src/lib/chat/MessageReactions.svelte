<script lang="ts">
 import{tr as i18n}from'$lib/i18n/language';import type{ReactionView}from'./message-updates';
 let{reactions,self,disabled=false,onReact}:{reactions:ReactionView[];self:string;disabled?:boolean;onReact?:(emoji:string)=>void}=$props();
</script>
{#if reactions.length}<div class="message-reactions" aria-label={$i18n.text('Реакции на сообщение')}>{#each reactions as reaction}<button type="button" disabled={disabled||!onReact} aria-pressed={reaction.actors.includes(self)} aria-label={`${reaction.emoji} · ${reaction.actors.length}`} onclick={()=>onReact?.(reaction.emoji)}>{reaction.emoji}{#if reaction.actors.length>1}<small>{reaction.actors.length}</small>{/if}</button>{/each}</div>{/if}
<style>.message-reactions{display:flex;gap:4px;flex-wrap:wrap;margin-top:6px}.message-reactions button{display:flex;gap:4px;align-items:center;border-radius:14px;padding:3px 7px;min-height:30px;font-size:16px;line-height:1.2}.message-reactions small{font-size:11px}</style>
