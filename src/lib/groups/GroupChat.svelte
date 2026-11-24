<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import Avatar from '$lib/chat/Avatar.svelte';
  import ChatIcon from '$lib/chat/ChatIcon.svelte';
  import MessageCard from '$lib/chat/MessageCard.svelte';
  import MessageText from '$lib/chat/MessageText.svelte';
  import { createChatScroll } from '$lib/chat/chat-scroll';
  import { submitOnEnter } from '$lib/chat/conversation-list';
  import { GROUP_TEXT_BYTES } from './protocol';
  import type { GroupRoom } from './storage';

  let { room, self, name, photo, connected, blocked, welcomeFailed, accept, send, sync, direct, back }: {
    room: GroupRoom; self: string; name(peer: string): string; photo(peer: string): string;
    connected: ReadonlySet<string>; blocked: boolean; welcomeFailed: boolean;
    accept(): Promise<void>; send(text: string): Promise<void>; sync(): void; direct(): void; back(): void;
  } = $props();
  let draft = $state(''), busy = $state(false), failed = $state(false);
  let transcript = $state<HTMLDivElement>();
  let jump = $state(false), incoming = $state(0);
  const links = $derived(room.members.filter(peer => connected.has(peer)).length);
  const draftBytes = $derived(new TextEncoder().encode(draft.trim()).length);
  const canSend = $derived(!busy && !blocked && !!draftBytes && draftBytes <= GROUP_TEXT_BYTES);
  const scrollMessages = $derived(room.entries.map(entry => ({
    id: entry.id, direction: entry.from === self ? 'outgoing' as const : 'incoming' as const,
  })));
  const scroll = createChatScroll({
    activePeer: () => room.id, firstUnread: () => undefined,
    onJump: (visible, count) => { jump = visible; incoming = count; },
  });

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

<div class="chat-heading">
  <button type="button" class="chat-back" onclick={back} aria-label={$i18n.text('Все чаты')}>←</button>
  <div class="peer-heading">
    <span class="local-agent-avatar" aria-hidden="true"><ChatIcon name="group" /></span>
    <span><strong>{room.title}</strong><small class="peer-status">MLS · {$i18n.text('Прямые соединения')} {links}/{room.members.length - 1}</small></span>
  </div>
  {#if !links}
    <button type="button" class="select-messages-button" onclick={direct} disabled={blocked}
      title={$i18n.text('Прямое подключение')} aria-label={$i18n.text('Прямое подключение')}><ChatIcon name="qr" /></button>
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
        <div data-chat-message-id={message.id}>
          <MessageCard outgoing={message.from === self} preview={message.text}>
            <div class="message-header">
              <Avatar accountId={message.from} photo={photo(message.from)} size={18} />
              <strong class="message-author">{message.from === self ? $i18n.text('Вы') : name(message.from)}</strong>
            </div>
            <MessageText text={message.text} />
            {#if message.from === self}
              <div class="message-actions">
                {#if message.receivedBy?.length}
                  {$i18n.text('Получили участники')} · {message.receivedBy.length}/{room.members.length - 1}
                {:else}
                  {$i18n.text('Сохранено на этом устройстве')}
                {/if}
              </div>
            {/if}
          </MessageCard>
        </div>
      {:else}<p class="empty">{$i18n.text('Пока нет сообщений.')}</p>{/each}
    {:else}
      <div class="join-state">
        {#if room.owner === self}
          <p role="status">{$i18n.text('Чат откроется, когда все приглашённые примут приглашение.')} · {Object.keys(room.keys).length}/{room.members.length - 1}</p>
        {:else if room.draft}
          <p role="status">{$i18n.text('Приглашение принято. Ждём ключи группы от создателя.')}</p>
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

{#if failed}<p role="alert">{$i18n.text('Действие с группой не выполнено. Проверьте подключение и попробуйте снова.')}</p>{/if}
{#if room.mls}
  <form class="composer" onsubmit={event => { event.preventDefault(); submit(); }}>
    <textarea rows="1" bind:value={draft} maxlength={GROUP_TEXT_BYTES} placeholder={$i18n.text('Сообщение...')}
      aria-label={$i18n.text('Сообщение группе')} onkeydown={event => {
        if (submitOnEnter(event)) { event.preventDefault(); submit(); }
      }}></textarea>
    <button type="submit" class="primary send-button" disabled={!canSend} aria-label={$i18n.text('Отправить сообщение')}>
      <ChatIcon name="send" />
    </button>
  </form>
{/if}

<style>
  .peer-heading strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .peer-heading .local-agent-avatar { display:grid; }
  .empty, .join-state { color:var(--muted); font-size:13px; }
  .join-state p:first-child, .empty { margin-top:0; }
  .join-state [role="alert"] { color:var(--danger); }
</style>
