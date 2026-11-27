<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { tr as i18n, locale } from '$lib/i18n/language';
  import CompactDialog from '$lib/application/CompactDialog.svelte';
  import Avatar from '$lib/chat/Avatar.svelte';
  import ChatIcon from '$lib/chat/ChatIcon.svelte';
  import ComposerEmojiToggle from '$lib/chat/ComposerEmojiToggle.svelte';
  import { autoSizeComposer } from '$lib/chat/composer-size';
  import MessageTools from '$lib/chat/MessageTools.svelte';
  import MessageDelivery from '$lib/chat/MessageDelivery.svelte';
  import MessageSelectionBar from '$lib/chat/MessageSelectionBar.svelte';
  import ChatSearch from '$lib/chat/ChatSearch.svelte';
  import { selectEveryMessage, selectionSummary, toggleSelection } from '$lib/chat/message-selection';
  import { messageArchive } from '$lib/chat/bulk-actions';
  import HistoryDivider from '$lib/chat/HistoryDivider.svelte';
  import MessageCard from '$lib/chat/MessageCard.svelte';
  import MessageText from '$lib/chat/MessageText.svelte';
  import EmojiPicker from '$lib/chat/EmojiPicker.svelte';
  import PastedImages from '$lib/chat/PastedImages.svelte';
  import { ComposerInput } from '$lib/chat/composer-input';
  import { clipboardImages } from '$lib/chat/clipboard-images';
  import { validateAttachmentBatch } from '$lib/chat/attachment-policy';
  import type { MediaAsset, MediaLibrary, StickerPack } from '$lib/chat/media-library';
  import GroupAttachmentCard from './GroupAttachmentCard.svelte';
  import MediaViewer from '$lib/chat/MediaViewer.svelte';
  import { inlineMediaFor } from '$lib/chat/media-preview';
  import type { PreparedPack } from '$lib/chat/sticker-pack';
  import type { createChatScroll } from '$lib/chat/chat-scroll';
  import { submitOnEnter } from '$lib/chat/conversation-list';
  import { GROUP_TEXT_BYTES, MAX_GROUP_MEMBERS } from './protocol';
  import { groupChronology, groupEntryUnread, type GroupEntry, type GroupRoom } from './storage';
  import { groupChatEntry, groupDelivery, groupRecipients, type GroupDeliveryPhase } from './presentation';
  import { editGroupMentions, groupMentionParts, mentionQuery, moveGroupMentions, type GroupMention, type MentionEdit } from './mentions';

  let { room, self, name, photo, connected, searching, deliveryPhase, blocked, welcomeFailed, contacts, invite, exclude, leave, trackReads, markRead, scroll, jump, accept, send,
    library, loadSticker, manageStickers, sendSticker, autoplay, loadAttachment, obtainAttachment, saveAttachment, previewPack, openPack, saveMedia,
    canRequestPack, requestPack, canMention, openProfile, forward, forwardDone, hide, sync, direct, back }: {
    room: GroupRoom; self: string; name(peer: string): string; photo(peer: string): string;
    connected: ReadonlySet<string>; blocked: boolean; welcomeFailed: boolean;
    searching: ReadonlySet<string>; deliveryPhase(hash: string): GroupDeliveryPhase | undefined;
    contacts: string[]; invite(peer: string): Promise<void>; exclude(peer: string): Promise<void>; leave(successor?: string): Promise<void>;
    trackReads: boolean; markRead(hashes: string[]): Promise<void>;
    scroll: ReturnType<typeof createChatScroll>; jump: boolean;
    accept(): Promise<void>; send(text: string, replyTo?: string, file?: File, mentions?: GroupMention[]): Promise<string>;
    canMention(peer: string): boolean; sync(): void; direct(): void; back(): void;
    library: MediaLibrary; loadSticker(hash: string): Promise<Uint8Array | null>; manageStickers(tab: 'stickers' | 'gifs'): void;
    sendSticker(asset: MediaAsset, pack: StickerPack | undefined, replyTo?: string): Promise<string>;
    autoplay: boolean; loadAttachment(hash: string): Promise<Uint8Array | null>;
    obtainAttachment(hash: string): Promise<Uint8Array | null>;
    saveAttachment(bytes: BlobPart, name: string): void;
    previewPack(entry: GroupEntry): Promise<PreparedPack>;
    openPack(entry: GroupEntry): void;
    saveMedia(entry: GroupEntry): Promise<string>;
    canRequestPack(entry: GroupEntry): boolean;
    requestPack(entry: GroupEntry): Promise<string>;
    openProfile(peer: string): void;
    forward(entries: GroupEntry[]): void;
    forwardDone: number;
    hide(ids: string[]): Promise<void>;
  } = $props();
  let draft = $state(''), busy = $state(false), failed = $state(false);
  let transcript = $state<HTMLDivElement>();
  let composer = $state<HTMLTextAreaElement>();
  const componentId = $props.id();
  const mentionMenuId = componentId + '-mentions';
  let mentions = $state<GroupMention[]>([]);
  let query = $state<ReturnType<typeof mentionQuery>>(null), mentionIndex = $state(0);
  let mentionEdit: MentionEdit | undefined, dismissedQuery = '';
  let mentionMenu = $state<HTMLDivElement>();
  let attachmentInput = $state<HTMLInputElement>();
  let attachments = $state<File[]>([]), attachmentError = $state('');
  let pickerOpen = $state(false), mobileInput = $state(false);
  const inputPanel = new ComposerInput(() => pickerOpen, open => pickerOpen = open, mobile => mobileInput = mobile);
  let replyTo = $state('');
  let routeId = $state('');
  let routeView = $state<'status' | 'route'>('route');
  function showDelivery(id: string, view: 'status' | 'route') { routeId = id; routeView = view; }
  let messageTools = $state<{ id:string; view:'menu' | 'status' | 'route' | 'share' } | null>(null), galleryId = $state('');
  let selecting = $state(false), selected = $state<string[]>([]), confirmingHide = $state<string[]>([]);
  let selectionError = $state('');
  let galleryUrl = $state(''), galleryFailed = $state(false);
  let localFiles = $state(new Set<string>());
  let copied = $state(''), highlighted = $state(''), copyFailed = $state(false);
  let copyTimer: ReturnType<typeof setTimeout>, highlightTimer: ReturnType<typeof setTimeout>;
  let searchOpen = $state(false);
  let searchButton = $state<HTMLButtonElement>();
  let restoreFromSearch: (() => void) | undefined;
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
  const canCompose = $derived(!busy && !blocked && !updatingKeys);
  const canSend = $derived(canCompose && (draftBytes > 0 || attachments.length > 0) && draftBytes <= GROUP_TEXT_BYTES);
  const foldNickname = (value: string) => value.normalize('NFKC').toLocaleLowerCase();
  const mentionCandidates = $derived.by(() => {
    if (!query || !canCompose || pickerOpen || mentions.length >= MAX_GROUP_MEMBERS) return [];
    const needle = foldNickname(query.query.trim());
    const all = others.filter(canMention).map(peer => ({
      peer, nickname:(room.profiles?.[peer]?.nickname || name(peer)).trim().slice(0, 64),
    }));
    const duplicates = new Map<string, number>();
    for (const { nickname } of all) {
      const key = foldNickname(nickname);
      duplicates.set(key, (duplicates.get(key) ?? 0) + 1);
    }
    return all.filter(item => foldNickname(item.nickname).includes(needle) || foldNickname(name(item.peer)).includes(needle))
      .map(item => ({ ...item, duplicate:(duplicates.get(foldNickname(item.nickname)) ?? 0) > 1 }));
  });
  const activeMention = $derived(mentionCandidates[Math.min(mentionIndex, mentionCandidates.length - 1)]);
  const timeline = $derived(groupChronology(room.entries).filter(entry => !entry.hidden));
  const searchable = $derived(searchOpen ? timeline.map(entry => ({ ...groupChatEntry(entry, self), details:entry.file?.details })) : []);
  const selectedEntries = $derived(timeline.filter(entry => selected.includes(entry.id)));
  const readyFile = (entry: GroupEntry) => !!(entry.fileReady || entry.fileNode || localFiles.has(entry.hash) || entry.from === self);
  const canUseFile = (entry: GroupEntry) => !entry.file || readyFile(entry);
  const gallery = $derived(timeline.filter(entry => {
    if (!entry.file || !readyFile(entry)) return false;
    const kind = inlineMediaFor(entry.file)?.kind;
    return kind === 'image' || kind === 'video';
  }));
  const galleryIndex = $derived(gallery.findIndex(entry => entry.id === galleryId));
  const galleryEntry = $derived(gallery[galleryIndex]);
  const galleryHash = $derived(galleryEntry?.hash);
  const galleryMime = $derived(galleryEntry?.file && inlineMediaFor(galleryEntry.file)?.mime);
  $effect(() => {
    const hash = galleryHash, mime = galleryMime;
    galleryUrl = ''; galleryFailed = false;
    if (!hash || !mime) return;
    let active = true, url = '';
    void loadAttachment(hash).then(bytes => {
      if (!bytes) throw new Error('group_file_unavailable');
      try {
        if (active) galleryUrl = url = URL.createObjectURL(new Blob([bytes as BlobPart], { type:mime }));
      } finally { bytes.fill(0); }
    }).catch(() => { if (active) galleryFailed = true; });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  });
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
  const routeMessage = $derived(byId.get(routeId));
  const unread = $derived(timeline.filter(entry => groupEntryUnread(entry, self)));
  const scrollMessages = $derived(timeline.map(entry => ({
    id: entry.id, direction: entry.from === self ? 'outgoing' as const : 'incoming' as const,
  })));
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
    } else jumpToLatest();
  }

  function jumpToLatest() {
    if (transcript) transcript.scrollTop = transcript.scrollHeight;
  }

  function toggleSearch() {
    if (searchOpen) { closeSearch(); return; }
    restoreFromSearch = scroll.checkpoint();
    searchOpen = true;
  }

  function closeSearch(restore = true) {
    if (!searchOpen) return;
    const returnTo = restoreFromSearch;
    restoreFromSearch = undefined;
    searchOpen = false;
    highlighted = '';
    if (restore) void tick().then(() => {
      if (searchOpen) return;
      returnTo?.();
      searchButton?.focus({ preventScroll:true });
    });
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

  function showOriginal(id: string, behavior: ScrollBehavior = 'smooth') {
    revealMessage(id, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : behavior);
    reviewHistory();
    highlighted = id;
    clearTimeout(highlightTimer);
    highlightTimer = setTimeout(() => { highlighted = ''; }, 1800);
  }

  async function downloadAttachment(entry: GroupEntry) {
    if (!entry.file) {
      saveAttachment(entry.text, `Automesh-message-${entry.id}.txt`);
      return;
    }
    const bytes = entry.file && await loadAttachment(entry.hash).catch(() => null);
    if (!bytes || !entry.file) return;
    try { if (composer?.isConnected) saveAttachment(bytes as BlobPart, entry.file.name); }
    finally { bytes.fill(0); }
  }

  async function loadShareFile(entry: GroupEntry) {
    const file = entry.file;
    const bytes = file && await loadAttachment(entry.hash);
    if (!file || !bytes) throw new Error('Не удалось подготовить файл.');
    try { return new File([bytes as BlobPart], file.name, { type:file.mime }); }
    finally { bytes.fill(0); }
  }

  function beginSelection(entry?: GroupEntry) {
    closeSearch(false);
    selecting = true;
    selected = entry ? [entry.id] : [];
    selectionError = '';
  }

  function exitSelection() { selecting = false; selected = []; selectionError = ''; }
  $effect(() => { void forwardDone; exitSelection(); });

  function forwardEntries(entries: GroupEntry[]) {
    if (!entries.length || !entries.every(canUseFile)) return;
    forward(entries);
  }

  async function copySelection() {
    selectionError = '';
    try { await navigator.clipboard.writeText(selectedEntries.map(entry => entry.file?.name ?? entry.text).join('\n\n')); exitSelection(); }
    catch { selectionError = 'Не удалось скопировать текст.'; }
  }

  function downloadSelection() {
    const entries = selectedEntries.filter(canUseFile);
    if (!entries.length) return;
    selectionError = '';
    void act(async () => {
      try {
        const { bytes, name } = await messageArchive(entries.map(entry => groupChatEntry(entry, self)), async message => {
          const entry = entries.find(entry => entry.id === message.id)!;
          const bytes = await loadAttachment(entry.hash);
          if (!bytes) throw new Error('Файл отсутствует или повреждён.');
          return bytes;
        });
        try { if (composer?.isConnected) saveAttachment(bytes as BlobPart, name); }
        finally { bytes.fill(0); }
        exitSelection();
      } catch (error) { selectionError = error instanceof Error ? error.message : 'Не удалось подготовить скачивание. Выбор сохранён.'; }
    });
  }

  async function galleryAction(action: 'download' | 'share' | 'forward' | 'reply' | 'show-in-chat') {
    const entry = galleryEntry;
    if (!entry || blocked) return;
    if (action === 'download') { await downloadAttachment(entry); return; }
    galleryId = '';
    await tick();
    if (!composer?.isConnected) return;
    if (action === 'share') messageTools = { id:entry.id, view:'share' };
    if (action === 'forward') forwardEntries([entry]);
    if (action === 'reply') startReply(entry);
    if (action === 'show-in-chat') showOriginal(entry.id);
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
    const selectedMentions = mentions;
    const original = replyDraft?.id;
    const files = [...attachments];
    void act(async () => {
      let id = await send(value, original, files[0], selectedMentions);
      if (replyTo === original) replyTo = '';
      if (draft === value) { draft = ''; mentions = []; query = null; dismissedQuery = ''; }
      if (files.length) attachments = attachments.slice(1);
      for (const file of files.slice(1)) {
        id = await send('', undefined, file);
        attachments = attachments.slice(1);
      }
      await tick();
      requestAnimationFrame(() => revealMessage(id, 'instant'));
    });
  }

  function stage(files: File[]) {
    if (!canCompose || !files.length) return;
    attachmentError = validateAttachmentBatch(files, attachments.length) ?? '';
    if (!attachmentError) attachments = [...attachments, ...files];
  }

  export function canStageFiles() {
    return !!room.mls && canCompose && !galleryId && !messageTools && !routeId && !membersOpen && !selecting;
  }

  export function stageFiles(files: File[]) {
    if (canStageFiles()) stage(files);
  }

  function insertEmoji(emoji: string) {
    const start = composer?.selectionStart ?? draft.length;
    const end = composer?.selectionEnd ?? start;
    replaceDraft(start, end, emoji);
    void tick().then(() => inputPanel.restoreCaret(start + emoji.length, start + emoji.length));
  }

  function queryKey(value: NonNullable<typeof query>) {
    return JSON.stringify([value.start, value.end, value.query]);
  }

  function updateMentionQuery(node = composer) {
    if (!node || document.activeElement !== node || node.selectionStart !== node.selectionEnd) { query = null; return; }
    const next = mentionQuery(draft, node.selectionStart, mentions);
    if (!next || queryKey(next) === dismissedQuery) { query = null; return; }
    if (!query || queryKey(query) !== queryKey(next)) { query = next; mentionIndex = 0; }
  }

  function applyDraftInput(node: HTMLTextAreaElement, composing: boolean) {
    mentions = editGroupMentions(draft, node.value, mentions, mentionEdit);
    mentionEdit = undefined;
    draft = node.value;
    if (composing) query = null;
    else updateMentionQuery(node);
  }

  function replaceDraft(start: number, end: number, value: string) {
    mentions = moveGroupMentions(mentions, start, end, value.length);
    draft = draft.slice(0, start) + value + draft.slice(end);
    query = null;
    dismissedQuery = '';
  }

  function chooseMention(candidate: NonNullable<typeof activeMention>) {
    if (!query || !canCompose || !others.includes(candidate.peer) || !canMention(candidate.peer)) return;
    const { start, end } = query;
    const label = '@' + candidate.nickname;
    const suffix = /^\s/.test(draft.slice(end)) ? '' : ' ';
    replaceDraft(start, end, label + suffix);
    mentions = [...mentions, [start, start + label.length, candidate.peer] as GroupMention].sort((a,b) => a[0] - b[0]);
    const caret = start + label.length + suffix.length;
    void tick().then(() => inputPanel.restoreCaret(caret, caret));
  }

  function composerKey(event: KeyboardEvent) {
    if (event.isComposing || event.keyCode === 229) return;
    if (activeMention && query) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const length = mentionCandidates.length;
        mentionIndex = (Math.min(mentionIndex, length - 1) + (event.key === 'ArrowDown' ? 1 : length - 1)) % length;
        void tick().then(() => mentionMenu?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block:'nearest' }));
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        dismissedQuery = queryKey(query);
        query = null;
        return;
      }
      if (submitOnEnter(event)) {
        event.preventDefault();
        if (!event.repeat) chooseMention(activeMention);
        return;
      }
    }
    if (!submitOnEnter(event)) return;
    event.preventDefault();
    if (!event.repeat) composer?.form?.requestSubmit();
  }

  async function chooseSticker(asset: MediaAsset, pack?: StickerPack) {
    if (!canCompose) return;
    const original = replyDraft?.id;
    busy = true; failed = false;
    try {
      const id = await sendSticker(asset, pack, original);
      if (replyTo === original) replyTo = '';
      pickerOpen = false;
      await tick();
      requestAnimationFrame(() => revealMessage(id, 'instant'));
    } catch { throw new Error('Не удалось выполнить действие.'); }
    finally { busy = false; }
  }
