<script lang="ts">
  import { tr as i18n, locale } from '$lib/i18n/language';
  import { onMount } from 'svelte';
  import { nodeQueueCategories, nodeInteractionCounts, knownQueueEnvelopes, type NodeQueueCategory, type NodeQueueChat } from './node-queue-overview';
  import { messagePreview } from './chat-actions';
  import NodeQuotaDetails from '$lib/node/NodeQuotaDetails.svelte';
  import {freshQueueSnapshot,readMessageQuota,messageQuotaFull,type QueueSnapshot} from '$lib/node/queue-quota';
  import {cleanupErrors,cleanupWaiting,cleanupExplanation,type QueueCleanup} from '$lib/node/queue-cleanup';
  import {effectiveDeliveryIssue} from './node-transfer';
  import {deliveryIssues} from '$lib/application/delivery-issues';
  import QueueCategory from './QueueCategory.svelte';
  let { chats, onOpen, onClear, snapshot, connected=true, cleanup, nodeUrl='', onRefresh }:{chats:NodeQueueChat[];onOpen:(peer:string,id:string,group?:true)=>void;onClear:(peer?:string)=>void;snapshot?:QueueSnapshot;connected?:boolean;cleanup?:QueueCleanup;nodeUrl?:string;onRefresh?:()=>void}=$props();
  let selected=$state<NodeQueueCategory|'files'|'messages'|null>(null);
  let now=$state(Date.now());
  onMount(()=>{const timer=setInterval(()=>now=Date.now(),5000);return()=>clearInterval(timer);});
  const counts=$derived(nodeInteractionCounts(chats));
  const category=$derived(nodeQueueCategories.find(c=>c.id===selected));
  const visible=$derived(selected&&selected!=='files'&&selected!=='messages'?chats.filter(c=>c.groups[selected as NodeQueueCategory].length):[]);
  const detailId=$props.id();
  const nodeHost=$derived.by(()=>{try{return new URL(nodeUrl).host;}catch{return 'Нода доставки';}});
  const messageQuota=$derived(readMessageQuota(snapshot?.quota));
  const remote=$derived(connected&&freshQueueSnapshot(snapshot,now)?snapshot:undefined);
  const knownEnvelopes=$derived(knownQueueEnvelopes(chats));
  const groupsWaiting=$derived(chats.filter(chat=>chat.group).flatMap(chat=>chat.groups.waiting));
  const relayedWaiting=$derived(groupsWaiting.filter(item=>item.groupJob?.relay).length);
  const displayed=$derived({...counts,waiting:remote?.messages??counts.waiting,errors:counts.errors+cleanupErrors(cleanup),retrying:counts.retrying+cleanupWaiting(cleanup)});
