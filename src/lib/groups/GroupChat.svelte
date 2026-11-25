<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { tr as i18n, locale } from '$lib/i18n/language';
  import CompactDialog from '$lib/application/CompactDialog.svelte';
  import Avatar from '$lib/chat/Avatar.svelte';
  import ChatIcon from '$lib/chat/ChatIcon.svelte';
  import HistoryDivider from '$lib/chat/HistoryDivider.svelte';
  import MessageCard from '$lib/chat/MessageCard.svelte';
  import MessageText from '$lib/chat/MessageText.svelte';
  import { createChatScroll } from '$lib/chat/chat-scroll';
  import { submitOnEnter } from '$lib/chat/conversation-list';
  import { GROUP_TEXT_BYTES, MAX_GROUP_MEMBERS } from './protocol';
  import { groupAudience, groupChronology, groupEntryUnread, type GroupEntry, type GroupRoom } from './storage';

  let { room, self, name, photo, connected, blocked, welcomeFailed, contacts, invite, exclude, leave, trackReads, markRead, accept, send, sync, direct, back }: {
    room: GroupRoom; self: string; name(peer: string): string; photo(peer: string): string;
    connected: ReadonlySet<string>; blocked: boolean; welcomeFailed: boolean;
    contacts: string[]; invite(peer: string): Promise<void>; exclude(peer: string): Promise<void>; leave(successor?: string): Promise<void>;
    trackReads: boolean; markRead(hashes: string[]): Promise<void>;
    accept(): Promise<void>; send(text: string, replyTo?: string): Promise<string>; sync(): void; direct(): void; back(): void;
  } = $props();
  let draft = $state(''), busy = $state(false), failed = $state(false);
  let transcript = $state<HTMLDivElement>();
  let composer = $state<HTMLTextAreaElement>();
  let replyTo = $state('');
  let copied = $state(''), highlighted = $state(''), copyFailed = $state(false);
  let copyTimer: ReturnType<typeof setTimeout>, highlightTimer: ReturnType<typeof setTimeout>;
  let jump = $state(false);
  const links = $derived(room.members.filter(peer => connected.has(peer)).length);
  let membersOpen = $state(false), confirming = $state<'leave' | 'exclude'>(), target = $state(''), invitee = $state('');
  const owner = $derived(room.owner === self);
  const others = $derived(room.members.filter(peer => peer !== self));
  const available = $derived(contacts.filter(peer => peer !== self && !room.members.includes(peer) && room.offer?.target !== peer));
  const needsSuccessor = $derived(owner && others.length > 0);
  const canInvite = $derived(owner && !!room.mls && !room.plan && room.members.length < MAX_GROUP_MEMBERS);

  function closeMembers() {
    if (busy) return;
    membersOpen = false;
    confirming = undefined;
    target = '';
    invitee = '';
    failed = false;
    queueRead();
  }

  function confirm(action: 'leave' | 'exclude', peer = '') {
    confirming = action;
    target = peer;
    failed = false;
  }

  function changeMembers() {
    void act(async () => {
      if (confirming === 'exclude') await exclude(target);
      else await leave(needsSuccessor ? target : undefined);
      confirming = undefined;
      target = '';
    });
  }
  const updatingKeys = $derived(!!room.plan && !room.plan.key);
  const draftBytes = $derived(new TextEncoder().encode(draft.trim()).length);
  const canSend = $derived(!busy && !blocked && !updatingKeys && !!draftBytes && draftBytes <= GROUP_TEXT_BYTES);
  const timeline = $derived(groupChronology(room.entries));
  const dates = $derived.by(() => {
    let latest = 0;
    return timeline.map(entry => {
      latest = Math.max(latest, entry.sentAt ?? 0);
      return latest ? new Date(latest).toDateString() : '';
    });
  });
  const replyCounts = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const entry of timeline) {
      if (entry.replyTo) counts.set(entry.replyTo, (counts.get(entry.replyTo) ?? 0) + 1);
    }
    return counts;
  });
  const byId = $derived(new Map(timeline.map(entry => [entry.id, entry])));
  const replyDraft = $derived(byId.get(replyTo));
  const unread = $derived(timeline.filter(entry => groupEntryUnread(entry, self)));
  const scrollMessages = $derived(timeline.map(entry => ({
    id: entry.id, direction: entry.from === self ? 'outgoing' as const : 'incoming' as const,
  })));
  const scroll = createChatScroll({
    activePeer: () => room.id, firstUnread: () => unread[0]?.id,
    onJump: visible => { jump = visible; },
  });
  const visible = new Set<string>();
  const deferredReads = new Set<string>();
  let mounted = false, readFrame = 0;
  onMount(() => { mounted = true; });

  function queueRead() {
    if (readFrame || !trackReads || blocked || !visible.size) return;
    readFrame = requestAnimationFrame(() => {
      readFrame = 0;
      if (!trackReads || blocked || document.hidden || !document.hasFocus() || document.querySelector('dialog[open]')) return;
      const hashes = unread.filter(entry => visible.has(entry.hash) && !deferredReads.has(entry.hash)).map(entry => entry.hash);
      if (hashes.length) void markRead(hashes).catch(() => {});
    });
  }

  function reviewHistory() {
    deferredReads.clear();
    queueRead();
  }

  $effect(() => { if (trackReads && !blocked) queueRead(); });
  onDestroy(() => {
    if (readFrame) cancelAnimationFrame(readFrame);
    clearTimeout(copyTimer);
    clearTimeout(highlightTimer);
  });

  function observeRead(node: HTMLElement, message: GroupEntry) {
    const { hash } = message;
    // An older unread arriving in an open transcript should survive automatic
    // layout and scrolling. Let an intentional visit to the history read it.
    if (mounted && groupEntryUnread(message, self)) {
      const index = timeline.findIndex(entry => entry.id === message.id);
      if (index !== -1 && timeline.slice(index + 1).some(entry => !groupEntryUnread(entry, self))) deferredReads.add(hash);
    }
    const root = node.closest('.message-scroll');
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && entry.intersectionRect.height >=
        Math.min(entry.boundingClientRect.height, root?.clientHeight ?? window.innerHeight) * 0.5) {
        visible.add(hash);
        queueRead();
      } else visible.delete(hash);
    }, { threshold:[0, 0.01, 0.05, 0.1, 0.25, 0.5, 1] });
    observer.observe(node);
    return { destroy() { observer.disconnect(); visible.delete(hash); deferredReads.delete(hash); } };
  }

  function jumpToMessage() {
    if (!transcript) return;
    const target = unread[0];
    if (target) {
      const node = transcript.querySelector<HTMLElement>('[data-chat-message-id="' + target.id + '"]');
      if (node) transcript.scrollTop += node.getBoundingClientRect().top - transcript.getBoundingClientRect().top - 8;
      reviewHistory();
    } else transcript.scrollTop = transcript.scrollHeight;
  }

  function startReply(message: GroupEntry) {
    replyTo = message.id;
    composer?.focus({ preventScroll:true });
  }

  function revealMessage(id: string, behavior: ScrollBehavior) {
    const node = transcript?.querySelector<HTMLElement>('[data-chat-message-id="' + id + '"]');
    if (!transcript || !node) return;
    const offset = node.getBoundingClientRect().top - transcript.getBoundingClientRect().top;
    transcript.scrollTo({ top:transcript.scrollTop + offset - Math.max(0, (transcript.clientHeight - node.offsetHeight) / 2), behavior });
  }

  function showOriginal(id: string) {
    revealMessage(id, 'smooth');
    reviewHistory();
    highlighted = id;
    clearTimeout(highlightTimer);
    highlightTimer = setTimeout(() => { highlighted = ''; }, 1800);
  }

  async function copyText(message: GroupEntry) {
    copyFailed = false;
    try {
      await navigator.clipboard.writeText(message.text);
      if (!composer?.isConnected) return;
      copied = message.id;
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => { copied = ''; }, 1800);
    } catch { copyFailed = true; }
  }

  async function act(work: () => Promise<void>) {
    if (busy || blocked) return;
    busy = true; failed = false;
    try { await work(); } catch { failed = true; }
    finally { busy = false; }
  }

  function submit() {
    if (!canSend) return;
    const value = draft;
    const original = replyDraft?.id;
    void act(async () => {
      const id = await send(value, original);
      if (replyTo === original) replyTo = '';
      if (draft === value) draft = '';
      await tick();
      requestAnimationFrame(() => revealMessage(id, 'instant'));
    });
  }
