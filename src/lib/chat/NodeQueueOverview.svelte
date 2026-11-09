<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import { nodeQueueCategories, nodeInteractionCounts, type NodeQueueCategory, type NodeQueueChat } from './node-queue-overview';
  import NodeQuotaDetails from '$lib/node/NodeQuotaDetails.svelte';
  import {freshQueueSnapshot,readMessageQuota,messageQuotaFull,type QueueSnapshot} from '$lib/node/queue-quota';
  import {cleanupErrors,cleanupWaiting,cleanupExplanation,type QueueCleanup} from '$lib/node/queue-cleanup';
  import {effectiveDeliveryIssue} from './node-transfer';
  import {deliveryIssues} from '$lib/application/delivery-issues';
  import QueueCategory from './QueueCategory.svelte';
  let { chats, onOpen, onClear, snapshot, connected=true, cleanup, nodeUrl='' }:{chats:NodeQueueChat[];onOpen:(peer:string,id:string)=>void;onClear:(peer?:string)=>void;snapshot?:QueueSnapshot;connected?:boolean;cleanup?:QueueCleanup;nodeUrl?:string}=$props();
  let selected=$state<NodeQueueCategory|'files'|'messages'|null>(null);
  const counts=$derived(nodeInteractionCounts(chats));
  const category=$derived(nodeQueueCategories.find(c=>c.id===selected));
  const visible=$derived(selected&&selected!=='files'&&selected!=='messages'?chats.filter(c=>c.groups[selected as NodeQueueCategory].length):[]);
  const detailId=$props.id();
  const nodeHost=$derived.by(()=>{try{return new URL(nodeUrl).host;}catch{return 'Нода доставки';}});
  const messageQuota=$derived(readMessageQuota(snapshot?.quota));
  const remote=$derived(connected&&freshQueueSnapshot(snapshot)?snapshot:undefined);
  const displayed=$derived({...counts,waiting:remote?.messages??counts.waiting,errors:counts.errors+cleanupErrors(cleanup),retrying:counts.retrying+cleanupWaiting(cleanup)});
