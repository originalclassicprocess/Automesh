<script lang="ts">
  import {locale as uiLocale} from '$lib/i18n/language';
  import { tr as i18n } from '$lib/i18n/language';
  import { INBOX_CHATS_PER_PAGE, type ProfileInboxPage, type InboxFocus } from './chat-context';
  import { visibleInboxSources, type ProfileRegistry } from '../core/profiles';
  import { onMount } from 'svelte';
  let { snapshot, registry, viewer, onOpen, onPage }: {
    snapshot: ProfileInboxPage; registry: ProfileRegistry; viewer: string;
    onOpen(id: string, peer: string): void; onPage(page: number, focus?: InboxFocus): void;
  } = $props();
  let now = $state(Date.now());
  onMount(() => { const timer = setInterval(() => { now = Math.max(now, Date.now()); }, 1000); return () => clearInterval(timer); });
  let permitted = $derived(new Set(visibleInboxSources(registry, viewer, now)));
  let visible = $derived(snapshot.sources.filter(source => permitted.has(source.profile.id)));
</script>
<section class="inbox" aria-label={$i18n.text("Сохранённые чаты общего ящика")}>
  <h3>{$i18n.text("Все чаты")}</h3>
  <p>{$i18n.text("Сохранённая переписка подключённых профилей. Просмотр не отправляет отметки о прочтении. У каждого чата указан его профиль; для ответа откройте его. Неактивные профили пока не получают сообщения в фоне.")}</p>
  {#each visible as source}
    <section>
      <h4>{source.profile.name}</h4>
      {#if !source.data.chats.order.length}<p>{$i18n.text("Нет сохранённых чатов")}</p>{/if}
      {#each source.data.chats.order as peer}
        {@const messages = source.data.chats.byPeer[peer]?.messages ?? []}
        <details class="inbox-chat">
          <summary>
            <strong>{peer === source.profile.accountId ? $i18n.text("Сохранённые") : source.data.aliases[peer] || source.data.declaredNames[peer] || `${peer.slice(0,12)}…`}</strong>
            <small>{$i18n("m_ba70807f4407", {v0: (source.profile.name), v1: (source.windows[peer].total)})}{#if messages.length} {$i18n("m_b42063237598", {v0: (source.windows[peer].start + 1), v1: (source.windows[peer].end)})}{/if}</small>
            <span>{messages.at(-1)?.file ? $i18n.text("📎 Вложение") : messages.at(-1)?.text.slice(0,160) || $i18n.text("Пока нет сообщений")}</span>
          </summary>
          <div class="history">
            {#each messages as message}
              <article class:outgoing={message.direction === 'outgoing'}>
                <small>{message.direction === 'outgoing' ? source.data.selfNickname || $i18n.text("Вы") : source.data.aliases[peer] || source.data.declaredNames[peer] || $i18n.text("Собеседник")} · {new Date(message.timestamp).toLocaleString($uiLocale)}</small>
                {#if message.text}<p class="message-text">{message.text}</p>{/if}
                {#if message.file}<p>{$i18n("m_34c1df8c6223", {v0: (message.file.name), v1: (message.file.size)})}</p>{/if}
              </article>
            {/each}
          </div>
          {#if source.windows[peer].start > 0}
            <button onclick={() => onPage(0, { profileId: source.profile.id, peer, before: source.windows[peer].start })}>{$i18n.text("Более ранние сообщения")}</button>
          {/if}
          {#if snapshot.focus}
            <button onclick={() => onPage(0)}>{$i18n.text("Вернуться ко всем чатам")}</button>
          {/if}
          <button onclick={() => onOpen(source.profile.id, peer)}>{$i18n("m_93f0faa1a004", {v0: (source.profile.name)})}</button>
        </details>
      {/each}
    </section>
  {/each}
  {#if !visible.length}<p>{$i18n.text("Пока нет сохранённых чатов. В настройках нужного профиля включите «Показывать чаты в “Все чаты”».")}</p>{/if}
  {#if !snapshot.focus && snapshot.totalChats > INBOX_CHATS_PER_PAGE}
    <div class="pages">
      <button disabled={snapshot.page === 0} onclick={() => onPage(snapshot.page - 1)}>{$i18n.text("Предыдущие чаты")}</button>
      <span>{$i18n("m_eb54c05c0f96", {v0: (snapshot.page + 1), v1: (snapshot.totalChats)})}</span>
      <button disabled={(snapshot.page + 1) * INBOX_CHATS_PER_PAGE >= snapshot.totalChats} onclick={() => onPage(snapshot.page + 1)}>{$i18n.text("Следующие чаты")}</button>
    </div>
  {/if}
</section>
<style>
  .inbox { overflow:auto; padding:12px; } button { display:grid; width:100%; text-align:left; gap:6px; margin:8px 0; }
  span { overflow-wrap:anywhere; } small,p { color:var(--muted); } section { min-width:0; }
  .inbox-chat { padding:12px; margin:8px 0; border:1px solid var(--border); border-radius:12px; }
  summary { cursor:pointer; } summary small,summary span { display:block; margin:4px 0; }
  .history { max-height:60dvh; overflow:auto; } article { border:1px solid var(--border); border-radius:10px; padding:10px; margin:8px 12% 8px 0; }
  article.outgoing { margin:8px 0 8px 12%; } .message-text { color:var(--text,inherit); white-space:pre-wrap; overflow-wrap:anywhere; }
</style>
