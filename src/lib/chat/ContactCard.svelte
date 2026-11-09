<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import type { ChatEntry } from './session-chats';
  import { contactMedia, type ContactMediaCategory } from './contact-media';
  import { inlineMediaFor } from './media-preview';
  import { formatBytes } from '$lib/application/storage-summary';
  import HelpInfo from '$lib/application/HelpInfo.svelte';
  import Avatar from './Avatar.svelte';
  import ContactShare from './ContactShare.svelte';
  import type {Snippet} from 'svelte';
  import ChatIcon from './ChatIcon.svelte';
  import AvatarEditor from './AvatarEditor.svelte';
  import type { AvatarCrop } from './avatar-crop';
  let { accountId, nickname, alias, qr, copied, blocked, hasChat, messages, urls, errors,
    copy, rename, toggleBlock, openChat, openMessage, preview, canOpen, self = false, editOwn, share, sharing = false,
    photo = '', photoBusy = false, photoError = '', changePhoto, contactUrl = '',openLibrary,accountActions,radioActions }:
    { accountId: string; nickname: string; alias: string; qr: string; copied: boolean;
      blocked: boolean; hasChat: boolean; messages: ChatEntry[]; urls: Record<string, string>; errors: Record<string, boolean>;
      copy: () => void; rename: (name: string) => boolean; toggleBlock: () => void;
      openChat: () => void; openMessage: (id: string) => void;
      preview: (node: HTMLElement, details: { peer: string; id: string }) => { destroy(): void };
      canOpen: (message: ChatEntry) => boolean; self?: boolean; editOwn?: () => void;
      share: () => void; sharing?: boolean; photo?: string; photoBusy?: boolean; photoError?: string; changePhoto?: (file: File | null, crop?: AvatarCrop) => void; contactUrl?: string;openLibrary?:()=>void;accountActions?:Snippet;radioActions?:Snippet } = $props();
  let editing = $state(false); let draft = $state(''); let mediaOpen = $state(false);
  let category = $state<ContactMediaCategory>('all'); let limit = $state(24);
  const categories: { id: ContactMediaCategory; label: string }[] = [
    { id: 'all', label: 'Все' }, { id: 'image', label: 'Фото' }, { id: 'video', label: 'Видео' },
    { id: 'audio', label: 'Аудио' }, { id: 'sticker', label: 'Стикеры' }, { id: 'other', label: 'Файлы' },
  ];
  let files = $derived(contactMedia(messages, category));
  let total = $derived(contactMedia(messages).length);
