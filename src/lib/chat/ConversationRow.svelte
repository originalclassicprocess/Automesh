<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import Avatar from './Avatar.svelte';
  import ChatActivity from './ChatActivity.svelte';
  import ChatIcon from './ChatIcon.svelte';
  import ChannelSecurity from '$lib/radio/ChannelSecurity.svelte';
  import type {ChannelEncryption} from '$lib/radio/native-channels';
  import { conversationPreview } from './conversation-list';
  import type { Conversation } from './session-chats';
  let { accountId, name, photo = '', conversation, self = false, active = false, onOpen, radio }: {
    accountId: string; name: string; photo?: string; conversation: Conversation; self?: boolean; active?: boolean; onOpen(): void;radio?:{encryption?:ChannelEncryption;preview:string;status?:string};
  } = $props();
  const contactLabel = $derived(conversation.contact === 'pending' ? 'Запрос' : conversation.contact === 'outgoing' ? 'Ждём принятия' : conversation.contact === 'blocked' ? 'Заблокирован' : '');
</script>
<button type="button" class="conversation-row" aria-current={active ? 'true' : undefined} title={accountId} onclick={onOpen}>
  <span class="row-avatar">{#if radio}<span class="radio-avatar"><ChatIcon name="radio"/></span>{:else}<Avatar {accountId} {photo} size={32} />{/if}
    {#if !self&&!radio}<span class="presence" class:connected={conversation.connection === 'connected'} title={conversation.connection === 'connected' ? $i18n.text("На связи") : conversation.connection === 'connecting' ? $i18n.text("Подключаемся") : $i18n.text("Не в сети")}></span>{/if}
  </span>
  <span class="row-content">
    <span class="row-heading"><span class="row-name">{name}</span>{#if radio}<span class="radio-badge">LoRa</span><ChannelSecurity value={radio.encryption} compact/>{/if}
      {#if self}<span class="saved" aria-label={$i18n.text("Сохранённые")}>🔖</span>{/if}
      {#if conversation.unread > 0}<span class="row-unread" aria-label={$i18n("m_fe510dbd63e0", {v0: (conversation.unread)})}>{conversation.unread > 99 ? '99+' : conversation.unread}</span>{/if}
    </span>
    <span class="chat-preview">{radio?.preview||conversationPreview(conversation,$i18n.text)}</span>
    {#if contactLabel}<span class="contact-label">{$i18n.text(contactLabel)}</span>{/if}
    {#if radio}{#if radio.status}<span class="contact-label">{$i18n.text(radio.status)}</span>{/if}{:else}<ChatActivity messages={conversation.messages} compact />{/if}
  </span>
</button>
<style>
  .radio-avatar{display:grid;place-items:center;width:32px;height:32px;border-radius:8px;background:var(--accent-soft);color:var(--accent)}.radio-badge{font-size:10px;color:var(--muted);flex-shrink:0}
  .conversation-row{display:flex;align-items:center;gap:9px;min-height:64px}
  .row-avatar{position:relative;display:flex;flex-shrink:0;align-self:flex-start;margin-top:4px}
  .presence{position:absolute;bottom:-2px;right:-2px;width:9px;height:9px;border:2px solid var(--surface);border-radius:50%;background:var(--muted)}
  .presence.connected{background:var(--success)}
  .row-content{display:flex;flex-direction:column;min-width:0;flex:1}
  .row-heading{display:flex;align-items:center;gap:6px;min-height:21px}
  .row-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:600}
  .row-unread{margin-left:auto;flex-shrink:0;min-width:18px;padding:1px 5px;border-radius:9px;background:var(--accent);color:var(--on-accent);font-size:11px;text-align:center}
  .saved{font-size:12px;margin-left:auto}.contact-label{font-size:11px;line-height:18px;color:var(--muted)}
</style>
