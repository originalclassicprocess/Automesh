<script lang="ts">
  import { onDestroy } from 'svelte';
  import { tr as i18n } from '$lib/i18n/language';
  import CompactDialog from '$lib/application/CompactDialog.svelte';
  import Avatar from '$lib/chat/Avatar.svelte';
  import ChatIcon from '$lib/chat/ChatIcon.svelte';
  import MessageCard from '$lib/chat/MessageCard.svelte';
  import MessageText from '$lib/chat/MessageText.svelte';
  import { createChatScroll } from '$lib/chat/chat-scroll';
  import { submitOnEnter } from '$lib/chat/conversation-list';
  import { GROUP_TEXT_BYTES, MAX_GROUP_MEMBERS } from './protocol';
  import { groupAudience, type GroupRoom } from './storage';

  let { room, self, name, photo, connected, blocked, welcomeFailed, contacts, invite, exclude, leave, readEnabled, markRead, accept, send, sync, direct, back }: {
    room: GroupRoom; self: string; name(peer: string): string; photo(peer: string): string;
    connected: ReadonlySet<string>; blocked: boolean; welcomeFailed: boolean;
    contacts: string[]; invite(peer: string): Promise<void>; exclude(peer: string): Promise<void>; leave(successor?: string): Promise<void>;
    readEnabled: boolean; markRead(hashes: string[]): Promise<void>;
    accept(): Promise<void>; send(text: string): Promise<void>; sync(): void; direct(): void; back(): void;
  } = $props();
  let draft = $state(''), busy = $state(false), failed = $state(false);
  let transcript = $state<HTMLDivElement>();
  let jump = $state(false), incoming = $state(0);
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
  const scrollMessages = $derived(room.entries.map(entry => ({
    id: entry.id, direction: entry.from === self ? 'outgoing' as const : 'incoming' as const,
  })));
  const scroll = createChatScroll({
    activePeer: () => room.id, firstUnread: () => undefined,
    onJump: (visible, count) => { jump = visible; incoming = count; },
  });
  const visible = new Set<string>();
  let readFrame = 0;
  function queueRead() {
    if (readFrame || !readEnabled || blocked || !visible.size) return;
    readFrame = requestAnimationFrame(() => {
      readFrame = 0;
      if (!readEnabled || blocked || document.hidden || !document.hasFocus() || document.querySelector('dialog[open]')) return;
      const hashes = room.entries.filter(entry => entry.from !== self && visible.has(entry.hash) &&
        !entry.receipts?.some(receipt => receipt.by === self && receipt.state === 'read')).map(entry => entry.hash);
      if (hashes.length) void markRead(hashes).catch(() => {});
    });
  }
  $effect(() => { if (readEnabled && !blocked) queueRead(); });
  onDestroy(() => { if (readFrame) cancelAnimationFrame(readFrame); });

  function observeRead(node: HTMLElement, hash: string) {
    const root = node.closest('.message-scroll');
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && entry.intersectionRect.height >=
        Math.min(entry.boundingClientRect.height, root?.clientHeight ?? window.innerHeight) * 0.5) {
        visible.add(hash);
        queueRead();
      } else visible.delete(hash);
    }, { threshold:[0, 0.01, 0.05, 0.1, 0.25, 0.5, 1] });
    observer.observe(node);
    return { destroy() { observer.disconnect(); visible.delete(hash); } };
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
    void act(async () => {
      if (transcript) transcript.scrollTop = transcript.scrollHeight;
      await send(value);
      if (draft === value) draft = '';
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
    role="log" aria-label={$i18n.text('Переписка группы')}>
    {#if room.mls}
      {#each room.entries as message (message.id)}
        {@const delivered = message.receipts?.length ?? 0}
        {@const recipients = groupAudience(room, message).length - 1}
        {@const read = message.receipts?.filter(receipt => receipt.state === 'read').length ?? 0}
        <div data-chat-message-id={message.id} use:observeRead={message.hash}>
          <MessageCard outgoing={message.from === self} preview={message.text}>
            <div class="message-header">
              <Avatar accountId={message.from} photo={photo(message.from)} size={18} />
              <strong class="message-author">{message.from === self ? $i18n.text('Вы') : name(message.from)}</strong>
            </div>
            <MessageText text={message.text} />
            <div class="message-actions">
              <span>{$i18n.text('Доставлено')} {delivered}/{recipients}</span>
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
  {#if jump && room.mls}
    <button type="button" class="jump-down" onclick={() => { if (transcript) transcript.scrollTop = transcript.scrollHeight; }}
      aria-label={`${$i18n.text('К последним сообщениям')}${incoming ? ` · +${incoming}` : ''}`} title={$i18n.text('К последним сообщениям')}>
      <ChatIcon name="order-down" />
      {#if incoming}<span class="jump-count" aria-hidden="true">{incoming > 99 ? '99+' : incoming}</span>{/if}
    </button>
  {/if}
</div>

{#if failed && !membersOpen}<p role="alert">{$i18n.text('Действие с группой не выполнено. Проверьте подключение и попробуйте снова.')}</p>{/if}
{#if room.mls}
  {#if updatingKeys}
    <small class="membership-status" role="status">{$i18n.text('Обновляем ключи группы. Если кто-то не на связи, обновление продолжится автоматически после подключения.')}</small>
  {/if}
  <form class="composer" onsubmit={event => { event.preventDefault(); submit(); }}>
    <textarea rows="1" disabled={updatingKeys} bind:value={draft} maxlength={GROUP_TEXT_BYTES} placeholder={$i18n.text('Сообщение...')}
      aria-label={$i18n.text('Сообщение группе')} onkeydown={event => {
        if (submitOnEnter(event)) { event.preventDefault(); submit(); }
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
