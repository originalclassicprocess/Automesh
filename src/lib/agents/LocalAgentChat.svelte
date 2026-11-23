<script lang="ts">
  import { tick } from 'svelte';
  import { tr as i18n } from '$lib/i18n/language';
  import ChatIcon from '$lib/chat/ChatIcon.svelte';
  import MessageCard from '$lib/chat/MessageCard.svelte';
  import MessageText from '$lib/chat/MessageText.svelte';
  import { submitOnEnter } from '$lib/chat/conversation-list';
  import { MAX_LOCAL_AGENT_PROMPT, type LocalAgentMessage } from './local-chat';
  import type { FileModel } from './file-models';

  let { messages, draft = $bindable(''), ready, blocked, working, notice, models, modelId, builtInModel,
    onModelChange, onBack, onConfigure, onSend, onStop }:
    { messages: LocalAgentMessage[]; draft: string; ready: boolean; blocked: boolean; working: boolean; notice: string;
      models: FileModel[]; modelId: string; builtInModel: string; onModelChange: (id: string) => void;
      onBack: () => void; onConfigure: () => void; onSend: (retry?: boolean) => void; onStop: () => void } = $props();

  let transcript = $state<HTMLDivElement>();
  let follow = true;
  const canSend = $derived(ready && !blocked && !!draft.trim());
  const time = (timestamp: number) => new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  $effect(() => {
    const scroll = transcript;
    void messages.at(-1)?.id;
    if (scroll && follow) void tick().then(() => { if (scroll.isConnected && follow) scroll.scrollTop = scroll.scrollHeight; });
  });

  function send() {
    if (!canSend) return;
    follow = true;
    onSend();
  }
</script>

<div class="chat-heading">
  <button type="button" class="chat-back" onclick={onBack} aria-label={$i18n.text('Все чаты')}>←</button>
  <span class="local-agent-avatar" aria-hidden="true">AI</span>
  <div class="title">
    <strong>{$i18n.text('ИИ-чат')}</strong>
    {#if models.length || builtInModel || modelId}
      <select class="model-picker" aria-label={$i18n.text('Модель ИИ-чата')} disabled={blocked} value={modelId}
        onchange={event => {
          const id = event.currentTarget.value;
          event.currentTarget.value = modelId;
          onModelChange(id);
        }}>
        <option value="" disabled={!builtInModel}>{builtInModel || $i18n.text('Выберите модель')}</option>
        {#if modelId && !models.some(model => model.id === modelId)}<option value={modelId} disabled>{$i18n.text('Файл модели недоступен')}</option>{/if}
        {#each models as model (model.id)}<option value={model.id}>{model.name}</option>{/each}
      </select>
    {:else}
      <small>{$i18n.text('На этом устройстве')}</small>
    {/if}
  </div>
</div>

<div class="message-scroll" bind:this={transcript} role="log" aria-label={$i18n.text('ИИ-чат')}
  onscroll={event => { const el = event.currentTarget; follow = el.scrollHeight - el.clientHeight - el.scrollTop < 64; }}>
  {#each messages as message (message.id)}
    <MessageCard outgoing={message.role === 'user'} preview={message.content}>
      <div class="message-header">
        <strong class="message-author">{$i18n.text(message.role === 'user' ? 'Вы' : 'ИИ')}</strong>
        <time datetime={new Date(message.timestamp).toISOString()}>{time(message.timestamp)}</time>
      </div>
      <MessageText text={message.content} />
    </MessageCard>
  {:else}
    {#if ready}<p class="empty">{$i18n.text('Напишите сообщение, чтобы начать диалог с ИИ.')}</p>{/if}
  {/each}
</div>

{#if !ready}
  <div class="status-row">
    {#if notice}<span role="status">{$i18n.text(notice)}</span>{/if}
    <span>{$i18n.text('Выберите и включите модель, которая запускается в браузере.')}</span>
    <button type="button" onclick={onConfigure} disabled={blocked}>{$i18n.text('Настроить ИИ')}</button>
  </div>
{:else}
  {#if working || notice || messages.at(-1)?.role === 'user'}
    <div class="status-row" role="status">
      {#if working}
        <span>{$i18n.text('ИИ готовит ответ…')}</span>
        <button type="button" onclick={onStop}>{$i18n.text('Отменить запрос ИИ')}</button>
      {:else}
        {#if notice}<span>{$i18n.text(notice)}</span>{/if}
        {#if messages.at(-1)?.role === 'user'}
          <button type="button" disabled={blocked} onclick={() => onSend(true)}>{$i18n.text('Повторить запрос ИИ')}</button>
        {/if}
      {/if}
    </div>
  {/if}
  <form class="composer" onsubmit={event => { event.preventDefault(); send(); }}>
    <div class="composer-field">
      <textarea rows="2" bind:value={draft} maxlength={MAX_LOCAL_AGENT_PROMPT} placeholder={$i18n.text('Сообщение...')}
        aria-label={$i18n.text('Сообщение для ИИ')} onkeydown={event => {
          if (submitOnEnter(event)) { event.preventDefault(); send(); }
        }}></textarea>
    </div>
    <button type="submit" class="primary send-button" disabled={!canSend} aria-label={$i18n.text('Отправить сообщение')}>
      <ChatIcon name="send" />
    </button>
  </form>
{/if}

<style>
  .title { display:grid; flex:1; min-width:0; }
  .model-picker { min-width:0; max-width:100%; justify-self:start; text-overflow:ellipsis; font-size:13px; padding:3px 6px; }
  .title small, .empty, .status-row { color:var(--muted); font-size:13px; }
  .empty { margin:0; }
  .status-row { display:flex; align-items:center; flex-wrap:wrap; gap:8px; padding:6px 0; }
  .status-row button { font-size:13px; }
  .composer { margin-top:6px; }
  textarea { width:100%; box-sizing:border-box; resize:vertical; max-height:140px; }
</style>