</script>
<div class="categories" aria-label={$i18n.text("Взаимодействие с нодой")}>
  {#each nodeQueueCategories as item}
    <QueueCategory label={$i18n.text(item.label)} count={displayed[item.id]} tone={item.tone==='muted'?'neutral':item.tone} active={selected===item.id}
      controls={detailId} onToggle={()=>selected=selected===item.id?null:item.id}/>
  {/each}
</div>
<div class="quotas" aria-label={$i18n.text("Ваши квоты на ноде")}>
  <p class="node-host" title={nodeUrl}>{nodeUrl?nodeHost:$i18n.text(nodeHost)}</p>
  <div class="categories">
    <button type="button" class="category" class:active={selected==='files'} aria-expanded={selected==='files'} aria-controls={detailId} onclick={()=>selected=selected==='files'?null:'files'}>
      <span class="dot" class:warning={!!remote?.quota&&remote.quota.profileFiles>=remote.quota.profileFileLimit}></span>{$i18n.text("Квота файлов")} <strong>{snapshot?.quota?`${snapshot.quota.profileFiles}/${snapshot.quota.profileFileLimit}`:'?'}</strong>
    </button>
    <button type="button" class="category" class:active={selected==='messages'} aria-expanded={selected==='messages'} aria-controls={detailId} onclick={()=>selected=selected==='messages'?null:'messages'}>
      <span class="dot" class:warning={!!remote&&messageQuotaFull(remote.quota)}></span>{$i18n.text("Квота сообщений")} <strong>{messageQuota?`${messageQuota.profileMessages}/${messageQuota.profileMessageLimit}`:'?'}</strong>
    </button>
  </div>
</div>
{#if selected==='files'||selected==='messages'}
  <section id={detailId} class="details" aria-label={selected==='files'?$i18n.text("Квота файлов"):$i18n.text("Квота сообщений")}><NodeQuotaDetails {snapshot} {connected} kind={selected} /></section>
{:else if category && selected}
  <section id={detailId} class="details" aria-label={$i18n.text(category.label)}>
    <p>{displayed[selected]?$i18n.text(category.detail):$i18n.text(category.empty)}</p>
    {#if cleanup?.error&&(selected==='errors'&&cleanupErrors(cleanup)||selected==='retrying'&&cleanupWaiting(cleanup))}<p role="status">{$i18n.text(cleanupExplanation(cleanup))}</p>{/if}
    {#if selected==='waiting'&&snapshot}
      <p>{$i18n("m_995b35104382", {v0: (snapshot.messages), v1: (counts.waiting)})}
        {#if snapshot.messages>counts.waiting}{$i18n.text("Другие конверты могли быть созданы в другом сеансе или до восстановления истории. Они не удаляются автоматически.")}
        {:else if snapshot.messages<counts.waiting}{$i18n.text("Статусы истории ещё сверяются с нодой.")}{/if}</p>
    {/if}
    <div class="chat-list">
      {#each visible as c (c.peer)}
        {@const messages=c.groups[selected]}
        {@const issue=effectiveDeliveryIssue(messages[0])}
        <div class="chat-row">
          <button type="button" class="chat-link" onclick={()=>onOpen(c.peer,messages[0].id)} title={$i18n.text("Открыть сообщение в чате")}>
            <span>{c.name}{#if issue&&(selected==='errors'||selected==='retrying')}<small>{$i18n.text(deliveryIssues[issue][0])}</small>{/if}</span><strong>{messages.length}</strong><span aria-hidden="true">›</span>
          </button>
          {#if selected==='stopped'||selected==='expired'}<button type="button" class="clear-chat" onclick={()=>onClear(c.peer)} aria-label={$i18n("m_3c3f21842521", {v0: (c.name)})}>{$i18n.text("Скрыть")}</button>{/if}
        </div>
      {/each}
    </div>
    {#if (selected==='stopped'||selected==='expired') && counts.stopped+counts.expired}
      <div class="clear"><button type="button" onclick={()=>onClear()}>{$i18n.text("Скрыть все уведомления")}</button><small>{$i18n.text("Сообщения останутся в истории.")}</small></div>
    {/if}
  </section>
{:else}
  <p class="hint">{$i18n.text("Нажмите на показатель, чтобы увидеть подробности.")}</p>
{/if}
<style>
  .quotas{margin-top:14px;padding-top:10px;border-top:1px solid var(--line)}.node-host{margin:0 0 8px;font-size:12px;overflow-wrap:anywhere}
  .categories{display:flex;flex-wrap:wrap;gap:8px}
  .category{display:flex;align-items:center;gap:7px;min-height:38px;padding:8px 10px;border:1px solid var(--line);border-radius:16px;background:var(--surface-alt);font-size:13px;color:var(--text);cursor:pointer}
  .category strong{font-variant-numeric:tabular-nums}.category.active{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent)}
  .dot{flex:0 0 7px;width:7px;height:7px;border-radius:50%;background:var(--line-strong)}.dot.warning{background:var(--warning)}
  p{margin:12px 0;color:var(--muted);font-size:13px;line-height:1.5}.hint{margin-bottom:0}
  .chat-list{max-height:240px;overflow:auto}.chat-row{display:flex;align-items:center;gap:6px;border-top:1px solid var(--line)}
  .chat-link{display:flex;align-items:center;gap:10px;flex:1;min-width:0;min-height:44px;text-align:left;padding:8px;border:0;background:transparent;color:var(--text);font-size:14px}
  .chat-link span:first-child{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.chat-link strong{font-variant-numeric:tabular-nums;color:var(--muted)}
  .chat-link small{display:block;font-size:12px;color:var(--muted);white-space:normal}
  .clear-chat{font-size:12px;min-height:36px;padding:6px 8px}.clear{display:flex;align-items:flex-start;gap:6px;flex-direction:column;margin-top:12px}.clear button{min-height:38px;font-size:13px;padding:7px 10px}.clear small{color:var(--muted);font-size:12px}
</style>