</script>

<svelte:window onfocus={queueRead} />
<svelte:document onvisibilitychange={queueRead} />

<div class="chat-heading">
  <button type="button" class="chat-back" onclick={back} aria-label={$i18n.text('Все чаты')}>←</button>
  <div class="peer-heading">
    <span class="local-agent-avatar" aria-hidden="true"><ChatIcon name="group" /></span>
    <span><strong>{room.title}</strong><small class="peer-status">{$i18n.text('Участники группы')} · {room.members.length}</small>
      <small class="peer-status">{$i18n.text('Прямые соединения')} · {links}</small></span>
  </div>
  {#if !links}
    <button type="button" class="select-messages-button" onclick={direct} disabled={blocked}
      title={$i18n.text('Прямое подключение')} aria-label={$i18n.text('Прямое подключение')}><ChatIcon name="qr" /></button>
  {/if}
  {#if room.mls || !owner}
    <button type="button" class="select-messages-button" onclick={() => { membersOpen = true; failed = false; }} disabled={blocked}
      title={$i18n.text('Участники группы')} aria-label={$i18n.text('Участники группы')}><ChatIcon name="group" /></button>
  {/if}
  <button type="button" class="select-messages-button" onclick={sync} disabled={blocked}
    title={$i18n.text(room.mls ? 'Догрузить сообщения' : 'Обновить')}
    aria-label={$i18n.text(room.mls ? 'Догрузить сообщения' : 'Обновить')}><ChatIcon name="repeat" /></button>
</div>

<div class="message-history">
  <div class="message-scroll" bind:this={transcript} use:scroll={{ peer: room.id, messages: scrollMessages, openToken: 0 }}
    role="log" aria-label={$i18n.text('Переписка группы')} onwheel={reviewHistory} onpointerdown={reviewHistory}>
    {#if room.mls}
      {#each timeline as message, i (message.id)}
        {@const original = message.replyTo ? byId.get(message.replyTo) : undefined}
        {@const delivered = new Set([
          ...(message.receipts ?? []).map(receipt => receipt.by),
          ...Object.keys(message.nodeStatus ?? {}).filter(peer => message.nodeStatus?.[peer] === 'delivered'),
        ])}
        {@const stored = Object.keys(message.nodeStatus ?? {}).filter(peer => message.nodeStatus?.[peer] === 'stored' && !delivered.has(peer)).length}
        {@const recipients = groupAudience(room, message).length - 1}
        {@const read = message.receipts?.filter(receipt => receipt.state === 'read').length ?? 0}
        {@const sent = message.sentAt === undefined ? undefined : new Date(message.sentAt)}
        {@const dateMoved = sent && dates[i] !== sent.toDateString()}
        {@const replies = replyCounts.get(message.id) ?? 0}
        {#if sent && dates[i] !== dates[i - 1]}
          <HistoryDivider timestamp={message.sentAt} />
        {/if}
        <div data-chat-message-id={message.id} use:observeRead={message}>
          <MessageCard outgoing={message.from === self} preview={message.text} highlighted={highlighted === message.id}>
            <div class="message-header">
              <Avatar accountId={message.from} photo={photo(message.from)} size={18} />
              <strong class="message-author">{message.from === self ? $i18n.text('Вы') : name(message.from)}</strong>
              {#if sent}
                <time datetime={sent.toISOString()} title={sent.toLocaleString($locale)}>{sent.toLocaleString($locale, { hour:'2-digit', minute:'2-digit', ...(dateMoved ? {day:'numeric', month:'short'} : {}) })}</time>
              {/if}
              {#if groupEntryUnread(message, self)}
                <span class="unread-message" role="img" aria-label={$i18n.text('Непрочитанное сообщение')} title={$i18n.text('Непрочитанное сообщение')}></span>
              {/if}
              <button class="quick-reply" type="button" onclick={() => startReply(message)} disabled={blocked || busy}
                aria-label={$i18n.text('Ответить на сообщение')} title={$i18n.text('Ответить')}>↩</button>
              <button class="quick-copy" type="button" onclick={() => void copyText(message)}
                aria-label={$i18n.text('Скопировать содержимое сообщения')} title={$i18n.text('Скопировать содержимое')}>{copied === message.id ? '✓' : '⧉'}</button>
              {#if copied === message.id}<span class="copy-feedback" role="status">{$i18n.text('Текст скопирован.')}</span>{/if}
            </div>
            {#if original}
              <button class="reply-preview" type="button" onclick={() => showOriginal(original.id)} title={$i18n.text('Перейти к исходному сообщению')}>
                <small>↩ {original.from === self ? $i18n.text('Вы') : name(original.from)}</small>
                <span class="quote-text">{original.text}</span>
              </button>
            {:else if message.replyTo}
              <div class="reply-preview"><small>↩ {$i18n.text('Исходное сообщение удалено или отсутствует на этом устройстве.')}</small></div>
            {/if}
            <MessageText text={message.text} />
            <div class="message-actions">
              {#if replies}<small class="reply-count" title={$i18n.text('Ответы в этой переписке')}>↩ {replies}</small>{/if}
              {#if stored}<span>{$i18n.text('На ноде')} {stored}/{recipients}</span>{/if}
              <span>{$i18n.text('Доставлено')} {delivered.size}/{recipients}</span>
              <span>{$i18n.text('Прочитали')} {read}/{recipients}</span>
            </div>
          </MessageCard>
        </div>
      {:else}<p class="empty">{$i18n.text('Пока нет сообщений.')}</p>{/each}
    {:else}
      <div class="join-state">
        {#if room.owner === self}
          <p role="status">{$i18n.text('Чат откроется, когда все приглашённые примут приглашение.')} · {Object.keys(room.keys).length}/{room.members.length - 1}</p>
        {:else if room.draft}
          <p role="status">{$i18n.text('Приглашение принято. Ждём ключи от участников группы.')}</p>
          {#if welcomeFailed}<p role="alert">{$i18n.text('Не удалось применить ключи группы. Нажмите «Обновить», чтобы запросить их снова.')}</p>{/if}
        {:else}
          <p>{name(room.owner)} · {$i18n.text('Приглашение в закрытую группу')}</p>
          <button type="button" class="primary" disabled={busy || blocked} onclick={() => void act(accept)}>{$i18n.text('Вступить в группу')}</button>
        {/if}
        {#if !links}<p class="empty">{$i18n.text('Для поиска участников нужен общий сигналинг или прямое подключение по QR.')}</p>{/if}
      </div>
    {/if}
  </div>
  {#if room.mls && (jump || unread.length)}
    {@const label = unread.length ? $i18n.text('К непрочитанным сообщениям') : $i18n.text('К последним сообщениям')}
    <button type="button" class="jump-down" onclick={jumpToMessage}
      aria-label={unread.length ? label + ' · ' + unread.length : label} title={label}>
      <ChatIcon name={unread.length ? 'chat' : 'order-down'} />
      {#if unread.length}<span class="jump-count" aria-hidden="true">{unread.length > 99 ? '99+' : unread.length}</span>{/if}
    </button>
  {/if}
</div>

{#if copyFailed}<p role="alert">{$i18n.text('Браузер не разрешил копирование. Можно выделить текст вручную.')}</p>{/if}
{#if failed && !membersOpen}<p role="alert">{$i18n.text('Действие с группой не выполнено. Проверьте подключение и попробуйте снова.')}</p>{/if}
{#if room.mls}
  {#if updatingKeys}
    <small class="membership-status" role="status">{$i18n.text('Получаем обновление ключей группы. Пока можно набрать сообщение.')}</small>
  {/if}
  {#if replyDraft}
    <div class="composer-reply">
      <span>↩ {replyDraft.from === self ? $i18n.text('Вы') : name(replyDraft.from)} · {replyDraft.text}</span>
      <button type="button" onclick={() => { replyTo = ''; composer?.focus(); }} aria-label={$i18n.text('Отменить ответ')}>✕</button>
    </div>
  {/if}
  {#if draftBytes > GROUP_TEXT_BYTES}
    <small class="membership-status" role="status">{$i18n.text('Сообщение слишком длинное для этого чата.')}</small>
  {/if}
  <form class="composer" onsubmit={event => { event.preventDefault(); submit(); }}>
    <textarea rows="1" enterkeyhint="send" bind:this={composer} bind:value={draft} maxlength={GROUP_TEXT_BYTES} placeholder={$i18n.text('Сообщение...')}
      aria-label={$i18n.text('Сообщение группе')} onkeydown={event => {
        if (!submitOnEnter(event) || event.keyCode === 229) return;
        event.preventDefault();
        if (!event.repeat) event.currentTarget.form?.requestSubmit();
      }}></textarea>
    <button type="submit" class="primary send-button" disabled={!canSend} aria-label={$i18n.text('Отправить сообщение')}>
      <ChatIcon name="send" />
    </button>
  </form>
{/if}

{#if membersOpen}
  <CompactDialog title={$i18n.text('Участники группы')} literalTitle onClose={closeMembers}>
    {#if confirming}
      {#if confirming === 'exclude'}
        <p>{$i18n.text('Исключить участника из группы?')} <strong>{name(target)}</strong></p>
      {:else}
        <p>{$i18n.text('Выйти из группы?')}</p>
        {#if needsSuccessor}
          <label for="group-successor">{$i18n.text('Кому передать управление группой?')}</label>
          <select id="group-successor" bind:value={target} disabled={busy}>
            <option value="">{$i18n.text('Выбрать участника')}</option>
            {#each others as peer (peer)}<option value={peer}>{name(peer)}</option>{/each}
          </select>
        {/if}
      {/if}
      <div class="member-actions">
        <button type="button" class="primary" onclick={changeMembers}
          disabled={busy || blocked || confirming === 'leave' && needsSuccessor && !target}>
          {confirming === 'exclude' ? $i18n.text('Исключить') : $i18n.text('Выйти из группы')}
        </button>
        <button type="button" disabled={busy} onclick={() => { confirming = undefined; failed = false; }}>{$i18n.text('Отмена')}</button>
      </div>
    {:else}
      <ul class="members">
        {#each room.members as peer (peer)}
          <li>
            <Avatar accountId={peer} photo={photo(peer)} size={28} />
            <span>{peer === self ? $i18n.text('Вы') : name(peer)}
              {#if peer === room.owner}<small>{$i18n.text('Администратор')}</small>{/if}
            </span>
            {#if owner && peer !== self && room.mls}
              <button type="button" disabled={busy || blocked || !!room.plan} onclick={() => confirm('exclude', peer)}>{$i18n.text('Исключить')}</button>
            {/if}
          </li>
        {/each}
      </ul>
      {#if canInvite}
        {#if room.offer}
          <small class="membership-status">{$i18n.text('Приглашение отправлено')} · {name(room.offer.target)}</small>
        {/if}
        {#if available.length}
          <form class="member-actions" onsubmit={event => {
            event.preventDefault();
            if (invitee) void act(async () => { await invite(invitee); invitee = ''; });
          }}>
            <select bind:value={invitee} disabled={busy} aria-label={$i18n.text('Выбрать контакт')}>
              <option value="">{$i18n.text('Выбрать контакт')}</option>
              {#each available as peer (peer)}<option value={peer}>{name(peer)}</option>{/each}
            </select>
            <button type="submit" disabled={busy || blocked || !invitee}>{$i18n.text('Пригласить')}</button>
          </form>
        {/if}
      {/if}
      <button type="button" disabled={busy || blocked || owner && !!room.plan} onclick={() => confirm('leave')}>{$i18n.text('Выйти из группы')}</button>
    {/if}
    {#if failed}<p role="alert">{$i18n.text('Действие с группой не выполнено. Проверьте подключение и попробуйте снова.')}</p>{/if}
  </CompactDialog>
{/if}

<style>
  .peer-heading strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .peer-heading .local-agent-avatar { display:grid; }
  .reply-count { margin-right:auto; font-size:inherit; }
  .quote-text { overflow:hidden; display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; line-clamp:2; }
  .unread-message { flex-shrink:0; width:7px; height:7px; border-radius:50%; background:var(--accent); }
  .empty, .join-state { color:var(--muted); font-size:13px; }
  .join-state p:first-child, .empty { margin-top:0; }
  .members { display:grid; gap:8px; list-style:none; padding:0; max-height:42dvh; overflow:auto; }
  .members li { display:flex; align-items:center; gap:8px; min-width:0; }
  .members li span { flex:1; min-width:0; overflow-wrap:anywhere; }
  .members li small { display:block; color:var(--muted); }
  .member-actions { display:flex; flex-wrap:wrap; gap:8px; margin:12px 0; }
  select { max-width:100%; min-height:40px; }
  .membership-status { display:block; color:var(--muted); }
  .join-state [role="alert"] { color:var(--danger); }
</style>