</script>
<div class="categories" aria-label={$i18n.text("Взаимодействие с нодой")}>
  {#each nodeQueueCategories as item}
    <QueueCategory label={$i18n.text(item.label)} count={displayed[item.id]} tone={item.tone==='muted'?'neutral':item.tone} active={selected===item.id}
      controls={detailId} onToggle={()=>selected=selected===item.id?null:item.id}/>
  {/each}
</div>
<div class="quotas" aria-label={$i18n.text("Ваши квоты на ноде")}>
  <div class="node-heading">
    <p class="node-host" title={nodeUrl}>{nodeUrl?nodeHost:$i18n.text(nodeHost)}</p>
    {#if onRefresh && nodeUrl}<button type="button" class="refresh" onclick={onRefresh}>{$i18n.text('Обновить')}</button>{/if}
  </div>
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
    {#if selected==='waiting'}
      {#if remote}
        <p>{$i18n.text('Конверты профиля')} · {remote.messages}
          {#if remote.messages>knownEnvelopes}<br />{$i18n.text('Без привязки к истории')} · {remote.messages-knownEnvelopes}
          {:else if remote.messages<knownEnvelopes}<br />{$i18n.text("Статусы истории ещё сверяются с нодой.")}{/if}</p>
      {/if}
      {#if groupsWaiting.length}
        <dl class="group-counts">
          <div><dt>{$i18n.text('Свои сообщения в группах')}</dt><dd>{groupsWaiting.length-relayedWaiting}</dd></div>
          <div><dt>{$i18n.text('Переданы за участников группы')}</dt><dd>{relayedWaiting}</dd></div>
        </dl>
      {/if}
    {/if}
    <div class="chat-list">
      {#each visible as c (c.peer)}
        {@const messages=c.groups[selected]}
        {@const issue=effectiveDeliveryIssue(messages[0])}
        <div class="chat-row">
          <details>
            <summary class="chat-link">
            <span>{c.name}{#if issue&&(selected==='errors'||selected==='retrying')}<small>{$i18n.text(deliveryIssues[issue][0])}</small>{/if}</span><strong>{messages.length}</strong><span aria-hidden="true">›</span>
            </summary>
            <ul class="queue-messages">
              {#each messages as message (message.id)}
                {@const target=c.group?message.groupJob?.target:message.id}
                <li>
                  <button type="button" class="queue-message" disabled={!target} onclick={()=>target&&onOpen(c.peer,target,c.group)} title={$i18n.text("Открыть сообщение в чате")}>
                    <span>{messagePreview(message)||$i18n.text('Действие с сообщением')}</span>
                    {#if message.groupJob}
                      <small>
                        {#if message.groupJob.relay}{$i18n.text('Передано за участника группы')} · {/if}
                        {#if message.groupJob.envelopes}{$i18n.text('Конверты на ноде')} · {message.groupJob.envelopes} · {/if}
                        <time datetime={new Date(message.groupJob.expiresAt).toISOString()}>{$i18n.text('Хранится до')} {new Date(message.groupJob.expiresAt).toLocaleString($locale)}</time>
                      </small>
                    {/if}
                  </button>
                </li>
              {/each}
            </ul>
          </details>
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
  .node-heading{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:8px}.node-host{margin:0}.refresh{min-height:36px;padding:4px 8px;font-size:12px}
  .categories{display:flex;flex-wrap:wrap;gap:8px}
  .category{display:flex;align-items:center;gap:7px;min-height:38px;padding:8px 10px;border:1px solid var(--line);border-radius:16px;background:var(--surface-alt);font-size:13px;color:var(--text);cursor:pointer}
  .category strong{font-variant-numeric:tabular-nums}.category.active{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent)}
  .dot{flex:0 0 7px;width:7px;height:7px;border-radius:50%;background:var(--line-strong)}.dot.warning{background:var(--warning)}
  p{margin:12px 0;color:var(--muted);font-size:13px;line-height:1.5}.hint{margin-bottom:0}
  .chat-list{max-height:240px;overflow:auto}.chat-row{display:flex;align-items:center;gap:6px;border-top:1px solid var(--line)}
  .chat-link{display:flex;align-items:center;gap:10px;flex:1;min-width:0;min-height:44px;text-align:left;padding:8px;border:0;background:transparent;color:var(--text);font-size:14px}
  .chat-link span:first-child{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.chat-link strong{font-variant-numeric:tabular-nums;color:var(--muted)}
  .chat-link small{display:block;font-size:12px;color:var(--muted);white-space:normal}
  details{flex:1;min-width:0}summary{cursor:pointer;list-style:none}summary::-webkit-details-marker{display:none}details[open] summary span:last-child{transform:rotate(90deg)}
  .queue-messages{list-style:none;display:grid;gap:4px;padding:0 0 6px 10px;margin:0}.queue-message{display:grid;grid-template-columns:minmax(0,1fr);gap:4px;width:100%;min-height:44px;text-align:start;padding:6px 8px}.queue-message span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.queue-message small{overflow-wrap:anywhere;color:var(--muted)}
  .group-counts{margin:0 0 8px;font-size:13px;color:var(--muted)}.group-counts div{display:flex;justify-content:space-between;gap:8px;padding:4px 0}.group-counts dd{margin:0;font-variant-numeric:tabular-nums}
  .clear-chat{font-size:12px;min-height:36px;padding:6px 8px}.clear{display:flex;align-items:flex-start;gap:6px;flex-direction:column;margin-top:12px}.clear button{min-height:38px;font-size:13px;padding:7px 10px}.clear small{color:var(--muted);font-size:12px}
</style>