</script>
<section class="contact-card" aria-label={self ? $i18n.text("Карточка моего аккаунта") : $i18n.text("Карточка собеседника")}>
  <header>
    <Avatar {accountId} {photo} size={56} alt={self ? $i18n.text("Аватар моего аккаунта") : $i18n.text("Аватар собеседника")} />
    <div class="identity"><h3>{alias || nickname || (self ? $i18n.text("Мой аккаунт") : $i18n.text("Собеседник"))}</h3>
      <small>{self ? $i18n.text("Ваш аккаунт") : $i18n("m_75a05e5e85f7", {v0: (nickname || $i18n.text("Не указан"))})}</small>
      {#if !self}<button onclick={() => { draft = alias; editing = !editing; }} aria-expanded={editing}>{$i18n.text("Переименовать")}</button>{/if}
    </div>
  </header>
  {#if editing}
    <form onsubmit={event => { event.preventDefault(); if (rename(draft)) editing = false; }}>
      <input bind:value={draft} maxlength="32" placeholder={$i18n.text("Имя только у вас")} aria-label={$i18n.text("Имя контакта")} />
      <button type="submit">{$i18n.text("Сохранить")}</button><button type="button" onclick={() => editing = false}>{$i18n.text("Отмена")}</button>
    </form>
  {/if}
  <div class="card-content" class:own={self}>
    <div class="profile-actions">
      {#if self}<section class="action-group" aria-label={$i18n.text("Оформление профиля")}><h4>{$i18n.text("Оформление")}</h4>
        <button type="button" onclick={editOwn}>{$i18n.text("Изменить имя")}</button>
        {#if changePhoto}<AvatarEditor {accountId} {photo} showPreview={false} busy={photoBusy} error={photoError} onChange={changePhoto} />{/if}
      </section>{/if}
      <section class="action-group" aria-label={self?$i18n.text("Личные материалы"):$i18n.text("Переписка с контактом")}><h4>{self?$i18n.text("Личное"):$i18n.text("Переписка")}</h4>
        <div class="links">
          <button type="button" onclick={openChat}><ChatIcon name="chat" />{self?$i18n.text("Сохранённые"):hasChat?$i18n.text("Открыть чат"):$i18n.text("Начать чат")}</button>
          <button type="button" onclick={()=>mediaOpen=!mediaOpen} aria-expanded={mediaOpen}><ChatIcon name="attachment" />{self?$i18n.text("Вложения Сохранённых"):$i18n.text("Вложения")}<span class="count">{total}</span></button>
          {#if self&&openLibrary}<button type="button" onclick={openLibrary}><ChatIcon name="emoji" />{$i18n.text("GIF и стикеры")}</button>{/if}
        </div>
      </section>
    </div>
    <section class="share-group" aria-label={self?$i18n.text("Мой контакт"):$i18n.text("Контакт собеседника")}>
      <div class="share-title"><h4>{self?$i18n.text("Мой контакт"):$i18n.text("Контакт")}</h4><HelpInfo label={$i18n.text("Справка: контакт и ссылка")} text={$i18n.text("Mesh ID — постоянный адрес аккаунта. Ссылка и QR помогают добавить контакт и найти его сеть, но не дают доступ к аккаунту. Фото и имя не подтверждают личность: сверяйте Mesh ID.")} /></div>
      <ContactShare {accountId} {contactUrl} {qr} {copied} onCopy={copy} onShare={share} {sharing} showPattern={!!photo} />
    </section>
  </div>
  {#if self&&radioActions}{@render radioActions()}{/if}
  {#if mediaOpen}
    <section aria-label={$i18n.text("Вложения с собеседником")}>
      <nav aria-label={$i18n.text("Категории вложений")}>{#each categories as item}
        <button aria-pressed={category === item.id} onclick={() => { category = item.id; limit = 24; }}>{$i18n.text(item.label)}</button>
      {/each}</nav>
      <div class="media-grid">
        {#each files.slice(0, limit) as message (message.id)}
          {@const file = message.file!}
          {@const kind = inlineMediaFor(file)?.kind ?? 'other'}
          {@const key = `${accountId}:${message.id}`}
          <button class="media-item" onclick={() => openMessage(message.id)} title={$i18n.text("Перейти к сообщению")}>
            <span class="thumbnail" use:preview={{ peer: accountId, id: message.id }}>
              {#if canOpen(message) && urls[key] && !errors[key] && kind === 'image'}
                <img src={urls[key]} alt={file.name} loading="lazy" />
              {:else if canOpen(message) && urls[key] && !errors[key] && kind === 'video'}
                <!-- svelte-ignore a11y_media_has_caption -->
                <video src={urls[key]} muted playsinline preload="metadata" aria-label={file.name}></video><span class="play">▶</span>
              {:else}<span class="file-icon">{kind === 'image' ? '▧' : kind === 'video' ? '▶' : kind === 'audio' ? '♫' : '📄'}</span>{/if}
            </span>
            <span class="file-name">{file.name}</span>
            <small>{$i18n.system(formatBytes(file.size))}{!canOpen(message) ? $i18n.text("· Не загружено") : errors[key] ? $i18n.text("· Нет превью") : ''}</small>
          </button>
        {:else}<p>{$i18n.text("В этой категории пока нет вложений.")}</p>{/each}
      </div>
      {#if files.length > limit}<button onclick={() => limit += 24}>{$i18n.text("Показать ещё")}</button>{/if}
      <small>{$i18n.text("Только история этого устройства. Нажмите вложение, чтобы открыть его сообщение.")}</small>
    </section>
  {/if}
  {#if self&&accountActions}<footer class="account-actions">{@render accountActions()}</footer>{/if}
  {#if !self}<footer><button onclick={toggleBlock} disabled={!hasChat}>{blocked ? $i18n.text("Разблокировать") : $i18n.text("Заблокировать")}</button>{#if blocked}<small>{$i18n.text("Этот адрес заблокирован.")}</small>{/if}</footer>{/if}
</section>
<style>
  .contact-card { width:100%;box-sizing:border-box;max-width:960px; padding:12px; border:1px solid var(--line); border-radius:12px; margin:10px auto;font-size:14px; }
  header { display:flex; gap:12px; align-items:center; } .identity { flex:1; min-width:0; }
  h3 { margin:0 0 4px; overflow-wrap:anywhere; } .identity small { display:block; margin-bottom:6px; }
  form, .links, nav { display:flex; gap:6px; flex-wrap:wrap; margin:12px 0; } form input { min-width:0; flex:1; }
  .card-content{display:grid;grid-template-columns:minmax(0,1fr);gap:16px;margin-top:16px;min-width:0}
  .profile-actions{display:flex;flex-direction:column;gap:16px;min-width:0}.action-group,.share-group{min-width:0;padding:14px;background:var(--surface-alt);border:1px solid var(--line);border-radius:12px}
  h4{margin:0 0 12px;font-size:14px}.share-title{display:flex;align-items:center;gap:6px;margin-bottom:8px}.share-title h4{margin:0}
  .links{margin:0;flex-direction:column;gap:8px}.links button{display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:9px 10px;font-size:14px;min-height:40px}.count{margin-left:auto;font-size:12px;color:var(--muted)}
  .share-group{order:-1}
  .account-actions{justify-content:space-between;flex-wrap:wrap}
  .profile-actions :global(.avatar-editor button),.account-actions :global(button){min-height:40px;font-size:14px;padding:8px 12px}
  @container(min-width:700px){.card-content.own{grid-template-columns:minmax(240px,1fr) minmax(260px,340px);gap:20px}.contact-card{padding:20px}.own .share-group{order:0}}
  footer { display:flex; gap:10px; align-items:center; margin-top:16px; border-top:1px solid var(--line); padding-top:10px; }
  .media-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(120px,1fr)); gap:8px; margin-bottom:10px; }
  .media-item { min-width:0; text-align:left; padding:6px; } .thumbnail { position:relative; display:grid; place-items:center; height:100px; background:var(--surface-alt); border-radius:5px; overflow:hidden; }
  .thumbnail img, video { width:100%; height:100%; object-fit:cover; } .file-icon { font-size:30px; } .play { position:absolute; color:white; text-shadow:0 1px 4px black; }
  .file-name { display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin:5px 0; } small { font-size:12px; color:var(--muted); }
  button { min-height:40px;font-size:14px;padding:8px 12px; } nav button[aria-pressed="true"] { font-weight:bold; }
</style>
