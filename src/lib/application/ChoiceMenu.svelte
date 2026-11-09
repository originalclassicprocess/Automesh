<script lang="ts">
  import { tick } from 'svelte';
  let { value, options, label, disabled = false, id, onChange }: {
    value: string | number; options: {value:string|number;label:string}[]; label:string; disabled?:boolean; id?:string; onChange(value:string):void;
  } = $props();
  const uid = $props.id();
  let open=$state(false), active=$state(0), root:HTMLDivElement, trigger:HTMLButtonElement;
  let list=$state<HTMLDivElement>();
  let selected=$derived(options.find(o=>String(o.value)===String(value)));
  async function show(){ if(disabled)return;active=Math.max(0,options.findIndex(o=>String(o.value)===String(value)));open=true;await tick();list?.focus(); }
  function close(focus=false){open=false;if(focus)trigger?.focus();}
  function choose(index:number){const option=options[index];if(!option||disabled)return;onChange(String(option.value));close(true);}
  function keyboard(event:KeyboardEvent){
    if(event.key==='Escape'){event.preventDefault();close(true);return;}
    if(event.key==='Tab'){close(true);return;}
    if(event.key==='Enter'||event.key===' '){event.preventDefault();if(open)choose(active);else void show();return;}
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
      event.preventDefault();if(!open){void show();return;}
      active=event.key==='Home'?0:event.key==='End'?options.length-1:(active+(event.key==='ArrowDown'?1:-1)+options.length)%options.length;
      void tick().then(()=>list?.children.item(active)?.scrollIntoView({block:'nearest'}));
    } else if(event.key.length===1 && open){const index=options.findIndex(o=>o.label.toLocaleLowerCase().startsWith(event.key.toLocaleLowerCase()));if(index>=0)active=index;}
  }
  $effect(()=>{if(disabled)open=false;});
  $effect(()=>{
    if(!open)return;
    const outside=(event:PointerEvent)=>{if(event.target instanceof Node&&!root?.contains(event.target))close();};
    document.addEventListener('pointerdown',outside);
    return()=>document.removeEventListener('pointerdown',outside);
  });
</script>
<div class="choice-menu" bind:this={root}>
  <button {id} type="button" class="choice-trigger" bind:this={trigger} {disabled} aria-label={label}
    aria-haspopup="listbox" aria-expanded={open} aria-controls={`${uid}-list`} onclick={()=>open?close():void show()} onkeydown={keyboard}>
    <span>{selected?.label??label}</span><span class="choice-disclosure" class:open aria-hidden="true"></span>
  </button>
  {#if open}
    <div class="choice-options" id={`${uid}-list`} role="listbox" aria-label={label} tabindex="-1" bind:this={list}
      aria-activedescendant={`${uid}-option-${active}`} onkeydown={keyboard}>
      {#each options as option,index}
        <button type="button" role="option" tabindex="-1" id={`${uid}-option-${index}`} aria-selected={String(option.value)===String(value)}
          class:active={index===active} onclick={()=>choose(index)}>{option.label}
          {#if String(option.value)===String(value)}<span aria-hidden="true">✓</span>{/if}
        </button>
      {/each}
    </div>
  {/if}
</div>
<style>
  .choice-menu{position:relative;width:100%;min-width:0}.choice-trigger{display:flex;justify-content:space-between;align-items:center;gap:12px;width:100%;min-height:44px;text-align:left;font-size:15px;padding:11px 14px;border-radius:14px}.choice-trigger span{min-width:0;overflow-wrap:anywhere}
  .choice-disclosure{width:26px;height:26px;flex:0 0 26px;border:1px solid var(--line);border-radius:50%;background:linear-gradient(var(--accent),var(--accent)) center/10px 1.5px no-repeat,linear-gradient(var(--accent),var(--accent)) center/1.5px 10px no-repeat,var(--surface-alt)}.choice-disclosure.open{background:linear-gradient(var(--accent),var(--accent)) center/10px 1.5px no-repeat,var(--surface-alt)}
  @media(forced-colors:active){.choice-disclosure::after{content:'+'}.choice-disclosure.open::after{content:'−'}.choice-disclosure{display:grid;place-items:center;color:ButtonText}}
  .choice-options{position:absolute;top:calc(100% + 6px);left:0;right:0;z-index:50;max-height:min(340px,45vh);overflow:auto;padding:6px;background:var(--surface,#fff);border:1px solid var(--line,#d2dfe4);border-radius:18px;box-shadow:0 12px 32px var(--shadow-color);outline:none}
  .choice-options button{display:flex;justify-content:space-between;gap:12px;width:100%;text-align:left;min-height:44px;padding:11px 12px;font-size:14px;border:0;border-radius:12px;margin:2px 0;background:transparent}.choice-options button.active,.choice-options button[aria-selected=true]{background:var(--accent-soft,#e4f2ef);color:var(--accent,#126e69)}
</style>
