<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import {onMount} from 'svelte';
  import {queueIndicatorStates} from './queue-indicator';
  let {stored,transmitting,stopped,expired=0,retrying=0,errors,canceling,onOpen,expanded=false,quota}:{stored:number;transmitting:number;stopped:number;expired?:number;retrying?:number;errors:number;canceling:number;onOpen:()=>void;expanded?:boolean;quota?:{count:number;label:string}}=$props();
  let index=$state(0);
  const states=$derived(queueIndicatorStates({stored,transmitting,stopped,expired,retrying,errors,canceling,quota}));
  const current=$derived(states[index%states.length]);
  const description=$derived(states.map(s=>`${s.label}: ${s.count}`).join('. '));
  onMount(()=>{const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');const timer=setInterval(()=>{index=reduced.matches?0:(index+1)%states.length;},3500);return()=>clearInterval(timer);});
</script>
<button type="button" class="queue-indicator" class:danger={current.tone==='danger'} class:warning={current.tone==='warning'} class:success={current.tone==='success'} onclick={onOpen}
  title={$i18n("m_8f61f143c1ca", {v0: ($i18n.system(current.label)), v1: (current.count)})} aria-label={$i18n("m_bfe60658c1ce", {v0: ($i18n.system(description))})} aria-haspopup="dialog" aria-expanded={expanded}>
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 18a4 4 0 1 1 .6-8 6 6 0 0 1 11.7 1A3.5 3.5 0 1 1 19 18Z" /></svg>
  <span class="count" aria-hidden="true">{current.count>99?'99+':current.count}</span>
</button>
<style>
  .queue-indicator{position:relative;display:inline-grid;place-items:center;box-sizing:border-box;width:44px;min-width:44px;max-width:44px;height:44px;min-height:44px;flex:0 0 44px;padding:6px;border-radius:10px;color:var(--muted);background:var(--surface);border:1px solid var(--line)}
  .danger{color:var(--danger)}.warning{color:var(--warning)}.success{color:var(--success)}.count{position:absolute;top:1px;right:2px;font-size:10px;font-weight:600;line-height:12px;padding:0 2px;background:var(--surface);border-radius:5px;font-variant-numeric:tabular-nums}
</style>
