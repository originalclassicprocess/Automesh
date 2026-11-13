<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import {onDestroy,tick,type Snippet} from 'svelte';
  import ProfileIdentity from '../profiles/ProfileIdentity.svelte';
  import ChatIcon from '$lib/chat/ChatIcon.svelte';
  import ContactShare from '$lib/chat/ContactShare.svelte';
  import CompactDialog from './CompactDialog.svelte';
  import type {QueueIndicatorState} from '$lib/chat/queue-indicator';
  import {queueCount} from '$lib/chat/queue-indicator';
  let { accountId, avatar, photo = false, nickname, profile, expanded = false, settings = false, warning = false, update = false,
    disabled = false, lockDisabled = false, panicDisabled = false, onProfile, onPanic, onLock, onSettings, network, contactUrl='', contactEnabled=true, queueState, networkAvailable=false }: {
    accountId: string; avatar: string; photo?: boolean; nickname: string; profile: string; expanded?: boolean; settings?: boolean;
    warning?: boolean; update?: boolean; disabled?: boolean; lockDisabled?: boolean; panicDisabled?: boolean;
    onProfile(): void; onPanic(): void; onLock(): void; onSettings(): void; network: Snippet;
    contactUrl?:string;contactEnabled?:boolean;
    queueState?:QueueIndicatorState;networkAvailable?:boolean;
  } = $props();
  let qrOpen=$state(false),copied=$state(''),copyError=$state('');let feedbackTimer:ReturnType<typeof setTimeout>;
  let compact=$state(false),folded=$state(false),hubOpen=$state(false);
  let shortcutMode=$state<'both'|'copy'|'none'>('both');
  const hubId=$props.id();
  const hubLabel=$derived(queueState?'Сети и облако':'Сети');
  function fitHeader(node:HTMLElement){
    const identity=node.querySelector<HTMLElement>('.identity-measure')!;
    const content=node.querySelector<HTMLElement>('.hub-content')!;
    const hub=node.querySelector<HTMLElement>('.connection-hub')!;
    const toggle=node.querySelector<HTMLButtonElement>('.hub-toggle')!;
    const security=node.querySelector<HTMLElement>('.header-security')!;
    function fit(){
      // Measure the full unwrapped name independently of the current grid.
      // Keep the row until its actual contents stop fitting, not a breakpoint.
      const identityBase=identity.getBoundingClientRect().width+40+8+6+6;
      const children=[...content.children].filter(e=>getComputedStyle(e).display!=='none');
      const networkWidth=children.reduce((sum,e)=>sum+e.getBoundingClientRect().width,0)+Math.max(0,children.length-1)*4;
      const securityWidth=security.getBoundingClientRect().width;
      // Priority: merge connection/queue controls, then remove QR, then copy.
      // Never move a lone control onto a new row.
      const rest=44+4+securityWidth+8; // panic, utility gap, security, grid gaps
      folded=identityBase+96+networkWidth+rest>node.clientWidth;
      const available=node.clientWidth-rest-(folded?44:networkWidth);
      shortcutMode=identityBase+96<=available?'both':identityBase+48<=available?'copy':'none';
      compact=identityBase>available;
      if(!folded)hubOpen=false;
      void tick().then(()=>{
        if(!node.isConnected)return;
        const left=hub.getBoundingClientRect().left-node.getBoundingClientRect().left;
        const panelWidth=Math.min(node.clientWidth,networkWidth+18);
        // Anchor to the toggle; only shift sideways to stay inside the header.
        hub.style.setProperty('--hub-offset',`${Math.max(0,Math.min(left,node.clientWidth-panelWidth))-left}px`);
        hub.style.setProperty('--hub-max',`${node.clientWidth}px`);
      });
    }
    const observer=new ResizeObserver(fit);
    for(const element of [node,identity,content,security])observer.observe(element);
    function outside(event:PointerEvent){if(hubOpen&&!hub.contains(event.target as Node))hubOpen=false;}
    function action(event:MouseEvent){if(hubOpen&&content.contains(event.target as Node)&&(event.target as Element).closest('button')){hubOpen=false;toggle.focus({preventScroll:true});}}
    function escape(event:KeyboardEvent){if(hubOpen&&event.key==='Escape'){event.preventDefault();event.stopPropagation();hubOpen=false;toggle.focus();}}
    document.addEventListener('pointerdown',outside);document.addEventListener('click',action);document.addEventListener('keydown',escape);
    fit();return{destroy:()=>{observer.disconnect();document.removeEventListener('pointerdown',outside);document.removeEventListener('click',action);document.removeEventListener('keydown',escape);}};
  }
  $effect(()=>{accountId;qrOpen=false;hubOpen=false;copied='';copyError='';});
  onDestroy(()=>clearTimeout(feedbackTimer));
  async function copy(value:string,kind:'link'|'id'){
    const owner=accountId;copyError='';
    try{await navigator.clipboard.writeText(value);if(owner!==accountId)return;copied=kind;clearTimeout(feedbackTimer);feedbackTimer=setTimeout(()=>copied='',2000);}
    catch{if(owner===accountId){copyError='Не удалось скопировать. Mesh ID можно выделить вручную.';qrOpen=true;}}
  }
