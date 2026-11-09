<script lang="ts">
  import {locale as uiLocale} from '$lib/i18n/language';
  import { tr as i18n } from '$lib/i18n/language';
  import LanguageSettings from '$lib/i18n/LanguageSettings.svelte';
  import { onMount, tick, untrack } from 'svelte';
  import type { PendingDeviceVault } from './pending-vault';
  import { openDeviceRuntime, openDirectDeviceRuntime, type DeviceRuntime, type DeviceRuntimeOptions } from './runtime';
  import { emptyDeviceSettings, normalizeDeviceSettings } from './settings';
  import { ChatService } from '../chat/ChatService';
  import { RoutedWebRTCTransport, type NodeState } from '../transport/RoutedWebRTCTransport';
  import { isLocalHost, defaultSignalingEndpoints } from '../transport/client-config';
  import { isValidAccountId } from '../addressing/bech32m.js';
  import { loadLocalChatData, saveLocalChatData, snapshotLocalChatData, type LocalChatData } from '../chat/local-store';
  import { emptySessionChats, restoreChats, saveChats, selectConversation, receiveMessage, recordSentMessage, setContactState, setDeliveryStatus, updateConversation } from '../chat/session-chats';
  import { decodeChatContent, encodeChatContent } from '../chat/message-details';
  import type { DeviceEvent } from './delivery';
  import { acquireAccountLease, type AccountLease } from '../application/account-lease';
  import ContactSearch from '../chat/ContactSearch.svelte';
  import Avatar from '../chat/Avatar.svelte';
  import MessageText from '../chat/MessageText.svelte';
  import { SerializedWrites } from '../application/serialized-writes';
  import { activeMembers, memberDevice, type MembershipBody, type DirectoryAuthority } from './membership';
  import AccountHeader from '../application/AccountHeader.svelte';
  import {contactLink} from '../chat/contact-link';
  import ConnectionIndicators from '../transport/ConnectionIndicators.svelte';
  import CompactDialog from '../application/CompactDialog.svelte';
  import SettingsMenu from '../application/SettingsMenu.svelte';
  import ThemeSelector from '../application/ThemeSelector.svelte';
  import AboutProject from '../application/AboutProject.svelte';
  import { settingsMenu, settingsDescriptions, type SettingsSection } from '../application/settings-structure';
  import { idleCourierStatus } from '../node/courier-controller';
  import { identiconFor } from '../addressing/identicon';
  import ChatIcon from '../chat/ChatIcon.svelte';
  import MessageCard from '../chat/MessageCard.svelte';
  import MessageTools from '../chat/MessageTools.svelte';
  import { messageStatus, messageProvenance } from '../chat/message-presentation';
  import MessageDelivery from '../chat/MessageDelivery.svelte';
  import ContactShare from '../chat/ContactShare.svelte';
  import { visibleConversations, submitOnEnter } from '../chat/conversation-list';
  import ConversationRow from '../chat/ConversationRow.svelte';
  import { autoSizeComposer } from '../chat/composer-size';
  import { createChatScroll } from '../chat/chat-scroll';
  import EmojiPicker from '../chat/EmojiPicker.svelte';
  import type { ChatEntry } from '../chat/session-chats';
  import type { ReplyReference } from '../chat/message-details';
  import { readDeviceBootstrap } from './bootstrap';
  import { readOwnIncoming } from './replication';
  import HistoryReceive from './HistoryReceive.svelte';
  import HistoryAttachment from './HistoryAttachment.svelte';
  import { deviceHistoryStore } from './history-store';
  import { historyView, requireHistoryConsistency } from './history-data';
  import type { BackupProfile } from '../backup/full-backup';
  import { sha256Hex, safeFileName } from '../chat/file-transfer';
  let { vault, lock, initialNickname = '', onConnected = () => {} }: { vault: PendingDeviceVault; lock(): void; initialNickname?: string; onConnected?: () => void } = $props();
  // The component is destroyed when this vault is locked/replaced.
  const session = untrack(() => vault), owner = session.owner!, device = session.deviceId, key = session.storageKey;
  let chats = $state(emptySessionChats()), settings = $state(emptyDeviceSettings()), query = $state(''), draft = $state('');
  let busy = $state(false), error = $state(''), ready = $state(false), status = $state('waiting'), lastReceived = $state(0);
  let runtimeMode = $state<'node' | 'direct'>('direct'), upgrading = false, directCount = $state(0);
  const directPeers = new Set<string>();
  let confirmTimer: ReturnType<typeof setTimeout> | undefined;
  let runtime: DeviceRuntime | undefined, lease: AccountLease | undefined;
  let chat = $state.raw<ChatService>();
  let current = true; let messages = $state<HTMLElement>(); const writes = new SerializedWrites();
  let ownIdCopied=$state(false);
  let settingsOpen = $state(false), section = $state<SettingsSection>('overview'), networkOpen = $state(false), profileOpen = $state(false), peerOpen = $state(false);
  let pane = $state<'list' | 'chat'>('list'), nodes = $state<NodeState[]>([]), selfNickname = $state(untrack(() => initialNickname || 'Мой аккаунт'));
  let aliases = $state<Record<string, string>>({}), declaredNames = $state<Record<string, string>>({});
  let history = $state.raw<LocalChatData | null>(null), historyStore: ReturnType<typeof deviceHistoryStore> | undefined;
  const displayed = $derived(historyView(chats, history));
  let reply = $state<ReplyReference | null>(null), tools = $state<{ id: string; view: 'menu' | 'status' | 'route' | 'share' } | null>(null);
  const name = (peer: string) => peer === owner ? 'Сохранённые' : aliases[peer] || declaredNames[peer] || history?.aliases[peer] || history?.declaredNames[peer] || peer.slice(0, 16) + '…';
  const rights = 'Устройство имеет доступ к текстовым чатам. Для этой функции используйте устройство владельца.';
  const deliveries = $derived([{ label: runtimeMode === 'node' ? 'Нода ↑' : 'P2P', state: status === 'fresh' ? 'connected' as const : 'offline' as const, section: 'outgoing' as const,
    detail: runtimeMode === 'node' ? 'Зашифрованная очередь подключённого устройства. Статус доставки смотрите у сообщения.' : 'Прямой режим без очереди. Для свежей проверки прав нужен доступный владелец.' },
    { label: 'Приём ↓', state: ready && status === 'fresh' ? 'connected' as const : 'offline' as const, section: 'incoming' as const,
      detail: 'Подтверждение сообщения отправляется после сохранения; права проверяются свежим ответом ноды или владельца.' }]);
  let authority = $state.raw<DirectoryAuthority | null>((session.approval!.membership.record.body as unknown as MembershipBody).directory ?? null);
  const active = $derived(displayed.byPeer[chats.activePeer]);
  const listedPeers = $derived(visibleConversations(displayed, query, name, owner));
  let showJumpDown = $state(false), chatOpenToken = $state(0);
  const manageChatScroll = createChatScroll({ activePeer: () => chats.activePeer, firstUnread: () => undefined, onJump: visible => showJumpDown = visible });
  let emojiOpen = $state(false), composer = $state<HTMLTextAreaElement>();
  let caret = { start: 0, end: 0 };
  function rememberCaret(event: Event) { const field = event.currentTarget as HTMLTextAreaElement; caret = { start: field.selectionStart, end: field.selectionEnd }; }
  function insertEmoji(value: string) { const start = Math.min(caret.start, draft.length), end = Math.min(caret.end, draft.length);
    draft = draft.slice(0,start) + value + draft.slice(end); caret = { start: start+value.length, end: start+value.length };
    void tick().then(() => { composer?.focus(); composer?.setSelectionRange(caret.start,caret.end); }); }
  function composerKey(event: KeyboardEvent) { if (submitOnEnter(event)) { event.preventDefault(); void send(); } }
  const guard = () => { if (!current || document.hidden) throw new Error('device_session_closed'); };
  function snapshot(): LocalChatData { return snapshotLocalChatData({ selfNickname, readReceiptsEnabled: false, autoLockMinutes: 15,
    peerReadPreferences: {}, aliases, declaredNames, peerPublicKeys: {}, deviceSettings: settings, chats: saveChats(chats) }); }
  async function save() {
    guard(); const data = snapshot(); await writes.enqueue(() => { guard(); return saveLocalChatData(key, device, data); }); guard();
  }
  async function commit(event: DeviceEvent, kind: 'message' | 'sync') {
    guard();
    const bootstrap = readDeviceBootstrap(event, owner);
    if (bootstrap) {
      if (settings.bootstrapSeen?.includes(event.id)) { await save(); return; }
      if ((settings.bootstrapSeen?.length ?? 0) >= 128) throw new Error('device_bootstrap_capacity');
      selfNickname = bootstrap.nickname || selfNickname;
      for (const contact of bootstrap.contacts) {
        if (contact.address === owner || chats.byPeer[contact.address]?.contact === 'blocked') continue;
        chats = setContactState(chats, contact.address, 'accepted');
        if (contact.name) aliases = { ...aliases, [contact.address]: contact.name };
      }
      settings = { ...settings, bootstrapSeen: [...(settings.bootstrapSeen ?? []), event.id] };
      await save(); return;
    }
    const copy = readOwnIncoming(event, owner);
    const peer = copy?.peer ?? (kind === 'sync' ? event.to : event.from);
    const outgoing = !copy && kind === 'sync';
    const decoded = decodeChatContent(copy?.content ?? event.text); if (!decoded || decoded.details?.pin || decoded.details?.ephemeral || decoded.details?.ephemeralOpened) throw new Error('device_content_invalid');
    const conversation = chats.byPeer[peer]; if (conversation?.contact === 'blocked') throw new Error('blocked_contact');
    if (conversation?.deletedIds?.includes(event.id)) return;
    const existing = conversation?.messages.find(m => m.id === event.id);
    if (existing) {
      if (existing.text !== decoded.text || existing.from !== (copy ? peer : event.from) || existing.direction !== (outgoing ? 'outgoing' : 'incoming') ||
        JSON.stringify(existing.details ?? {}) !== JSON.stringify(decoded.details ?? {})) throw new Error('device_message_conflict'); await save(); return;
    }
    if (!copy && kind === 'message' && (!conversation || conversation.contact === 'pending') && (conversation?.messages.length || chats.order.filter(p => chats.byPeer[p].contact === 'pending').length >= 32)) throw new Error('device_request_limit');
    const entry = { id: event.id, from: copy ? peer : event.from, text: decoded.text, timestamp: copy?.timestamp ?? event.timestamp, deviceMessage: true,
      direction: outgoing ? 'outgoing' as const : 'incoming' as const, ...(decoded.details ? { details: decoded.details } : {}) };
    if (copy && !conversation) chats = setContactState(chats, peer, 'accepted');
    if (outgoing) chats = recordSentMessage(chats, peer, entry);
    else {
      if (conversation?.contact === 'outgoing') chats = setContactState(chats, peer, 'accepted');
      chats = receiveMessage(chats, entry);
    }
    if (!chats.activePeer) chats = selectConversation(chats, peer);
    await save(); lastReceived = Date.now();
  }
  async function add(peer: string) {
    if (!chats.byPeer[peer] && history?.chats.byPeer[peer]?.contact === 'accepted') chats = setContactState(chats, peer, 'accepted');
    chats = selectConversation(chats, peer); chatOpenToken++; draft = ''; reply = null; emojiOpen = false; caret = { start: 0, end: 0 }; pane = 'chat'; await save();
    await tick(); if (messages) messages.scrollTop = messages.scrollHeight;
  }
  async function accept() { chats = setContactState(chats, chats.activePeer, 'accepted'); await save(); await runtime?.wake(); }
  async function send() {
    const peer = chats.activePeer, text = draft.trim(); if (!peer || peer === owner || !text || busy || !runtime || active?.contact === 'pending' || active?.contact === 'blocked') return;
    if (new TextEncoder().encode(text).length > 4096) { error = 'На подключённом устройстве сообщение может содержать до 4 КБ текста.'; return; }
    busy = true; error = ''; const id = crypto.randomUUID();
    try {
      if (!await runtime.canSend(peer)) throw new Error('not_ready');
      const details = reply ? { reply } : undefined;
      chats = recordSentMessage(chats, peer, { id, from: owner, text, timestamp: Date.now(), direction: 'outgoing', delivery: 'queued', deviceMessage: true, ...(details ? { details } : {}) });
      await save(); draft = ''; reply = null; await runtime.send(peer, encodeChatContent(text, details), id);
    } catch { error = runtimeMode === 'node' ? 'Сообщение пока не отправлено. Проверьте ноду и подключение контакта; сохранённая очередь повторяется автоматически.' : 'Сообщение пока не отправлено. Для прямого режима нужны доступные владелец и собеседник. Сохранённая очередь повторится при восстановлении связи; несохранённый текст остаётся в поле ввода.'; }
    finally { if (current) busy = false; }
  }
  async function stop() { current = false; ready = false; clearTimeout(confirmTimer); historyStore?.close(); historyStore = undefined; history = null; const stopping = runtime?.stop(); runtime = undefined; await Promise.allSettled([stopping, chat?.disconnect(), writes.settled()]); lease?.release(); }
  async function copy(message: ChatEntry) { try { await navigator.clipboard.writeText(message.text); } catch { error = 'Не удалось скопировать текст.'; } }
  function startReply(message: ChatEntry) { reply = { id: message.id, from: message.from, preview: message.text.slice(0, 120) }; }
  async function remove(message: ChatEntry) {
    const peer = chats.activePeer;
    chats = updateConversation(chats, peer, c => ({ ...c, messages: c.messages.filter(m => m.id !== message.id), deletedIds: [...new Set([...(c.deletedIds ?? []), message.id])] })); await save();
    if (historyStore && history?.chats.byPeer[peer]) { const next = await historyStore.remove(peer, message.id); guard(); history = next; }
  }
  async function historyFile(message: ChatEntry): Promise<Uint8Array | null> {
    if (!message.file || message.fileDeleted || !historyStore) return null;
    const bytes = await historyStore.file(`${chats.activePeer}:${message.file.id}`); guard();
    if (bytes && (bytes.length !== message.file.size || await sha256Hex(bytes) !== message.file.sha256)) { bytes.fill(0); throw new Error('history_file_conflict'); }
    return bytes;
  }
  async function download(message: ChatEntry) {
    let bytes: Uint8Array | null = null;
    try {
      bytes = message.file ? await historyFile(message) : null; guard();
      if (message.file && !bytes) throw new Error('history_file');
      const url = URL.createObjectURL(new Blob(bytes ? [new Uint8Array(bytes).buffer] : [message.text], { type: bytes ? 'application/octet-stream' : 'text/plain;charset=utf-8' })), a = document.createElement('a');
      a.href = url; a.download = message.file ? safeFileName(message.file.name) : 'Automesh-message.txt'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { if (current) error = 'Не удалось открыть сохранённое вложение.'; } finally { bytes?.fill(0); }
  }
  async function importHistory(profile: BackupProfile): Promise<void> {
    guard(); requireHistoryConsistency(snapshot(), profile.data);
    if (!historyStore) throw new Error('history_storage');
    const imported = await historyStore.import(profile); guard(); history = imported;
  }
  async function clearImportedHistory() {
    if (!historyStore || !confirm('Удалить только перенесённую историю и её вложения с этого устройства? Новые сообщения и ключи останутся.')) return;
    try { await historyStore.clear(); guard(); history = null; } catch { if (current) error = 'Не удалось удалить перенесённую историю. Повторите действие.'; }
  }
  function historyAllowed() {
    const body = settings.peers.find(p => p.record.author === owner)?.record.body as unknown as MembershipBody | undefined;
    return !!body && activeMembers(body, Date.now()).some(member => memberDevice(member) === device);
  }
  function runtimeOptions(): Omit<DeviceRuntimeOptions, 'authority'> {
    return { owner, device, identity: session.signer, key, settings: () => settings,
      save: async next => { settings = next; await save(); }, chat, guard,
      contacts: () => chats.order.filter(p => chats.byPeer[p].contact === 'accepted'),
      allowed: peer => isValidAccountId(peer) && chats.byPeer[peer]?.contact !== 'blocked', commit,
      queued: () => chats.order.flatMap(to => chats.byPeer[to].messages.filter(m => m.direction === 'outgoing' && m.deviceMessage && !m.restoredFromBackup && ['queued', 'sending', 'sent', 'stored'].includes(m.delivery ?? '')).map(m => ({ to, text: encodeChatContent(m.text, m.details), id: m.id }))),
      delivery: (peer, id, value) => { if (!current || !chats.byPeer[peer]) return; chats = setDeliveryStatus(chats, peer, id, value); void save().catch(() => {}); },
      status: value => { if (current) status = value; },
      authorityChanged: next => {
        if (!current || settings.authority || upgrading) return;
        // Called only after the exact owner signed a fresh nonce/digest proof.
        settings = { ...settings, authority: next }; authority = next;
        void save().then(() => { setTimeout(() => void upgrade(), 0); }).catch(() => error = 'Не удалось сохранить добавленную владельцем ноду. Повторите проверку.');
      }
    };
  }
  async function upgrade() {
    if (!current || !authority || upgrading || runtimeMode === 'node') return; upgrading = true; ready = false;
    try { await runtime?.stop(); runtime = await openDeviceRuntime({ ...runtimeOptions(), authority }); runtimeMode = 'node'; runtime.start(); }
    catch { if (current) { runtime = await openDirectDeviceRuntime(runtimeOptions()); runtimeMode = 'direct'; runtime.start(); error = 'Нода пока недоступна. Сохранён прямой режим; повторите проверку позже.'; } }
    finally { upgrading = false; if (current) ready = true; }
  }
  onMount(() => {
    const resume = () => { if (current && !document.hidden) void runtime?.wake().catch(() => { status = 'waiting'; }); };
    window.addEventListener('online', resume); window.addEventListener('pageshow', resume);
    document.addEventListener('visibilitychange', resume);
    void (async () => {
      try {
        guard();
        lease = await acquireAccountLease(device); if (!lease.available) throw new Error('device_tab_busy'); guard();
        const saved = await loadLocalChatData(key, device); guard();
        if (saved) { chats = restoreChats(saved.chats); settings = normalizeDeviceSettings(saved.deviceSettings); selfNickname = saved.selfNickname || 'Мой аккаунт'; aliases = saved.aliases; declaredNames = saved.declaredNames; }
        historyStore = deviceHistoryStore({ device, owner, key, guard });
        try { history = await historyStore.load(); guard(); }
        catch { guard(); error = 'Ранее перенесённая история недоступна. Новые сообщения работают отдельно; можно повторить перенос.'; }
        if (!settings.peers.some(p => p.record.author === owner)) settings.peers = [...settings.peers, vault.approval!.membership];
        authority = settings.authority ?? authority;
        settings.authority = authority;
        const endpoints = defaultSignalingEndpoints();
        if (authority) { const url = new URL('/signal', authority.url); url.protocol = 'wss:'; if (!endpoints.some(e => e.url === url.href)) endpoints.push({ url: url.href, kind: isLocalHost(url.hostname) ? 'lan' : 'internet' }); }
        const transport = new RoutedWebRTCTransport(endpoints, false, undefined, undefined, endpoints.map(e => e.url));
        transport.onNodesChange(() => { if (current) nodes = transport.getNodeStates(); }); nodes = transport.getNodeStates();
        chat = new ChatService(transport);
        chat.onPeerChange((peer, event) => { if (!current) return; event === 'joined' ? directPeers.add(peer.address) : directPeers.delete(peer.address); directCount = directPeers.size; });
        if (authority) try { runtime = await openDeviceRuntime({ ...runtimeOptions(), authority }); runtimeMode = 'node'; }
        catch (failure) { if (failure instanceof Error && failure.message === 'device_access_revoked') throw failure; guard(); runtime = await openDirectDeviceRuntime(runtimeOptions()); runtimeMode = 'direct'; }
        else { runtime = await openDirectDeviceRuntime(runtimeOptions()); runtimeMode = 'direct'; }
        guard();
        // Direct signaling is optional; a blocked websocket must not turn a
        // working node inbox into a failed login or keep the form busy.
        void chat.init({ address: device, provider: vault.signer }).catch(() => {});
        runtime.start(); ready = true;
        // Complete enrollment only after fresh authorization and the first
        // receive cycle (including publishing node prekeys) actually succeeded.
        const active = runtime;
        const confirm = async () => { try { await active.wake(); if (current && runtime === active) onConnected(); } catch { if (current && runtime === active) confirmTimer = setTimeout(() => void confirm(), 2000); } };
        void confirm();
      } catch { if (current) error = 'Подключение не подтверждено. Проверьте срок разрешения, отзыв доступа и доступность обновлённой ноды. Можно заблокировать и открыть устройство снова.'; }
    })();
    return () => { window.removeEventListener('online', resume); window.removeEventListener('pageshow', resume); document.removeEventListener('visibilitychange', resume); void stop(); };
  });
</script>
<section class="account-shell" class:chats={!settingsOpen} aria-label={$i18n.text("Чаты подключённого устройства")}>
  <AccountHeader contactUrl={contactLink(owner)} accountId={owner} avatar={identiconFor(owner)} nickname={selfNickname} profile={$i18n.text("Личный")} settings={settingsOpen}
    networkAvailable={directCount>0||nodes.some(n=>n.status==='connected')}
    onProfile={() => profileOpen = true} onPanic={() => {}} panicDisabled onLock={lock}
    onSettings={() => { settingsOpen = !settingsOpen; section = 'overview'; }}>
    {#snippet network()}<ConnectionIndicators compact responsive expanded={networkOpen} onToggle={() => networkOpen = true}
      {nodes} {directCount} serversEnabled courierEnabled courierStatus={idleCourierStatus()} courierPending={0} trusted receiveKeys={0}
      deliveryOverride={deliveries} onOpen={() => { settingsOpen = true; section = 'connection'; }} />{/snippet}
  </AccountHeader>
  <details class="device-capabilities"><summary>{$i18n.text("Подключённое устройство · возможности")}</summary><p>{$i18n.text("Новые текстовые сообщения до 4 КБ синхронизируются отдельно. Старую историю и доступные вложения владелец может передать из настроек устройств. Новые файлы, звонки и исчезающие сообщения пока доступны только на основном устройстве.")}</p></details>
  {#if ready && chat}<HistoryReceive {chat} {owner} {device} {guard} allowed={historyAllowed} commit={importHistory} />{/if}
  {#if error}<p role="alert" class="account-status">{$i18n.text(error)}<button type="button" onclick={() => error = ''} aria-label={$i18n.text("Скрыть уведомление")}>×</button></p>{/if}
  <span class="sr-only" role="status">{status === 'fresh' ? $i18n.text("Список устройств проверен") : status === 'cached' ? $i18n.text("Используется сохранённый список устройств") : $i18n.text("Ожидаем безопасную проверку доступа")}</span>
  {#if settingsOpen}
    <div class="settings-surface settings-content">
      <div class="settings-title"><h3>{$i18n.text(section === 'overview' ? $i18n.text("Настройки") : settingsMenu.find(m => m.id === section)?.label)}</h3></div>
      <SettingsMenu {section} items={settingsMenu} descriptions={settingsDescriptions} onSelect={id => section = id as SettingsSection} />
      {#if section === 'account'}<div class="settings-section"><h4>{$i18n.text("Профиль")}</h4><Avatar accountId={owner} size={56} />
        <label class="settings-field">{$i18n.text("Ник")}<input value={selfNickname} disabled /></label><p class="help-text">{$i18n.text("Изменение общего профиля доступно владельцу. Адрес аккаунта тот же, ключ этого устройства — отдельный.")}</p><p class="address">{owner}</p></div>
      {:else if section === 'security'}<div class="settings-section"><h4>{$i18n.text("Устройства аккаунта")}</h4><p>{$i18n("m_267f1511f1b6", {v0: (new Date(session.approval!.certificate.record.expiresAt!).toLocaleDateString($uiLocale))})}</p>
        {#if history}<button type="button" onclick={() => void clearImportedHistory()}>{$i18n.text("Удалить перенесённую историю и вложения")}</button><p class="help-text">{$i18n.text("Удаляются только исторические копии на этом устройстве. Рабочие сообщения, права и ключи не меняются.")}</p>{/if}
        <button disabled title={rights}>{$i18n.text("Подключить ещё устройство")}</button><p class="help-text">{$i18n.text("Добавлять, продлевать и отзывать устройства может только владелец. Откройте у него «Настройки → Безопасность → Устройства аккаунта».")}</p>
        <h4>{$i18n.text("Блокировка")}</h4><button type="button" onclick={lock}>{$i18n.text("Заблокировать")}</button><h4>{$i18n.text("Восстановление и резервная копия")}</h4><button disabled title={rights}>{$i18n.text("Показать seed и проверить запись")}</button><button disabled title={rights}>{$i18n.text("Сохранить полную копию")}</button>
        <p class="help-text">{$i18n.text("Сид здесь не хранится. Блокировка не удаляет основной аккаунт или его данные.")}</p></div>
      {:else if section === 'connection'}<div class="settings-section"><h4>{$i18n.text("Доставка")}</h4>
        <p>{runtimeMode === 'node' ? $i18n.text("Через ноду · первое устройство можно выключить.") : $i18n.text("Прямой режим · без очереди. Для проверки прав нужен доступный владелец.")}</p><p class="address">{authority?.url ?? $i18n.text("Нода не добавлена.")}</p>
        <p>{$i18n.text("Владелец может добавить ноду в своём разделе устройств. Подключаться заново и передавать сид не нужно.")}</p>
        <h4>{$i18n.text("Диагностика доставки")}</h4><p>{status === 'fresh' ? $i18n.text("Права устройства проверены") : $i18n.text("Ожидаем свежую проверку прав")}</p><p>{$i18n("m_43e005f5e6c8", {v0: (lastReceived ? new Date(lastReceived).toLocaleTimeString($uiLocale) : $i18n.text("пока нет"))})}</p>
        <button type="button" onclick={() => { if (runtimeMode === 'direct' && authority) void upgrade(); else void runtime?.wake().catch(() => error = 'Нужен доступный владелец или нода для свежей проверки прав.'); }}>{$i18n.text("Проверить подключение")}</button>
        {#if runtimeMode === 'node'}<details><summary>{$i18n.text("Дополнительный режим доступности")}</summary><label><input type="checkbox" checked={settings.allowCached} onchange={async e => { settings = { ...settings, allowCached: e.currentTarget.checked }; await save(); }} /> {$i18n.text("Использовать ранее проверенный список, если свежая проверка недоступна")}</label><p class="help-text">{$i18n.text("Менее безопасно: отзыв устройства может стать известен позже. В прямом режиме этот обход не используется.")}</p></details>{/if}</div>
      {:else if section === 'about'}<AboutProject />
      {:else if section === 'application'}<section class="settings-section"><LanguageSettings /><h4>{$i18n.text("Внешний вид")}</h4><ThemeSelector /></section>
      {:else if section === 'overview'}<p class="help-text">{$i18n.text("Тот же профиль, отдельный ключ устройства. Доступны новые текстовые чаты и история с вложениями, переданная владельцем. Новые файлы и звонки пока доступны на основном устройстве.")}</p>
      {:else}<div class="settings-section"><p>{$i18n.system(rights)}</p><p class="help-text">{$i18n.text("Новые файлы, звонки и голосовые сообщения пока доступны на основном устройстве. Уже перенесённые вложения можно открыть и скачать здесь.")}</p></div>{/if}
    </div>
  {:else}
    <div class="chat-layout" class:show-chat={pane === 'chat'} class:show-list={pane === 'list'}>
      <nav class="conversation-list" aria-label={$i18n.text("Личные чаты")}>
        <ContactSearch bind:query ownId={owner} onOpen={peer => void add(peer).catch(() => error = 'Не удалось сохранить контакт.')} />
        <div class="conversation-items">{#each listedPeers as peer (peer)}
          <ConversationRow accountId={peer} name={name(peer)} conversation={displayed.byPeer[peer]} self={peer===owner} active={chats.activePeer===peer} onOpen={()=>void add(peer)} />
        {/each}{#if !displayed.order.length}<p>{$i18n.text("Добавьте собеседника, дождитесь сообщения или примите перенос истории от владельца.")}</p>{/if}</div>
      </nav>
      <section class="conversation-pane" aria-label={$i18n.text("Выбранный чат")}>
        {#if active}
          <div class="chat-heading"><button class="chat-back" type="button" aria-label={$i18n.text("Назад ко всем чатам")} onclick={() => pane = 'list'}>←</button>
            <button class="peer-heading" type="button" onclick={() => peerOpen = true}><Avatar accountId={chats.activePeer} size={32} /><span>{name(chats.activePeer)}<small class="peer-status">{$i18n("m_5e36d1863ec4", {v0: (runtimeMode === 'node' ? $i18n.text("P2P или нода") : $i18n.text("P2P без ноды"))})}</small></span></button>
            <button class="select-messages-button" disabled aria-label={$i18n.text("Позвонить")} title={rights}><ChatIcon name="phone" /></button>
            <button class="select-messages-button" disabled aria-label={$i18n.text("Выбрать сообщения")} title={$i18n.text("Множественный выбор пока недоступен на подключённом устройстве")}><ChatIcon name="select" /></button></div>
          {#if active.contact === 'pending'}<p>{$i18n.text("Новый запрос на общение")}</p><button type="button" onclick={() => void accept().catch(() => error = 'Не удалось подтвердить контакт.')}>{$i18n.text("Принять контакт")}</button>{/if}
          <div class="message-history"><div class="message-scroll" data-chat-scroll bind:this={messages} use:manageChatScroll={{peer: chats.activePeer, lastId: active.messages.at(-1)?.id ?? '', openToken: chatOpenToken}}>
            {#each active.messages as message (message.id)}
              <div data-chat-message-id={message.id}>
              <MessageCard outgoing={message.direction === 'outgoing'} sticker={message.details?.media?.kind === 'sticker'} preview={message.text.slice(0, 80)} onSelect={() => {}}>
                <div class="message-header"><Avatar accountId={message.direction === 'outgoing' ? owner : chats.activePeer} size={18} /><span class="message-author">{message.direction === 'outgoing' ? $i18n.text("Вы") : name(chats.activePeer)}</span>
                  <time datetime={new Date(message.timestamp).toISOString()}>{new Date(message.timestamp).toLocaleTimeString($uiLocale, { hour: '2-digit', minute: '2-digit' })}</time>
                  <button class="quick-reply" type="button" onclick={() => startReply(message)} aria-label={$i18n.text("Ответить на сообщение")} disabled={active.contact !== 'accepted'}>↩</button>
                  <button class="quick-copy" type="button" onclick={() => void copy(message)} aria-label={$i18n.text("Скопировать содержимое сообщения")}>⧉</button>
                  <MessageTools {message} status={messageStatus(message)} recipient={message.direction === 'outgoing' ? chats.activePeer : owner} shareText={message.text}
                    openView={tools?.id === message.id ? tools.view : null} canReply={active.contact === 'accepted'} canPin={false} canForward={false} canSelect={false}
                    onOpen={view => tools = { id: message.id, view }} onClose={() => tools = null} onReply={() => startReply(message)}
                    onForward={() => {}} onSelect={() => {}} onStop={() => {}}
                    onDownload={() => void download(message)} onDelete={() => void remove(message).catch(() => error = 'Не удалось сохранить удаление.')}
                    onPin={() => {}} loadShareFile={async () => { const bytes = await historyFile(message); if (!bytes || !message.file) throw new Error('Вложение не перенесено.'); try { return new File([new Uint8Array(bytes).buffer], safeFileName(message.file.name), { type: message.file.mime }); } finally { bytes.fill(0); } }} />
                </div>
                {#if message.details?.reply}<div class="reply-preview"><small>{$i18n.text("↩ Ответ")}</small><span>{message.details.reply.preview}</span></div>{/if}
                <MessageText text={message.text} />
                {#if message.file}<HistoryAttachment file={message.file} available={message.fileStatus === 'ready'} deleted={message.fileDeleted} load={() => historyFile(message)}
                  timestamp={message.timestamp} sender={message.from === owner ? 'Вы' : name(message.from)} senderAddress={message.from}
                  onReply={active.contact === 'accepted' ? () => startReply(message) : undefined} onShare={() => tools = { id: message.id, view: 'share' }} />{/if}
                {#if message.direction === 'outgoing' || message.file || message.importedFromDevice}<div class="message-actions">
                  <MessageDelivery status={messageStatus(message, chats.activePeer === owner)} provenance={messageProvenance(message)} onDetails={() => tools = { id: message.id, view: 'status' }} />
                </div>{/if}
              </MessageCard>
              </div>
            {/each}
          </div>{#if showJumpDown}<button type="button" class="jump-down" aria-label={$i18n.text("К последним сообщениям")} onclick={() => messages?.scrollTo({top: messages.scrollHeight, behavior:'smooth'})}><ChatIcon name="order-down" /></button>{/if}</div>
          {#if reply}<div class="composer-reply"><span>↩ {reply.preview}</span><button type="button" onclick={() => reply = null} aria-label={$i18n.text("Отменить ответ")}>×</button></div>{/if}
          {#if emojiOpen}<EmojiPicker onChoose={insertEmoji} onClose={() => emojiOpen = false} />{/if}
          <form class="composer" onsubmit={event => { event.preventDefault(); void send(); }}>
            <div class="composer-controls composer-left"><button class="icon-button" type="button" aria-label={$i18n.text("Статус доставки")} onclick={() => { settingsOpen = true; section = 'connection'; }}><ChatIcon name="node" /></button>
              <button class="icon-button" type="button" disabled aria-label={$i18n.text("Прикрепить")} title={rights}><ChatIcon name="attachment" /></button></div>
            <div class="composer-field"><textarea bind:this={composer} bind:value={draft} use:autoSizeComposer={draft} onkeydown={composerKey}
              onselect={rememberCaret} onkeyup={rememberCaret} onclick={rememberCaret} oninput={rememberCaret}
              rows="1" maxlength={4096} aria-label={$i18n.text("Сообщение")} placeholder={chats.activePeer === owner ? $i18n.text("Перенесённая история сохранённых") : $i18n.text("Сообщение…")} disabled={!ready || chats.activePeer === owner || active.contact === 'pending' || active.contact === 'blocked'}></textarea>
              <button class="emoji-toggle" type="button" aria-label={$i18n.text("Выбрать эмодзи")} aria-expanded={emojiOpen} title={$i18n.text("Эмодзи")} disabled={!ready || chats.activePeer === owner || busy || active.contact !== 'accepted'} onclick={() => emojiOpen = !emojiOpen}><ChatIcon name="emoji" /></button></div>
            <div class="composer-controls composer-right"><button class="icon-button" type="button" disabled aria-label={$i18n.text("Записать голосовое сообщение")} title={rights}><ChatIcon name="microphone" /></button>
              <button class="send-button" type="submit" aria-label={$i18n.text("Отправить сообщение")} disabled={!ready || chats.activePeer === owner || busy || !draft.trim() || active.contact === 'pending' || active.contact === 'blocked'}><ChatIcon name="send" /></button></div>
          </form>
        {:else}<p>{$i18n.text("Добавьте собеседника или выберите чат.")}</p>{/if}
      </section>
    </div>
  {/if}
</section>
{#if networkOpen}<CompactDialog title={$i18n.text("Состояние сети")} onClose={() => networkOpen = false}><ConnectionIndicators {nodes} directCount={0} serversEnabled courierEnabled courierStatus={idleCourierStatus()} courierPending={0} trusted receiveKeys={0} deliveryOverride={deliveries} onOpen={() => { networkOpen = false; settingsOpen = true; section = 'connection'; }} /></CompactDialog>{/if}
{#if profileOpen}<CompactDialog title={$i18n.text("Мой профиль")} onClose={() => profileOpen = false}><Avatar accountId={owner} size={56} /><p>{selfNickname}</p><ContactShare accountId={owner} contactUrl={contactLink(owner)} copied={ownIdCopied} onCopy={()=>void navigator.clipboard.writeText(owner).then(()=>ownIdCopied=true).catch(()=>error='Не удалось скопировать Mesh ID.')} />
  <p class="help-text">{$i18n.text("Этот QR позволяет добавить ваш аккаунт в контакты. Он не выдаёт доступ и не подключает новое устройство.")}</p>
  <p>{$i18n.text("Это тот же аккаунт. На этом устройстве хранится собственный ключ, не сид владельца.")}</p></CompactDialog>{/if}
{#if peerOpen && active}<CompactDialog title={$i18n.text("Контакт")} onClose={() => peerOpen = false}><Avatar accountId={chats.activePeer} size={56} /><h3>{name(chats.activePeer)}</h3><p class="address">{chats.activePeer}</p>
  <button type="button" onclick={() => void navigator.clipboard.writeText(chats.activePeer).catch(() => error = 'Не удалось скопировать адрес.')}>{$i18n.text("Скопировать адрес")}</button></CompactDialog>{/if}
<style>
  .address{font-size:12px;overflow-wrap:anywhere}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}.settings-section p{overflow-wrap:anywhere}.account-status{display:flex;justify-content:space-between;align-items:center;gap:8px}
  .device-capabilities{font-size:12px;color:var(--muted);margin:4px 0 8px}.device-capabilities summary{cursor:pointer}.device-capabilities p{margin:6px 0}
</style>