</script>

<svelte:window onfocus={queueRead} />
<svelte:document onvisibilitychange={queueRead} />

{#snippet groupHeading()}
  <span class="local-agent-avatar" aria-hidden="true"><ChatIcon name="group" /></span>
  <span><strong>{room.title}</strong><small class="peer-status">{$i18n.text('Участники группы')} · {room.members.length}</small>
    <small class="peer-status">{$i18n.text('Прямые соединения')} · {links}</small></span>
{/snippet}

<div class="chat-heading group-heading">
  <button type="button" class="chat-back" onclick={back} aria-label={$i18n.text('Все чаты')}>←</button>
  {#if room.mls || !owner}
    <button type="button" class="peer-heading" onclick={() => { membersOpen = true; failed = false; }} disabled={blocked}
      title={$i18n.text('Участники группы')} aria-label={$i18n.text('Участники группы')}>{@render groupHeading()}</button>
  {:else}
    <div class="peer-heading">{@render groupHeading()}</div>
  {/if}
  {#if !links}
    <button type="button" class="select-messages-button" onclick={direct} disabled={blocked}
      title={$i18n.text('Прямое подключение')} aria-label={$i18n.text('Прямое подключение')}><ChatIcon name="qr" /></button>
  {/if}
  <button type="button" class="select-messages-button" onclick={sync} disabled={blocked}
    title={$i18n.text(room.mls ? 'Догрузить сообщения' : 'Обновить')}
    aria-label={$i18n.text(room.mls ? 'Догрузить сообщения' : 'Обновить')}><ChatIcon name="repeat" /></button>
  {#if room.mls}
    <button type="button" class="select-messages-button" bind:this={searchButton} onclick={toggleSearch} aria-expanded={searchOpen} disabled={blocked || selecting}
      aria-label={$i18n.text('Поиск в чате')} title={$i18n.text('Поиск по тексту или дате')}><ChatIcon name="search" /></button>
    <button type="button" class="select-messages-button" onclick={() => selecting ? exitSelection() : beginSelection()}
      aria-pressed={selecting} disabled={blocked || busy}
      aria-label={$i18n.text(selecting ? 'Отмена выбора' : 'Выбрать сообщения')}><ChatIcon name={selecting ? 'close' : 'select'} /></button>
  {/if}
</div>
{#if searchOpen}
  <ChatSearch messages={searchable} focus onJump={id => showOriginal(id, 'instant')} onClose={() => closeSearch()} />
{/if}
{#if selecting}
  <div class="group-selection-row">
    <MessageSelectionBar messages={timeline} {selected} busy={busy || blocked}
      onToggleAll={() => selected = selectionSummary(timeline, selected).all ? [] : selectEveryMessage(timeline)}
      onCopy={() => void copySelection()} onForward={() => forwardEntries(selectedEntries)}
      canForward={selectedEntries.every(canUseFile)} onDownload={downloadSelection}
      downloadCount={selectedEntries.filter(canUseFile).length} onHide={() => confirmingHide = selectedEntries.map(entry => entry.id)} />
  </div>
{/if}
{#if selectionError}<small role="alert">{$i18n.system(selectionError)}</small>{/if}

<div class="message-history">
  <div class="message-scroll" bind:this={transcript} use:scroll={{ peer: room.id, messages: scrollMessages, openToken: 0 }}
    role="log" aria-label={$i18n.text('Переписка группы')} onwheel={reviewHistory} onpointerdown={reviewHistory}>
    {#if room.mls}
      {#each timeline as message, i (message.id)}
        {@const original = message.replyTo ? byId.get(message.replyTo) : undefined}
        {@const delivery = groupDelivery(room, message, self, readyFile(message), deliveryPhase(message.hash), searching)}
        {@const sent = message.sentAt === undefined ? undefined : new Date(message.sentAt)}
        {@const dateMoved = sent && dates[i] !== sent.toDateString()}
        {@const replies = replyCounts.get(message.id) ?? 0}
        {#if sent && dates[i] !== dates[i - 1]}
          <HistoryDivider timestamp={message.sentAt} />
        {/if}
        <div data-chat-message-id={message.id} use:observeRead={message}>
          <MessageCard outgoing={message.from === self} preview={message.text} highlighted={highlighted === message.id}
            sticker={message.file?.details?.media?.kind === 'sticker'} {selecting}
            selected={selected.includes(message.id)} busy={busy || blocked}
            onSelect={() => selected = toggleSelection(selected, message.id)} onBeginSelect={() => beginSelection(message)}>
            <div class="message-header">
              <button type="button" class="group-author" onclick={() => openProfile(message.from)} title={$i18n.text('Открыть карточку')}>
                <Avatar accountId={message.from} photo={photo(message.from)} size={18} />
                <strong class="message-author">{message.from === self ? $i18n.text('Вы') : name(message.from)}</strong>
              </button>
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
              <MessageTools message={groupChatEntry(message, self, readyFile(message))} status={delivery.status} recipient={self}
                shareText={message.text} openView={messageTools?.id === message.id ? messageTools.view : null} disabled={busy || blocked}
                canReply={canCompose} canForward={canUseFile(message)}
                onOpen={view => messageTools = {id:message.id,view}} onClose={() => messageTools = null}
                onReply={() => startReply(message)} onForward={() => forwardEntries([message])} onSelect={() => beginSelection(message)}
                onDownload={() => void downloadAttachment(message)} onHide={() => confirmingHide = [message.id]} onCopy={() => void copyText(message)}
                onRoute={() => showDelivery(message.id, 'route')} onStatus={() => showDelivery(message.id, 'status')}
                loadShareFile={() => loadShareFile(message)} />
              {#if copied === message.id}<span class="copy-feedback" role="status">{$i18n.text('Текст скопирован.')}</span>{/if}
            </div>
            {#if message.forwarded}<small class="forward-label">{$i18n.text('↪ Переслано')}</small>{/if}
            {#if original}
              <button class="reply-preview" type="button" onclick={() => showOriginal(original.id)} title={$i18n.text('Перейти к исходному сообщению')}>
                <small>↩ {original.from === self ? $i18n.text('Вы') : name(original.from)}</small>
                <span class="quote-text">{original.text}</span>
              </button>
            {:else if message.replyTo}
              <div class="reply-preview"><small>↩ {$i18n.text('Исходное сообщение удалено или отсутствует на этом устройстве.')}</small></div>
            {/if}
            {#if message.file}
              <GroupAttachmentCard file={message.file} blocked={blocked}
                load={() => loadAttachment(message.hash)} obtain={() => obtainAttachment(message.hash)}
                download={() => downloadAttachment(message)} onReady={() => { if (!localFiles.has(message.hash)) localFiles = new Set([...localFiles, message.hash]); }}
                openMedia={() => galleryId = message.id} loadPack={() => previewPack(message)} openPack={() => openPack(message)}
                saveGif={() => void saveMedia(message).catch(() => {})} autoplay={autoplay && !galleryId}
                fileReady={message.fileReady || !!message.fileNode} fileRequested={message.fileRequested} />
            {/if}
            {#if message.mentions?.length}
              {#each groupMentionParts(message.text, message.mentions) as part}
                {#if part.accountId}<bdi class="message-mention" class:mentioned-self={part.accountId === self}
                  title={part.accountId === self ? $i18n.text('Вас упомянули') : name(part.accountId)}>{part.text}</bdi>
                {:else}<MessageText text={part.text} largeEmoji={false} />{/if}
              {/each}
            {:else if !message.file || message.text !== message.file.name}<MessageText text={message.text} />{/if}
            <div class="message-actions">
              {#if replies}<small class="reply-count" title={$i18n.text('Ответы в этой переписке')}>↩ {replies}</small>{/if}
              {#if message.from === self || message.file}
                <MessageDelivery status={delivery.status} count={delivery.count} onDetails={() => showDelivery(message.id, 'status')} />
              {/if}
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
  {#if room.mls && !searchOpen && (jump || unread.length)}
    <div class="group-jumps">
      {#if unread.length}
        <button type="button" class="jump-down" onclick={jumpToMessage}
          aria-label={$i18n.text('К непрочитанным сообщениям') + ' · ' + unread.length} title={$i18n.text('К непрочитанным сообщениям')}>
          <ChatIcon name="chat" /><span class="jump-count" aria-hidden="true">{unread.length > 99 ? '99+' : unread.length}</span>
        </button>
      {/if}
      {#if jump}
        <button type="button" class="jump-down" onclick={jumpToLatest}
          aria-label={$i18n.text('К последним сообщениям')} title={$i18n.text('К последним сообщениям')}>
          <ChatIcon name="order-down" />
        </button>
      {/if}
    </div>
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
  <div class="composer-dock" use:inputPanel.mount={pickerOpen}>
  {#if pickerOpen}
    <div class="composer-picker"><EmojiPicker library={library} load={loadSticker} onChoose={insertEmoji} onClose={() => pickerOpen = false}
      canSend={canCompose} {busy} onSend={chooseSticker} onManage={tab => { pickerOpen = false; manageStickers(tab); }} /></div>
  {/if}
  <PastedImages files={attachments} disabled={busy || blocked} onRemove={i => attachments = attachments.filter((_, index) => i !== index)} />
  {#if attachmentError}<small role="alert">{$i18n.system(attachmentError)}</small>{/if}
  {#if mentionCandidates.length}
    <div class="group-mention-menu" id={mentionMenuId} bind:this={mentionMenu} role="listbox" aria-label={$i18n.text('Упомянуть участника')}>
      {#each mentionCandidates as candidate (candidate.peer)}
        <button type="button" role="option" tabindex="-1" id={mentionMenuId + '-' + candidate.peer}
          aria-selected={activeMention?.peer === candidate.peer} onmousedown={event => event.preventDefault()}
          onclick={() => chooseMention(candidate)}>
          <Avatar accountId={candidate.peer} photo={photo(candidate.peer)} size={26} />
          <bdi>{candidate.nickname}</bdi>
          {#if candidate.duplicate}<small>…{candidate.peer.slice(-8)}</small>{/if}
        </button>
      {/each}
    </div>
  {/if}
  <form class="composer" onsubmit={event => { event.preventDefault(); submit(); }}>
    <input class="attachment-input" type="file" multiple bind:this={attachmentInput} aria-label={$i18n.text('Выбрать файлы для отправки')}
      onchange={event => { stage(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = ''; }} />
    <button type="button" class="icon-button" onclick={() => attachmentInput?.click()} disabled={!canCompose} aria-label={$i18n.text('Прикрепить')}>
      <ChatIcon name="attachment" />
    </button>
    <div class="composer-field">
    <textarea rows="1" enterkeyhint="send" bind:this={composer} value={draft} use:autoSizeComposer={draft}
      maxlength={GROUP_TEXT_BYTES} placeholder={$i18n.text(attachments.length ? 'Сообщение к вложениям…' : 'Сообщение...')}
      onpaste={event => { const files = clipboardImages(event.clipboardData); if (files.length) { event.preventDefault(); stage(files); } }}
      onbeforeinput={event => mentionEdit = { start:event.currentTarget.selectionStart, end:event.currentTarget.selectionEnd, type:event.inputType }}
      oninput={event => applyDraftInput(event.currentTarget, event instanceof InputEvent && event.isComposing)}
      oncompositionend={() => updateMentionQuery()} onfocus={() => updateMentionQuery()} onclick={() => updateMentionQuery()}
      onkeyup={event => { if (!event.isComposing) updateMentionQuery(); }} onselect={() => updateMentionQuery()}
      onblur={event => { if (!(event.relatedTarget instanceof Node) || !mentionMenu?.contains(event.relatedTarget)) query = null; }}
      aria-label={$i18n.text('Сообщение группе')} aria-autocomplete="list"
      aria-controls={mentionCandidates.length ? mentionMenuId : undefined}
      aria-activedescendant={activeMention ? mentionMenuId + '-' + activeMention.peer : undefined}
      onkeydown={composerKey}></textarea>
    <ComposerEmojiToggle open={pickerOpen} mobile={mobileInput} toggle={inputPanel.toggle} disabled={busy || blocked} />
    </div>
    <button data-composer-send type="submit" class="primary send-button" disabled={!canSend} aria-label={$i18n.text('Отправить сообщение')}>
      <ChatIcon name="send" />
    </button>
  </form>
  </div>
{/if}

{#if galleryEntry?.file}
  <MediaViewer id={galleryEntry.id} name={galleryEntry.file.name} kind={inlineMediaFor(galleryEntry.file)?.kind === 'video' ? 'video' : 'image'}
    fileInfo={{size:galleryEntry.file.size,mime:galleryEntry.file.mime,timestamp:galleryEntry.sentAt ?? 0,
      sender:galleryEntry.from === self ? 'Вы' : name(galleryEntry.from),senderAddress:galleryEntry.from}}
    sticker={galleryEntry.file.details?.media?.kind === 'sticker' ? {
      packName:galleryEntry.file.details.media.packName, canRequest:canRequestPack(galleryEntry)
    } : undefined}
    onStickerAction={action => action === 'request' ? requestPack(galleryEntry) : saveMedia(galleryEntry)} url={galleryUrl} failed={galleryFailed}
    index={galleryIndex} count={gallery.length} onMove={direction => galleryId = gallery[(galleryIndex + direction + gallery.length) % gallery.length].id}
    onClose={() => galleryId = ''} onAction={action => void galleryAction(action)}
    canReply={canCompose} actionsDisabled={blocked} />
{/if}

{#if confirmingHide.length}
  <CompactDialog title={$i18n.text('Скрыть у меня')} onClose={() => { if (!busy) confirmingHide = []; }}>
    <p>{$i18n.text('Сообщения будут скрыты в вашей переписке. Другие участники сохранят свои копии.')}</p>
    <button type="button" disabled={busy || blocked} onclick={() => void act(async () => {
      await hide(confirmingHide); confirmingHide = []; exitSelection();
    })}>{$i18n.text('Скрыть у меня')}</button>
  </CompactDialog>
{/if}

{#if routeMessage}
  {@const delivery = groupDelivery(room, routeMessage, self, readyFile(routeMessage), deliveryPhase(routeMessage.hash), searching)}
  {@const recipients = groupRecipients(room, routeMessage)}
  <CompactDialog title={$i18n.text(routeView === 'status' ? 'Статус сообщения' : 'Путь сообщения')} literalTitle onClose={() => { routeId = ''; queueRead(); }}>
    {#if routeView === 'status'}
      <p><strong>{$i18n.system(delivery.status.label)}{delivery.count ? ' ' + delivery.count : ''}</strong></p>
      <p>{$i18n.system(delivery.status.detail)}</p>
      {#if routeMessage.from === self && recipients.length}
        <dl class="delivery-details">
          <dt>{$i18n.text(routeMessage.file ? 'Карточка на ноде' : 'На ноде')}</dt>
          <dd>{recipients.filter(item => !item.card && item.cardNode === 'stored').length}/{recipients.length}</dd>
          {#if routeMessage.file}
            <dt>{$i18n.text('Файл на ноде')}</dt><dd>{recipients.filter(item => item.stored).length}/{recipients.length}</dd>
          {/if}
          <dt>{$i18n.text(routeMessage.file ? 'Карточка доставлена' : 'Доставлено')}</dt>
          <dd>{recipients.filter(item => item.card).length}/{recipients.length}</dd>
          {#if routeMessage.file}
            <dt>{$i18n.text('Файл получен')}</dt><dd>{recipients.filter(item => item.file).length}/{recipients.length}</dd>
          {/if}
          <dt>{$i18n.text('Прочитали')}</dt><dd>{recipients.filter(item => item.read).length}/{recipients.length}</dd>
        </dl>
      {/if}
    {/if}
    {#if routeMessage.fileNode}<p>{$i18n.text('Файл получен с ноды')}</p>{/if}
    {#if routeMessage.route}
      <p>{routeMessage.route.node ? $i18n.text('Получено с ноды') : $i18n.text('Получено по P2P')}</p>
      {#if routeMessage.route.node}<p class="route-peer">{$i18n.text('Нода')} · {routeMessage.route.node}</p>{/if}
      {#if routeMessage.route.peer !== routeMessage.from}
        <p class="route-peer">{$i18n.text('Передал участник')} · {name(routeMessage.route.peer)}</p>
      {/if}
    {:else if routeMessage.from === self}
      <p>{$i18n.text('Сохранено на этом устройстве')}</p>
    {:else}
      <p>{$i18n.text('Маршрут доставки неизвестен')}</p>
    {/if}
    {#if routeMessage.from === self || Object.keys(routeMessage.nodeStatus ?? {}).length}
      <ul class="message-route">
        {#each recipients.filter(item => item.peer !== self) as recipient (recipient.peer)}
          <li>
            <strong>{name(recipient.peer)}</strong>
            {#if routeMessage.file}
              {#if recipient.fileNode === 'delivered'}<small>{$i18n.text('Файл получен с ноды')}</small>
              {:else if recipient.file}<small>{$i18n.text('Файл получен')} · P2P</small>
              {:else if recipient.fileNode === 'stored'}<small>{$i18n.text('Файл на ноде')}</small>{/if}
            {/if}
            <small>
              {#if recipient.cardNode === 'delivered'}
                {$i18n.text('Доставлено через ноду')}
                {#if recipient.read} · {$i18n.text('Прочитали')}{/if}
              {:else if recipient.card}
                {$i18n.text(recipient.read ? 'Прочитали' : 'Доставлено')} · {$i18n.text('Маршрут доставки неизвестен')}
              {:else if recipient.cardNode === 'stored'}
                {$i18n.text('На ноде')}
              {:else}
                {$i18n.text('Нет подтверждения доставки')}
              {/if}
            </small>
          </li>
        {/each}
      </ul>
    {/if}
  </CompactDialog>
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
            <button type="button" class="group-author member-profile" onclick={() => { closeMembers(); openProfile(peer); }}
              title={$i18n.text('Открыть карточку')} disabled={busy || blocked}>
              <Avatar accountId={peer} photo={photo(peer)} size={28} />
              <span>{peer === self ? $i18n.text('Вы') : name(peer)}
                {#if peer === room.owner}<small>{$i18n.text('Администратор')}</small>{/if}
              </span>
            </button>
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
  .group-selection-row { display:flex; flex:none; min-width:0; }
  .group-jumps { position:absolute; inset-inline-end:14px; bottom:12px; display:flex; gap:6px; pointer-events:none; }
  .group-jumps .jump-down { position:relative; inset:auto; pointer-events:auto; }
  .delivery-details { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:4px 14px; padding-block:8px; border-block:1px solid var(--line); }
  .delivery-details dd { margin:0; font-variant-numeric:tabular-nums; }
  .group-author { display:inline-flex; align-items:center; gap:5px; min-width:0; padding:0; border:0; background:transparent; text-align:start; }
  .member-profile { flex:1; gap:8px; padding:5px; }
  .group-mention-menu { display:grid; max-height:min(32dvh, 228px); overflow:auto; padding:4px; gap:2px; border:1px solid var(--line); border-radius:12px; background:var(--surface); }
  .group-mention-menu button { display:flex; align-items:center; gap:8px; min-height:36px; padding:4px 8px; text-align:start; border-color:transparent; }
  .group-mention-menu button[aria-selected=true], .group-mention-menu button:hover { background:var(--accent-soft); border-color:var(--line); }
  .group-mention-menu small { color:var(--muted); margin-inline-start:auto; }
  .message-mention { color:var(--link); font-weight:600; white-space:pre-wrap; overflow-wrap:anywhere; }
  .mentioned-self { background:var(--accent-soft); border-radius:4px; }
  .peer-heading strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .peer-heading .local-agent-avatar { display:grid; }
  .peer-heading .peer-status { overflow:hidden; text-overflow:ellipsis; }
  @media(max-width:380px) {
    .group-heading { gap:4px; }
    .group-heading .local-agent-avatar { display:none; }
    .group-heading .select-messages-button, .group-heading .chat-back { min-width:36px; }
  }
  .quick-copy :global(svg) { display:block; width:18px; height:18px; margin:auto; }
  .message-route { display:grid; gap:8px; list-style:none; padding:0; }
  .message-route small { display:block; color:var(--muted); }
  .route-peer, .message-route strong { overflow-wrap:anywhere; }
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