</script>
<header class="account-header compact-chat-header" class:compact class:copy-only={shortcutMode==='copy'} class:no-shortcuts={shortcutMode==='none'} aria-label={$i18n.text("Панель аккаунта")} use:fitHeader>
  <span class="identity-measure-clip" aria-hidden="true"><span class="identity-measure"><strong>{nickname}</strong><small>{profile}</small></span></span>
  <div class="identity-group" role="group" aria-label={$i18n.text("Профиль и мой контакт")}>
    <ProfileIdentity {accountId} {avatar} {photo} {nickname} {profile} {expanded} onOpen={onProfile} />
    <div class="contact-shortcuts" aria-label={$i18n.text("Мой контакт")}>
      <button type="button" class="icon-button" class:copied={copied==='link'} disabled={!contactEnabled||disabled} onclick={()=>void copy(contactUrl||accountId,'link')} aria-label={copied==='link'?$i18n.text("Контакт скопирован"):$i18n.text("Скопировать контакт с адресом сети")} title={$i18n.text("Скопировать ссылку с Mesh ID и адресом сети")}>
        {#if copied==='link'}<span aria-hidden="true">✓</span>{:else}<ChatIcon name="copy" />{/if}
      </button>
      <button type="button" class="icon-button" disabled={!contactEnabled||disabled} onclick={()=>qrOpen=true} aria-label={$i18n.text("Мой QR-код")} title={$i18n.text("Открыть мой QR-код")} aria-haspopup="dialog" aria-expanded={qrOpen}><ChatIcon name="qr" /></button>
    </div>
  </div>
  <div class="header-utility">
    <div class="connection-hub" class:folded class:open={hubOpen}>
      <button type="button" class="icon-button hub-toggle" hidden={!folded} onclick={()=>hubOpen=!hubOpen}
        aria-expanded={hubOpen} aria-controls={hubId} aria-label={$i18n("m_deee63ce06c0", {v0: ($i18n.text(hubLabel)), v1: (queueState?`. ${$i18n.system(queueState.label)}: ${queueCount(queueState)}`:'')})} title={$i18n.text(hubLabel)}>
        <span class="hub-network"><ChatIcon name="network" /></span>{#if queueState}<span class="hub-cloud" class:success={queueState.tone==='success'} class:warning={queueState.tone==='warning'} class:danger={queueState.tone==='danger'} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 18a4 4 0 1 1 .6-8 6 6 0 0 1 11.7 1A3.5 3.5 0 1 1 19 18Z" /></svg></span>{/if}
        <span class="hub-dot" class:connected={networkAvailable} aria-hidden="true"></span>
        {#if queueState&&(queueState.kind==='unknown'||queueState.count>0)}<span class="hub-count" class:success={queueState.tone==='success'} class:warning={queueState.tone==='warning'} class:danger={queueState.tone==='danger'} aria-hidden="true">{queueCount(queueState,true)}</span>{/if}
      </button>
      <div class="hub-panel" id={hubId} inert={folded&&!hubOpen} aria-hidden={folded&&!hubOpen}>
        <div class="hub-content" role="group" aria-label={$i18n.text(hubLabel)}>{@render network()}</div>
      </div>
    </div>
    <button class="icon-button" type="button" onclick={onPanic} disabled={disabled || panicDisabled}
      title={panicDisabled ? $i18n.text("Недоступно с правами подключённого устройства") : $i18n.text("Экстренное стирание локальных данных")} aria-label={$i18n.text("Экстренное стирание")}>🔥</button>
  </div>
  <div class="header-security">
    <button class="icon-button" type="button" onclick={onLock} disabled={lockDisabled} title={$i18n.text("Заблокировать аккаунт")} aria-label={$i18n.text("Быстрая блокировка")}>🔒</button>
    <button class="settings-button" type="button" aria-label={settings ? $i18n.text("Назад") : $i18n.text("Настройки")} title={settings ? $i18n.text("Назад") : $i18n.text("Настройки")} onclick={onSettings}>
      <span aria-hidden="true">{settings ? '←' : '⚙'}</span><span class="settings-label">{settings ? $i18n.text("Назад") : $i18n.text("Настройки")}</span>
      {#if !settings && warning}<span class="backup-warning" aria-label={$i18n.text("Сделайте резервную копию seed-фразы")}>!</span>{/if}
      {#if !settings && update}<span class="update-indicator" title={$i18n.text("Есть обновление")} aria-label={$i18n.text("Доступно обновление приложения")}>↑</span>{/if}
    </button>
  </div>
</header>
{#if qrOpen&&contactEnabled}<CompactDialog title={$i18n.text("Мой контакт")} onClose={()=>qrOpen=false}>
  <ContactShare {accountId} {contactUrl} copied={copied==='id'} onCopy={()=>void copy(accountId,'id')} />
  {#if copyError}<p role="alert">{$i18n.text(copyError)}</p>{/if}
</CompactDialog>{/if}

<style>
  header{position:relative;display:grid;grid-template-columns:minmax(0,1fr) auto auto;grid-template-areas:'identity utility security';align-items:start;gap:4px;max-width:100%}
  .identity-measure-clip{position:absolute;inset:0;visibility:hidden;pointer-events:none;overflow:hidden}
  .identity-measure{position:absolute;display:grid;width:max-content;white-space:nowrap;line-height:1.25}
  .identity-measure strong{font-size:15px}.identity-measure small{font-size:11px;font-weight:400}
  .identity-group{grid-area:identity;justify-self:start;display:flex;align-items:center;width:max-content;max-width:100%;gap:4px;min-width:0;padding:2px;border:1px solid transparent;border-radius:12px;transition:background .12s,border-color .12s}
  .identity-group:hover,.identity-group:focus-within{background:var(--surface-alt);border-color:var(--line-strong)}
  .contact-shortcuts{display:flex;align-items:center;gap:4px;flex-shrink:0}.copied{color:var(--success)}
  .copy-only .contact-shortcuts button:last-child{display:none}.no-shortcuts .contact-shortcuts{display:none}
  .header-utility{grid-area:utility;display:flex;align-items:center;gap:4px;max-width:100%;min-width:0;align-self:start;padding-top:3px}
  .header-utility :global(> *){flex-shrink:0}
  .header-security{grid-area:security;display:flex;align-items:center;gap:4px;justify-self:end;padding-top:3px}
  .update-indicator{position:absolute;right:2px;bottom:0;font-size:12px;line-height:14px;font-weight:600}
  .hub-content{display:flex;align-items:center;gap:4px;width:max-content}
  .connection-hub{position:relative}
  .hub-content :global(> *){flex-shrink:0}
  .hub-toggle[hidden]{display:none}
  .hub-toggle{position:relative;isolation:isolate}
  .hub-network{position:absolute;top:4px;left:4px;display:flex}
  .hub-cloud{position:absolute;bottom:3px;right:3px;display:flex;width:19px;height:19px;border-radius:5px;background:var(--surface);color:var(--muted)}
  .hub-cloud svg{width:19px;height:19px}
  .hub-dot{position:absolute;top:3px;right:3px;width:6px;height:6px;border-radius:50%;background:var(--muted)}.hub-dot.connected{background:var(--success)}
  .hub-count{position:absolute;bottom:0;left:2px;font-size:10px;line-height:12px;background:var(--surface);padding:0 2px;border-radius:3px}
  .success{color:var(--success)}.warning{color:var(--warning)}.danger{color:var(--danger)}
  .folded .hub-panel{position:absolute;left:var(--hub-offset,0px);top:calc(100% + 4px);z-index:30;width:max-content;max-width:var(--hub-max);padding:8px;border:1px solid var(--line);border-radius:12px;background:var(--surface);box-shadow:var(--shadow)}
  .folded:not(.open) .hub-panel{width:0;height:0;padding:0;border:0;overflow:hidden;visibility:hidden;pointer-events:none}
  .folded.open .hub-content{max-width:100%;flex-wrap:wrap}
  header.compact{grid-template-columns:minmax(0,1fr) auto;grid-template-areas:'utility security' 'identity identity'}
  .compact .identity-group{margin-top:0}
</style>
