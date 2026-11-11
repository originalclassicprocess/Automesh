<script lang="ts">
  import {locale as uiLocale} from '$lib/i18n/language';
  import { tr as i18n } from '$lib/i18n/language';
  import LanguageSelector from '$lib/i18n/LanguageSelector.svelte';
  import LanguageSettings from '$lib/i18n/LanguageSettings.svelte';

import { removeLegacyBrowserLogs } from '$lib/application/legacy-cleanup';
import { version } from '$app/environment';
import { createBrowserUpdater } from '$lib/application/browser-updates';
import type { AppUpdateState } from '$lib/application/app-update';
import AppUpdatePanel from '$lib/application/AppUpdatePanel.svelte';
import AboutProject from '$lib/application/AboutProject.svelte';
import HelpInfo from '$lib/application/HelpInfo.svelte';
import { appHelp } from '$lib/application/app-help';
import { navigationLevel } from '$lib/application/navigation-level';
import { toggleSelection, selectEveryMessage } from '$lib/chat/message-selection';
import { selectionSummary } from '$lib/chat/message-selection';
import MessageSelectionBar from '$lib/chat/MessageSelectionBar.svelte';
import ChatIcon from '$lib/chat/ChatIcon.svelte';
import CallPanel from '$lib/calls/CallPanel.svelte';
import CallHistoryCard from '$lib/calls/CallHistoryCard.svelte';
import { recordCall } from '$lib/calls/history';
import { CallController, idleCall, type CallView } from '$lib/calls/controller';
import { defaultStunServers } from '$lib/transport/client-config';
import OfflineKeyBadge from '$lib/chat/OfflineKeyBadge.svelte';
import CompactDialog from '$lib/application/CompactDialog.svelte';
import { installFileDrop } from '$lib/chat/file-drop';
import { autoSizeComposer } from '$lib/chat/composer-size';
import { otherUnreadCount } from '$lib/chat/chat-header';
import MessageCard from '$lib/chat/MessageCard.svelte';
import ChatSearch from '$lib/chat/ChatSearch.svelte';
import EmojiPicker from '$lib/chat/EmojiPicker.svelte';
import { createChatScroll } from '$lib/chat/chat-scroll';
import SendOptions from '$lib/chat/SendOptions.svelte';
import EphemeralViewer from '$lib/chat/EphemeralViewer.svelte';
import { ephemeralState, ephemeralStates, ephemeralExpired, ephemeralLabel, expiredMessage, nextEphemeralOpening } from '$lib/chat/ephemeral';
import MessageText from '$lib/chat/MessageText.svelte';
import MediaLibraryPanel from '$lib/chat/MediaLibraryPanel.svelte';
import MediaViewer from '$lib/chat/MediaViewer.svelte';
import PersistentAudio from '$lib/chat/PersistentAudio.svelte';
import { isQueueAudio, type AudioQueueTrack } from '$lib/chat/audio-queue';
import { contactMediaKind } from '$lib/chat/contact-media';
import { emptyMediaLibrary, normalizeMediaLibrary, libraryFileId, isLibraryFileId, addMedia, makePack, prepareMedia, type MediaLibrary, type PreparedMedia, type MediaAsset, type StickerPack } from '$lib/chat/media-library';
import { importStickerPack, exportStickerPack, type PreparedPack } from '$lib/chat/sticker-pack';
import MessageTools from '$lib/chat/MessageTools.svelte';
import { messageStatus } from '$lib/chat/message-presentation';
import { messagePins, nextPinRevision, visibleChatMessages } from '$lib/chat/message-pins';
import { offlineKeyBudget } from '$lib/chat/offline-key-budget';
import SettingsMenu from '$lib/application/SettingsMenu.svelte';
import SettingsLinks from '$lib/application/SettingsLinks.svelte';
import { settingsMenu, settingsDescriptions, settingsLocation, connectionMenu, mediaSettingsMenu, type SettingsSection, type LegacySettingsSection, type ConnectionSection, type MediaSettingsSection } from '$lib/application/settings-structure';

import QRCode from 'qrcode';
import { onMount, tick, untrack, type Snippet } from 'svelte';
import NotificationToast from '$lib/application/NotificationToast.svelte';
import { accountNotice, type AppNotice } from '$lib/application/notices';
import { browser, dev } from '$app/environment';
import { afterNavigate, pushState, replaceState } from '$app/navigation';
import { page } from '$app/state';

import { validateMnemonic } from '@scure/bip39';

import {
  createIdentityMetadata
} from '$lib/identity/metadata';


import { wordlist } from '@scure/bip39/wordlists/english.js';

import type { WebCryptoIdentity } from '$lib/identity/webcrypto';
import DeviceManager from '$lib/devices/DeviceManager.svelte';
import HistorySend from '$lib/devices/HistorySend.svelte';
import { captureDeviceHistory } from '$lib/devices/history-data';
import { clearDeviceHistory } from '$lib/devices/history-store';
import NewDevice from '$lib/devices/NewDevice.svelte';
import { openBrowserOwnerDevicesWithKey, deriveOwnerDeviceKey, clearOwnerDeviceStorage } from '$lib/devices/owner-browser';
import { requireDeviceAuthority, deviceStartupFailure, deviceNodeCandidate } from '$lib/devices/startup';
import { deviceDeliveryExplanation, reconcileRootOnlyOutbox, requirePolicyProgress } from '$lib/devices/delivery-plan';
import { installDeviceDiscovery } from '$lib/devices/discovery';
import { deviceCopyKinds, deviceCopyJobs, withoutDeviceCopy } from '$lib/devices/replication';
import { requirePrimaryRoute, recoverPrimaryQueued, hasDelegatedWork } from '$lib/application/primary-delivery';
import { deliveryIssueText, deliveryIssueForError, deliveryAttempt, type DeliveryIssue } from '$lib/application/delivery-issues';
import { webCryptoEnvironment } from '$lib/core/ports';
import { contactHandshake } from '$lib/application/contact-handshake';
import ConnectionDashboard from '$lib/node/ConnectionDashboard.svelte';
import { connectionOverview } from '$lib/node/connection-overview';
import { readDeviceLink, DEVICE_LINK_PREFIX } from '$lib/devices/links';
import type { SignedObject } from '$lib/core/objects';
import AccountHeader from '$lib/application/AccountHeader.svelte';
import UnlockForm from '$lib/application/UnlockForm.svelte';
import { deviceBootstrapPackets } from '$lib/devices/bootstrap';
import { clearPendingDeviceStorage } from '$lib/devices/pending-browser';
import { clearDeviceJournals } from '$lib/devices/journal';
import { openDeviceRuntime, openDirectDeviceRuntime, type DeviceRuntime } from '$lib/devices/runtime';
import { emptyDeviceSettings, normalizeDeviceSettings } from '$lib/devices/settings';
import type { DeviceEvent } from '$lib/devices/delivery';
import { inspectHomeNode, requireNodeNetwork, signedNodeRequest } from '$lib/node/client';
import { parseNodeSetup } from '$lib/node/pair-invite';
import { decodeChatContent } from '$lib/chat/message-details';
import { ChatService } from '$lib/chat/ChatService';
import type { TransportStatus } from '$lib/transport/transport';
import {
  emptySessionChats,
  ensureConversation,
  firstUnreadMessageId,
  receiveMessage,
  receiveFileMessage,
  recordSentMessage,
  setContactState,
  setDeliveryStatus,
  setReadState,
  restoreChats,
  saveChats,
  selectConversation,
  updateConversation,
  unreadMessageCount,
  type SessionChats,
  type ChatEntry,
} from '$lib/chat/session-chats';
import { accountFromMnemonic } from '$lib/application/account';
import { acquireAccountLease, type AccountLease } from '$lib/application/account-lease';
import { OutboxController } from '$lib/application/outbox';
import { preparePrivateImage } from '$lib/chat/image-privacy-browser';
import { hasTransparentPixels } from '$lib/chat/transparent-image';
import { clipboardImages, pastedText } from '$lib/chat/clipboard-images';
import PastedImages from '$lib/chat/PastedImages.svelte';
import { SerializedWrites } from '$lib/application/serialized-writes';
import { FileReceiver } from '$lib/application/file-receiver';
import { AutoUnlock } from '$lib/application/auto-unlock';
import StoragePanel from '$lib/application/StoragePanel.svelte';
import { storageThumbnail } from '$lib/application/storage-thumbnail';
import AccountNotices from '$lib/application/AccountNotices.svelte';
import { normalizeProfileLinks, normalizePeerLinks, type ProfileLink } from '$lib/chat/profile-links';
import EmergencyReset from '$lib/application/EmergencyReset.svelte';
import { eraseApplicationData } from '$lib/application/emergency-storage';
import { clearAllCoreStorage } from '$lib/core-storage/indexeddb';
import { clearAllProfileStorage, openBrowserProfileBundle, withBrowserProfileSelection } from '$lib/profiles/browser';
import { resolveCommunicationProfileSelection as resolveProfileSelection } from '$lib/profiles/selection';
import { PROFILE_FEATURES } from '$lib/profiles/features';
import { readProfilesForBackup } from '$lib/profiles/backup-browser';
import ProfilesPanel from '$lib/profiles/ProfilesPanel.svelte';
import ProfileSwitcher from '$lib/profiles/ProfileSwitcher.svelte';
import { ALL_CHATS_VIEW } from '$lib/profiles/presets';
import InboxSnapshot from '$lib/profiles/InboxSnapshot.svelte';
import { prepareProfileChatContext, commitProfileChatContext, readProfileInbox, type ProfileChatContext, type ProfileInboxPage, type InboxFocus } from '$lib/profiles/chat-context';
import { profileRegistrySnapshot, type ProfileRegistry } from '$lib/core/profiles';
import type { OpenedBackup } from '$lib/vault/encrypted-backup';
import { cleanedHistory, managedFiles, chatStorageUsage, type ManagedFile } from '$lib/application/storage-summary';
import { RESET_KEY, beginStorageReset, requireStorageEpoch, storageEpoch } from '$lib/application/storage-reset';
import { encodeChatContent, type MessageDetails, type ReplyReference } from '$lib/chat/message-details';
import { displayedReply, savedConversation, replyReference, replyCount, messagePreview, forwardingDetails, removeMessages, transcript } from '$lib/chat/chat-actions';
import ChatActionDialog from '$lib/application/ChatActionDialog.svelte';
import ContactCard from '$lib/chat/ContactCard.svelte';
import { contactLink, contactFromHash } from '$lib/chat/contact-link';
import { PageNavigation, historyPageState } from '$lib/application/page-navigation';
import { settingsParent, sameSettingsLocation } from '$lib/application/settings-parent';
import ConversationRow from '$lib/chat/ConversationRow.svelte';
import ChatActivity from '$lib/chat/ChatActivity.svelte';
import QueueIndicator from '$lib/chat/QueueIndicator.svelte';
import {queueIndicatorStates} from '$lib/chat/queue-indicator';
import NodeQueueOverview from '$lib/chat/NodeQueueOverview.svelte';
import {freshQueueSnapshot,queueQuotaFull,queueQuotaLabel,messageQuotaFull} from '$lib/node/queue-quota';
import {cleanupErrors,cleanupWaiting} from '$lib/node/queue-cleanup';
import {nodeTransferUpdate,peerDisconnectedMessage} from '$lib/chat/node-transfer';
import {nodeInteractionGroups,nodeInteractionCounts} from '$lib/chat/node-queue-overview';
import {dismissQueueNotices,applyNodeOutcome} from '$lib/chat/node-queue';
import ThemeSelector from '$lib/application/ThemeSelector.svelte';
import { isAppEscape } from '$lib/application/back-key';


import { isValidAccountId } from '$lib/addressing/bech32m.js';
import { identiconFor } from '$lib/addressing/identicon';
import Avatar from '$lib/chat/Avatar.svelte';
import AvatarEditor from '$lib/chat/AvatarEditor.svelte';
import { normalizeAvatar, normalizePeerAvatars } from '$lib/chat/avatar';
import { createPhotoAvatar } from '$lib/chat/avatar-browser';
import type { AvatarCrop } from '$lib/chat/avatar-crop';
import { isRoutineConnectionNotice } from '$lib/chat/connection-notice';
import ConnectionNotice from '$lib/chat/ConnectionNotice.svelte';
import {
  deriveChatStoreKey,
  snapshotLocalChatData,
  deleteLocalChatData,
  loadLocalChatData,
  saveLocalChatData,
  saveLocalSessionData,
  saveLocalFileData,
  loadLocalFileData,
  deleteLocalFileData,
  deleteLocalFiles,
  inspectChatStorage,
  clearAllChatStorage,
  saveChatDataWithFileDeletion,
  type LocalChatData,
} from '$lib/chat/local-store';
import { FILE_CHUNK_BYTES, safeFileName, sha256Hex, type FileOffer } from '$lib/chat/file-transfer';
import { textFitsLimit } from '$lib/chat/text-limits';
import { defaultDeleteHistory, historyAction } from '$lib/chat/session-policy';
import { autoLockIsDue, DEFAULT_AUTO_LOCK_MINUTES, normalizeAutoLockMinutes, readReceiptsForMode } from '$lib/chat/session-settings';
import { inlineMediaFor } from '$lib/chat/media-preview';
import { defaultSignalingEndpoints, isLocalHost } from '$lib/transport/client-config';
import { RoutedWebRTCTransport, type NodeState } from '$lib/transport/RoutedWebRTCTransport';
import { emptyNetworkSettings, normalizeNetworkSettings, signalingNodes, parseSignalingNode,
  nodeInvite, probeSignaling, MAX_LOCAL_NODES, type NetworkSettings, type LocalNode } from '$lib/transport/network-settings';
import NodeScanner from '$lib/transport/NodeScanner.svelte';
import HomeNodePanel from '$lib/node/HomeNodePanel.svelte';
import NodeAdminConsent from '$lib/node/NodeAdminConsent.svelte';
import NodesPanel from '$lib/node/NodesPanel.svelte';
import NodeAdminConnect from '$lib/node/NodeAdminConnect.svelte';
import { MAX_MANAGED_NODES } from '$lib/node/node-registry';
import { parseAdminConnect, type AdminConnect } from '$lib/node/admin-connect';
import { adminConnectBridge } from '$lib/node/admin-bridge';
import { OfflineController } from '$lib/node/offline-controller';
import { CourierController, idleCourierStatus } from '$lib/node/courier-controller';
import { receiveRouting, receptionChannel, receptionFailure } from '$lib/node/receive-routing';
import ChoiceMenu from '$lib/application/ChoiceMenu.svelte';
import QrInput from '$lib/application/QrInput.svelte';
import { emptyDeliveryDiagnostics } from '$lib/node/delivery-diagnostics';
import DeliveryDiagnostics from '$lib/node/DeliveryDiagnostics.svelte';
import { emptyCourierState, restoreCourierState, pruneCourierFiles, type CourierState } from '$lib/node/courier-state';
import { emptyOfflineState, restoreOfflineState } from '$lib/node/offline-state';
import type { NodeAddress } from '$lib/node/offline-crypto';
import type { ChatMessage } from '$lib/chat/ChatService';
import { readQrImage } from '$lib/transport/qr-reader';
import { offlineReadiness } from '$lib/transport/offline-readiness';
import DirectPairing from '$lib/transport/DirectPairing.svelte';
import SeedBackup from '$lib/vault/SeedBackup.svelte';
import SeedEntry from '$lib/vault/SeedEntry.svelte';
import PasswordField from '$lib/vault/PasswordField.svelte';
import EntryAbout from '$lib/application/EntryAbout.svelte';
import { DEFAULT_SEED_WORD_COUNT, generateRegistrationMnemonic } from '$lib/vault/registration';
import { SEED_WORD_COUNTS } from '$lib/vault/seed-words';
import { passwordPolicyError } from '$lib/vault/password-policy';
import BackupReader from '$lib/vault/BackupReader.svelte';
import FullBackup from '$lib/backup/FullBackup.svelte';
import { captureFullBackup, restoreFullBackup } from '$lib/backup/full-backup-browser';
import { restoreDataBackupToStore } from '$lib/backup/data-backup-browser';
import type { DataBackupContents } from '$lib/backup/data-backup';
import { disposeFullBackup, type FullBackupContents } from '$lib/backup/full-backup';
import { setLanguage } from '$lib/i18n/language';
import { submitOnEnter, visibleConversations } from '$lib/chat/conversation-list';
import MessageDelivery from '$lib/chat/MessageDelivery.svelte';
import { messageProvenance } from '$lib/chat/message-presentation';
import ContactSearch from '$lib/chat/ContactSearch.svelte';
import ConnectionIndicators from '$lib/transport/ConnectionIndicators.svelte';
import RadioSettings from '$lib/radio/RadioSettings.svelte';
import RadioIndicator from '$lib/radio/RadioIndicator.svelte';
import RadioQueuePanel from '$lib/radio/RadioQueuePanel.svelte';
import ChatDeliveryOptions from '$lib/radio/ChatDeliveryOptions.svelte';
import RadioContactCard from '$lib/radio/RadioContactCard.svelte';
import RadioContactShare from '$lib/radio/RadioContactShare.svelte';
import { matchingRadioReply, verifyChatRadioContact } from '$lib/radio/contact-exchange';
import RadioReception from '$lib/radio/RadioReception.svelte';
import RadioPresence from '$lib/radio/RadioPresence.svelte';
import { BluetoothRadioPort } from '$lib/radio/bluetooth-port';
import { recordRadioHeard } from '$lib/radio/reception';
import { radioFrameGap } from '$lib/radio/limits';
import { rememberedPort, rememberedChannel, preferredConnection } from '$lib/radio/reconnect';
import { RadioAccountController, radioEligible, radioFallbackReady } from '$lib/radio/account-controller';
import { emptyRadioState, normalizeRadioState, rememberBoard, forgetBoard } from '$lib/radio/account-state';
import { SerialRadio, type RadioSnapshot, type RadioDiagnostics, type SerialPortLike, type RadioPacket } from '$lib/radio/serial-radio';
import { networkId, networkInvite } from '$lib/radio/network';
import { automaticBoardName } from '$lib/radio/board-name';
import MeshtasticChannels from '$lib/radio/MeshtasticChannels.svelte';
import TextForwardDialog, {type ForwardText,type ForwardTarget} from '$lib/chat/TextForwardDialog.svelte';
import HistoryDivider from '$lib/chat/HistoryDivider.svelte';
import {emptyNativeChannels,normalizeNativeChannels,syncNativeChannels,channelText,appendChannelMessage,channelMessageStatus,channelSignature,nativeHistoryLimit,nativeMessageKey,nativeMessageStatus,removeNativeMessages,mergeNativeHistory,visibleNativeChannels,type ChannelMessage,type ChannelText,type ChannelStatus,type NativeChannel} from '$lib/radio/native-channels';
import { radioError } from '$lib/radio/errors';
import VoiceMessage from '$lib/chat/VoiceMessage.svelte';
import InlineAudio from '$lib/chat/InlineAudio.svelte';
import InlineVideo from '$lib/chat/InlineVideo.svelte';
import { automaticFileOffers, MAX_AUTO_FILE_BYTES, validateAttachmentBatch } from '$lib/chat/attachment-policy';

import {
  saveVault,
  loadVault,
  clearVault,
  hasVault,
  discardTransientVaultOnStartup,
  isTrustedDevice,
  setVaultPersistence,
  changeVaultPassword,
} from '$lib/vault/vault';

//import {
//  startChat,
//  sendChatMessage,
//  onChatMessage
//} from '$lib/chat/chat-service';

type Screen =
  | 'entry'
  | 'import'
  | 'setPin'
  | 'unlock'
  | 'account';

let screen = $state<Screen>('entry');
let newDeviceOpen = $state(false), devicesOpen = $state(false);
let deviceInvitation = $state.raw<SignedObject | null>(null), deviceRequestInput = $state(''), deviceRequestNeedsOpen = $state(false);
let newDeviceChatting = $state(false), deviceOffer = $state(false), savedLinkedDevice = $state(false);
let deviceSettings = $state(emptyDeviceSettings()), deviceStatus = $state('Не настроено'), deviceLastReceive = $state(0);
let deviceRuntime = $state.raw<DeviceRuntime | null>(null);
let deviceStore = $state.raw<ReturnType<typeof openBrowserOwnerDevicesWithKey> | null>(null);
let deviceOwnerKey: CryptoKey | null = null;
let deviceBusy = $state(false), deviceErrorCode = $state('');
let deviceAttempt = 0;
let deviceSessionRequested = $state(false), deviceBackgroundNeeded = $state(false);
let historyTarget = $state<{ device: string; label: string } | null>(null);
let deviceInitialization: { chat: ChatService; promise: Promise<void> } | null = null;
let routerReady = $state(false);
// Initial onMount/effects run before SvelteKit finishes hydration. History must
// wait until the router's afterNavigate turn has completed, on every platform.
afterNavigate(() => { queueMicrotask(() => { routerReady = true; }); });

let status = $state('');
let authBusy = $state(false);
let autoUnlockBusy = $state(false);
let authGeneration = 0;
let accountLease: AccountLease | null = null;
let tabCoordinationUnsupported = $state(false);
let addressCopied = $state(false);
type HelpTopic = keyof typeof appHelp;
let openHelp = $state<HelpTopic | null>(null);

let mnemonic = $state('');
let importMnemonic = $state('');
let restoreMethod = $state<'words' | 'file'>('words');
let pendingProfileBackup: ProfileRegistry | undefined;
let pendingFullBackup: FullBackupContents | undefined;
let pendingFullRestored = false;
let fullBackupOpen = $state(false);
let authNickname = $state('');
let registrationWordCount = $state(DEFAULT_SEED_WORD_COUNT);

let pin = $state('');
let unlockPin = $state('');
const autoUnlock = new AutoUnlock((password, current) => unlockAccount(true, password, current));
$effect(() => {
  if (screen === 'unlock') autoUnlock.schedule(unlockPin);
  else autoUnlock.cancel();
  return () => autoUnlock.cancel();
});

let publicKey = $state('');
let address = $state('');
let rootAccountId = $state('');
let profileRegistry = $state<ProfileRegistry | null>(null);
let activeProfileId = $state('');
let profileNetwork = $state(true);
let profileSwitchBusy = $state(false);
let allProfileChats = $state(false);
let profileInboxViewer = $state('');
let requestedProfileId = $state('');
const emptyInboxPage = (): ProfileInboxPage => ({ sources: [], page: 0, totalChats: 0 });
let profileInboxSnapshot = $state<ProfileInboxPage>(emptyInboxPage());
let requestedInboxPage = 0;
let requestedInboxFocus: InboxFocus | undefined;
let lockedProfileId = '';
let requestedProfilePeer = '';

let qrPublic = $state('');
let accountView = $state<'chats' | 'own' | 'profile' | 'peer'>('chats');
let settingsSection = $state<SettingsSection>('overview');
let publicKeyOpen = $state(false);
let profileManagementOpen = $state(false);
let profileBackupOpen = $state(false);
let connectionSection = $state<ConnectionSection>('overview');
let mediaSettingsSection = $state<MediaSettingsSection>('overview');
let connectKind = $state<'profile' | 'admin'>('profile');
let memoryBusy = $state(false);
let storageReading = $state(false);
let storageError = $state('');
let storageFiles = $state<ManagedFile[]>([]);
let storageHistoryBytes = $state(0);
let storageOtherBytes = $state(0);
let storageCacheBytes = $state(0);
let storageOriginUsage = $state<number | undefined>();
let storageQuota = $state<number | undefined>();
let storageRequest = 0;
let memoryConfirmation = $state<{ kind: string; ids: string[] } | null>(null);
let panicOpen = $state(false);
let panicBusy = $state(false);
let panicError = $state('');
let peerCardAddress = $state('');
let peerQr = $state('');
let trustedDeviceChoice = $state(true);
let trustedSession = $state(false);
let pendingExit = $state<'lock' | 'logout' | null>(null);
let deleteHistoryChoice = $state(true);
let endingSession = $state(false);
let switchingTrust = $state(false);
let oldPassword = $state('');
let newPassword = $state('');
let confirmPassword = $state('');
let newAccountFlow = $state(false);
let seedBackupVerified = $state(false);
let backupOpen = $state(false);
let chatSearch = $state('');
let mobilePane = $state<'list' | 'chat'>('list');
let narrowScreen = $state(false);
const configuredNodes = defaultSignalingEndpoints();
let networkSettings = $state<NetworkSettings>(emptyNetworkSettings());
let nodeRows = $derived(signalingNodes(configuredNodes, networkSettings));
let nodeStates = $state<NodeState[]>([]);
let peerRoutes = $state<Record<string, string>>({});
let routedTransport = $state.raw<RoutedWebRTCTransport | null>(null);
let networkBusy = $state(false);
let nodeInput = $state('');
let pendingNodeAdmin = $state<AdminConnect | null>(null);
let nodeCandidate = $state<LocalNode | null>(null);
let candidateName = $state('');
let nodeError = $state('');
let nodeChecks = $state<Record<string, string>>({});
let nodeQr = $state('');
let nodeQrContent = $state('');
let nodeQrUrl = $state('');
let nodeScannerOpen = $state(false);
let offlineState = $state<'ready' | 'missing' | 'outdated' | 'unknown' | 'checking'>('unknown');
let offlineDeliveryState = $state(emptyOfflineState());
let offlineDeliveryError = $state('');
let offlineDelivery: OfflineController | null = null;
let courierState = $state(emptyCourierState());
let courierDelivery: CourierController | null = null;
let courierError = $state('');
let courierStatus = $state(idleCourierStatus());
let deliveryDiagnostics = $state(emptyDeliveryDiagnostics());
let receiveRoutingStamp = '';
let receiveRecoveryBusy = $state(false);
let requiredReceiveUrls = $derived(courierState.node && (courierState.enabled || courierState.keys.length || courierState.pending.length || courierState.incomingFiles.length)
  ? receiveRouting(configuredNodes, networkSettings, page.url.href, courierState).required : []);
let receivingViaHttp = $derived(!!deliveryDiagnostics.inboxAt && !deliveryDiagnostics.inboxFailure && Date.now() - deliveryDiagnostics.inboxAt < 20_000);
let receivingChannel = $derived(receivingViaHttp ? 'Подключён' : receptionChannel(requiredReceiveUrls, nodeStates));
let receivingChannelFailure = $derived(receivingViaHttp ? '' : receptionFailure(requiredReceiveUrls, nodeStates));
let connectionDashboard = $derived.by(() => connectionOverview({ signalingEnabled: networkSettings.signalingEnabled !== false,
  signalingConnected: nodeStates.some(n => n.status === 'connected'), direct: sessionChats.order.filter(p => p !== address && sessionChats.byPeer[p].connection === 'connected').length,
  queueSelected: !!courierState.node, queueEnabled: courierState.enabled, queueConnected: courierStatus.connection === 'connected',
  pending: sessionChats.order.reduce((sum,p) => sum + sessionChats.byPeer[p].messages.filter(m => m.direction === 'outgoing' && !m.restoredFromBackup && ['queued','sending'].includes(m.delivery ?? '')).length,0),
  receiveExpected: !!courierState.node || !!deviceSettings.authority, receiveConnected: receivingChannel === 'Подключён', rights: deviceRuntime?.mode ?? (deviceBackgroundNeeded ? 'unavailable' : 'primary') }));
async function refreshReceiveRouting(): Promise<void> {
  const transport = routedTransport;
  if (!transport || screen !== 'account' || endingSession) return;
  const config = receiveRouting(configuredNodes, networkSettings, location.href, trustedSession ? courierState : emptyCourierState());
  const stamp = JSON.stringify([address, config, networkSettings.quickReserve]);
  if (receiveRoutingStamp === stamp) return;
  await transport.configure(config.endpoints, networkSettings.quickReserve, config.required);
  if (routedTransport === transport && screen === 'account' && !endingSession) receiveRoutingStamp = stamp;
}
async function resumeDelivery(): Promise<void> {
  if (screen !== 'account' || endingSession || receiveRecoveryBusy) return;
  const transport = routedTransport;
  receiveRecoveryBusy = true;
  courierDelivery?.wake();
  void deviceRuntime?.wake().catch(error => { deviceStatus = deviceDeliveryExplanation(error); });
  try { await refreshReceiveRouting();
    if (routedTransport !== transport || screen !== 'account' || endingSession) return;
    await transport?.resume(); if (routedTransport === transport && screen === 'account' && !endingSession) courierDelivery?.wake(); }
  finally { receiveRecoveryBusy = false; }
}
let deviceRetryAfter = 0, deviceRetryDelay = 15000;
async function recoverConfiguredDeviceNode(): Promise<void> {
  if (document.hidden || screen !== 'account' || !profileNetwork || !deviceBackgroundNeeded || !deviceSettings.enabled || navigationBusy() || networkBusy || receiveRecoveryBusy || deviceBusy || !chat || Date.now() < deviceRetryAfter) return;
  if (deviceRuntime?.mode === 'node') { deviceRetryDelay = 15000; return; }
  const node = deviceNodeCandidate(deviceSettings.authority,courierState.node,offlineDeliveryState.node); if (!node) return;
  try { requireNodeNetwork(node.url,networkSettings.internetEnabled === false); } catch { return; }
  deviceRetryAfter = Date.now() + deviceRetryDelay; deviceRetryDelay = Math.min(120000,deviceRetryDelay*2);
  await retryDevices(true);
}
async function persistCourierState(): Promise<boolean> {
  const saved = await persistLocalChats();
  if (saved) await refreshReceiveRouting();
  return saved;
}

async function stopOfflineDelivery(): Promise<void> {
  deviceAttempt++; deviceInitialization = null; deviceBusy = false;
  const devices = deviceRuntime, localDevices = deviceStore; deviceRuntime = null; deviceStore = null;
  localDevices?.close();
  const previous = offlineDelivery; const courier = courierDelivery;
  offlineDelivery = null; courierDelivery = null; queueOverviewOpen=false; previous?.stop(); courier?.stop();
  await Promise.all([previous?.settled(), courier?.settled(), devices?.stop()]);
}

function receiveOfflineMessage(msg: ChatMessage): void {
  const current = sessionChats.byPeer[msg.from];
  if (current?.contact !== 'accepted') throw new Error('offline_contact_not_accepted');
  if (current.deletedIds?.includes(msg.id)) return;
  const existing = current.messages.find(entry => entry.id === msg.id);
  if (existing && (existing.direction !== 'incoming' || existing.text !== msg.text || JSON.stringify(existing.details) !== JSON.stringify(msg.details)))
    throw new Error('conflicting_message_id');
  sessionChats = receiveMessage(sessionChats, { id: msg.id, text: msg.text, from: msg.from, timestamp: msg.timestamp,
    direction: 'incoming', deviceCopies: deviceCopyKinds(address, msg.from, true, deviceSettings.peers),
    ...(msg.details ? { details: msg.details } : {}), ...(msg.courierVia ? { courierVia: msg.courierVia } : {}) });
}

async function configureCourier(node: NonNullable<CourierState['node']>, enabled: boolean): Promise<void> {
  if (!trustedSession || !courierDelivery || endingSession || memoryBusy) throw new Error('offline_requires_trusted');
  await courierDelivery.configure(node, enabled); courierError = '';
  await refreshReceiveRouting();
  if (enabled) await retryDevices(true);
  if (enabled) for (const peer of sessionChats.order) if (sessionChats.byPeer[peer]?.connection === 'connected') publishDeliveryKeys(peer, true);
}
async function useDeliveryNode(node: {url:string;nodeId:string}): Promise<void> {
  if (networkBusy || navigationBusy() || !trustedSession) return;
  networkBusy = true; const generation = authGeneration, owner = address;
  const guard = () => { if (generation !== authGeneration || address !== owner || screen !== 'account' || endingSession) throw new Error('account_locked'); };
  try {
    requireNodeNetwork(node.url, networkSettings.internetEnabled === false);
    const info = await inspectHomeNode(node.url, AbortSignal.timeout(12000)); guard();
    if (info.nodeId !== node.nodeId) throw new Error('node_identity_changed');
    if (!info.courierEnabled || !info.courierAddress) throw new Error('courier_disabled');
    await configureCourier({...node,address:info.courierAddress},true); guard();
    const previous = networkSettings;
    networkSettings = {...networkSettings,managedNodes:(networkSettings.managedNodes ?? []).map(n => n.url === node.url ? {...n,kind:info.role} : n)};
    if (!await persistLocalChats()) { networkSettings = previous; throw new Error('device_settings_not_saved'); }
    status = 'Очередь доставки выбрана и проверена. Прежние задания не удалены. Права устройств проверяются отдельно.';
  } catch(error) { if (generation === authGeneration) status = deviceDeliveryExplanation(error); }
  finally { if (generation === authGeneration) networkBusy = false; }
}

const keyExchange = new Map<string,{chat:ChatService;at:number;busy:boolean}>();
function publishDeliveryKeys(peer: string, force = false): void {
  const active = chat, generation = authGeneration;
  if (peer === address || !active || !trustedSession || screen !== 'account' || endingSession || sessionChats.byPeer[peer]?.contact !== 'accepted' || sessionChats.byPeer[peer]?.connection !== 'connected') return;
  const previous = keyExchange.get(peer);
  if (previous?.chat === active && (previous.busy || !force && Date.now()-previous.at < 30000)) return;
  const entry = {chat:active,at:Date.now(),busy:true}; keyExchange.set(peer,entry);
  const work: Promise<unknown>[] = [];
  if (offlineDeliveryState.node && offlineDeliveryState.enabled) work.push(offlineDelivery!.publish(peer));
  // A receiver can get envelopes through its sender's courier without hosting
  // its own node. Exchange receiver prekeys over the existing MAE channel too.
  if (courierDelivery) work.push(courierDelivery.publish(peer));
  void Promise.allSettled(work).then(results => {
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failed && generation === authGeneration && chat === active) courierError = `Обмен ключами не завершён. ${deliveryIssueText(deliveryIssueForError(failed.reason,'direct_unavailable'),failed.reason)}`;
  }).finally(() => { if (keyExchange.get(peer) === entry) entry.busy = false; });
}

async function authorizePrimary(peer: string): Promise<void> {
  const generation = authGeneration, self = address;
  await requirePrimaryRoute(self,peer,deviceSettings.peers,webCryptoEnvironment());
  if (generation !== authGeneration || self !== address || screen !== 'account' || endingSession) throw new Error('primary_session_changed');
}
function outgoingIssue(peer: string, id: string, code: DeliveryIssue | undefined, error?: unknown): void {
  const old = sessionChats.byPeer[peer]?.messages.find(m => m.id === id);
  if (!old || old.restoredFromBackup || ['delivered','read'].includes(old.delivery ?? '')) return;
  const patch = deliveryAttempt(old,code,error);
  if (old.deliveryIssue === patch.deliveryIssue && old.deliveryError === patch.deliveryError && old.directFallback === patch.directFallback) return;
  sessionChats = updateConversation(sessionChats,peer,c => ({...c,messages:c.messages.map(m => m.id === id ? {...m,...patch} : m)}));
  if (code === 'direct_unavailable' || code === 'direct_receipt_timeout') courierDelivery?.wake();
}
async function preparePrimaryQueues(generation: number): Promise<void> {
  const self = address, allowed = new Set<string>();
  for (const peer of sessionChats.order) {
    if (peer === self || !sessionChats.byPeer[peer].messages.some(m => m.deviceMessage && m.direction === 'outgoing' && m.delivery === 'queued' && !m.restoredFromBackup)) continue;
    try { await authorizePrimary(peer); allowed.add(peer); }
    catch (error) { if (generation !== authGeneration) return; for (const m of sessionChats.byPeer[peer]?.messages ?? []) if (m.delivery === 'queued') outgoingIssue(peer,m.id,deliveryIssueForError(error,'primary_policy_invalid')); }
  }
  if (generation !== authGeneration || self !== address) return;
  const old = sessionChats, next = recoverPrimaryQueued(old,self,allowed);
  if (next !== old) { sessionChats = next; if (!await persistLocalChats()) { sessionChats = old; status = deliveryIssueText('local_storage'); } }
}

async function configureOfflineDelivery(node: NodeAddress, enabled: boolean): Promise<void> {
  if (!trustedSession || !offlineDelivery || endingSession || memoryBusy) throw new Error('offline_requires_trusted');
  await offlineDelivery.configure(node, enabled);
  offlineDeliveryError = '';
  if (enabled) for (const peer of sessionChats.order) {
    if (sessionChats.byPeer[peer]?.connection === 'connected') void offlineDelivery.publish(peer).catch(() => {});
  }
}
let updateState = $state<AppUpdateState>({ phase: 'idle', message: 'Обновления ещё не проверены.' });
let appUpdater: ReturnType<typeof createBrowserUpdater> | null = null;
let nodeWorkToken = 0;
const nodeProbes = new Map<string, AbortController>();

let sessionChats = $state<SessionChats>(emptySessionChats());
let directConnections = $derived(Object.fromEntries(sessionChats.order.filter(peer => peer !== address).map((peer) => [peer, sessionChats.byPeer[peer].connection])));
let chatOpenToken = $state(0);
let signalingStatus = $state<TransportStatus>('idle');
let activeConversation = $derived(sessionChats.byPeer[sessionChats.activePeer]);
let ordinaryUnreadBoundary=$state('');
let activeMessages = $derived(visibleChatMessages(activeConversation?.messages ?? []));
let activeEphemeralStates = $derived(ephemeralStates(activeConversation?.messages ?? []));
let activePins = $derived(messagePins(activeConversation?.messages ?? [], address, sessionChats.activePeer));
let keyBudgetNow = $state(Date.now());
let activeKeyBudget = $derived(offlineKeyBudget(address, sessionChats.activePeer, trustedSession, courierState, offlineDeliveryState, courierStatus.connection === 'connected', keyBudgetNow, courierStatus.keyStocks?.[sessionChats.activePeer]));
let otherUnread = $derived(otherUnreadCount(sessionChats.byPeer, sessionChats.activePeer));
let networkSummaryOpen = $state(false), nodeBudgetOpen = $state(false), fileDragActive = $state(false);
let offlineNodeConfigured = $derived(!!(courierState.enabled && courierState.node || offlineDeliveryState.enabled && offlineDeliveryState.node));
let listedPeers = $derived(visibleConversations(sessionChats, chatSearch, contactName, address));
let connectedPeerCount = $derived(sessionChats.order.filter((peer) => peer !== address && sessionChats.byPeer[peer].connection === 'connected').length);
let courierWaiting = $derived(sessionChats.order.reduce((count, peer) => count + sessionChats.byPeer[peer].messages.filter(m =>
  m.direction === 'outgoing' && (m.delivery === 'queued' || m.delivery === 'sent') && peer !== address).length, 0));
let replyDrafts = $state<Record<string, ReplyReference>>({});
let selecting = $state(false); let selectedMessages = $state<string[]>([]);
let chatSearchPosition=0;
function toggleChatSearch(){const node=document.querySelector<HTMLElement>('[data-chat-scroll]');if(!chatSearchOpen){chatSearchPosition=node?.scrollTop??0;chatSearchOpen=true;}else{chatSearchOpen=false;void tick().then(()=>node?.scrollTo({top:chatSearchPosition}));}}
let chatSearchOpen = $state(false), emojiOpen = $state(false), showJumpDown = $state(false);
let composerCaret = { peer: '', start: 0, end: 0 };
let sendOptionsOpen = $state(false), sendRule = $state<MessageDetails['ephemeral']>(undefined);
let ephemeralOpening = $state(false);
let ephemeralView = $state.raw<{ message: ChatEntry; peer: string; account: string; deadline: number; url?: string; bytes?: Uint8Array } | null>(null);
let ephemeralPurging = false;
const purgedEphemeral = new Set<string>();
let attachmentMenu = $state(false);
let mediaLibrary = $state<MediaLibrary>(emptyMediaLibrary());
let mediaOpen = $state(false);
let mediaTab = $state<'gifs' | 'stickers'>('stickers');
let mediaBusy = $state(false);
let receivedPack = $state.raw<PreparedPack | null>(null);
let actionMode = $state<'forward' | 'contact' | 'delete' | null>(null);
let messageTools = $state<{ id: string; view: 'menu' | 'status' | 'route' | 'share' } | null>(null);
let copiedMessageId = $state(''); let pinBusy = $state(false);
let actionBusy = $state(false); let actionError = $state('');
let actionPeer = ''; let highlightedMessage = $state('');
let allowForwardAttribution = $state(true);
let actionRows = $derived(sessionChats.order.map(id => ({ id, name: id === address ? 'Вы (Сохранённые)' : contactName(id) })));
let attachmentInput = $state<HTMLInputElement>();
let pastedFiles = $state<File[]>([]), composerSending = $state(false);
let pastedScope = '';
$effect(() => {
  const scope = `${authGeneration}:${screen}:${sessionChats.activePeer}`;
  if (scope !== pastedScope) untrack(() => { pastedScope=scope; pastedFiles=[]; sendRule=undefined; sendOptionsOpen=false; emojiOpen=false; ephemeralOpening=false; closeEphemeral(); });
});
let attachingFiles = $state(false);
let voiceBusy = $state(false);
let voiceNotice = $state<AppNotice | null>(null);
let automaticFileBytes = 0;
let autoReceiveFilesEnabled = $state(true);
let autoPlayVideoEnabled = $state(true);
let cleanImageMetadataEnabled = $state(true);
let galleryMedia = $derived(activeConversation?.messages.filter((entry) =>
  entry.file && ['image','video'].includes(contactMediaKind(entry)) && mediaCanOpen(entry)) ?? []);
let galleryId = $state('');
let galleryItems = $derived(galleryMedia.some(entry => entry.id === galleryId) ? galleryMedia :
  activeConversation?.messages.filter(entry => entry.id === galleryId && entry.file && mediaCanOpen(entry)) ?? []);
let galleryIndex = $derived(galleryItems.findIndex((entry) => entry.id === galleryId));
let audioTrack = $state<{ key: string; peer: string; id: string; load(id: string): Promise<{bytes:Uint8Array;mime:string}>; loadShareFile(id: string): Promise<File> } | null>(null);
let audioControls = $state<{ dismissOverlay(): boolean }>();
let audioQueue: AudioQueueTrack[] = $derived((audioTrack ? sessionChats.byPeer[audioTrack.peer]?.messages ?? [] : [])
  .filter(message => isQueueAudio(message) && mediaCanOpen(message))
  .sort((a,b) => a.timestamp - b.timestamp)
  .map(message => ({ id: message.id, name: message.file!.name, size: message.file!.size, mime: message.file!.mime,
    timestamp: message.timestamp, sender: message.from === address ? 'Вы' : contactName(message.from), senderAddress: message.from })));
let imageUrls = $state<Record<string, string>>({});
let imageErrors = $state<Record<string, boolean>>({});
let selfNickname = $state('');
let selfLinks = $state<ProfileLink[]>([]), peerLinks = $state<Record<string, ProfileLink[]>>({});
let seedNoticeDismissed = $state(false);
let selfAvatar = $state('');
let peerAvatars = $state<Record<string, string>>({});
let avatarBusy = $state(false);
let avatarError = $state('');
let readReceiptsEnabled = $state(false);
let trustedReadReceiptsPreference = true;
let autoLockMinutes = $state(DEFAULT_AUTO_LOCK_MINUTES);
let peerReadPreferences = $state<Record<string, boolean>>({});
let nicknameDraft = $state('');
let aliases = $state<Record<string, string>>({});
let declaredNames = $state<Record<string, string>>({});
let peerPublicKeys = $state<Record<string, string>>({});
let aliasDraft = $state('');
let copiedContactId = $state('');
let pendingContactLink = $state('');
let pendingContactRoute = $state<{ peer: string; url: string; owner: string } | null>(null);
$effect(() => { if (pendingContactRoute && pendingContactRoute.owner !== address) pendingContactRoute = null; });
let sharingContact = $state(false);
let shareFallbackLink = $state('');
$effect(() => {
  if (!routerReady || !pendingContactLink || screen !== 'account' || authBusy || !chat) return;
  const id = pendingContactLink; pendingContactLink = '';
  replaceState(location.pathname + location.search, untrack(() => page.state));
  openDirectChat(id);
  status = id === address ? 'Это ваш аккаунт.' : 'Контакт открыт. Напишите первое сообщение, чтобы отправить запрос.';
});
type PageRoute = { screen: Screen; layer: string; view: typeof accountView; peer: string; card: string;
  pane: 'list' | 'chat'; settings: LegacySettingsSection; connection: ConnectionSection; media?: MediaSettingsSection; gallery: string };
let pageNavigation = $state.raw<PageNavigation<PageRoute> | null>(null);
let navigationAccount = '';
let restoringPage = false;
let rootBackTimer: ReturnType<typeof setTimeout> | undefined;
function rootRoute(screen: Screen): PageRoute {
  return { screen, layer: '', view: 'chats', peer: '', card: '', pane: 'list', settings: 'account', connection: 'direct', gallery: '' };
}
$effect(() => {
  const layer = panicOpen ? 'panic' : memoryConfirmation ? 'memory' : mediaOpen || receivedPack ? 'media-library' : actionMode ? 'action' : pendingExit ? 'exit' : networkSummaryOpen ? 'network-summary' : nodeBudgetOpen ? 'node-budget' :
    backupOpen ? 'backup' : nodeScannerOpen ? 'scanner' : attachmentMenu ? 'attachment' : selecting ? 'selection' : openHelp ?? '';
  const route: PageRoute = screen === 'account' ? { screen, layer, view: accountView, peer: sessionChats.activePeer, card: accountView === 'peer' ? peerCardAddress : '',
    pane: mobilePane, settings: accountView === 'profile' ? settingsSection : 'account',
    connection: accountView === 'profile' && settingsSection === 'connection' ? connectionSection : 'direct',
    media: accountView === 'profile' && settingsSection === 'files' ? mediaSettingsSection : 'overview', gallery: galleryId } : { ...rootRoute(screen), layer };
  if (!routerReady || !pageNavigation) return;
  const scope = screen === 'account' ? address : screen === 'unlock' ? 'locked' : 'authentication';
  if (navigationAccount !== scope) {
    clearTimeout(rootBackTimer);
    navigationAccount = scope;
    pageNavigation.start(rootRoute(screen === 'account' ? 'account' : screen === 'unlock' ? 'unlock' : 'entry'));
  }
  if (restoringPage) pageNavigation.replace(route);
  else pageNavigation.visit(route);
});

let tempSeed: Uint8Array | null = null;

let chatStoreKey: CryptoKey | null = null;
let identity = $state<WebCryptoIdentity | null>(null);
let radioState = $state(emptyRadioState()), radioSnapshot = $state.raw<RadioSnapshot | null>(null);
let radioDiagnostics = $state.raw<RadioDiagnostics | null>(null), radioSelected = $state(0);
let radioBusy = $state(false), radioErrorText = $state(''), radioContact = $state('');
let radioChecking=$state(false);
let meshtastic=$state(emptyNativeChannels()),nativeOpen=$state(false),nativeSelected=$state(''),nativeSending=$state(false);
let nativeLive=$state<string[]>([]),nativeSaveTimer:ReturnType<typeof setTimeout>|null=null;
let nativeInitialUnread=$state(0),nativeAtBottom=$state(true),nativeForwardDone=$state(0);
let textForward=$state<{messages:ForwardText[];native?:string;peer?:string}|null>(null);
function nativeListConversation(c:NativeChannel){return {peerAddress:nativeToken(c),messages:[],draft:c.draft??'',unread:c.unread,connection:'offline' as const,error:'',sending:false,contact:'accepted' as const};}
function openNativeForward(c:NativeChannel,messages:ChannelMessage[]){if(!messages.length)return;textForward={native:nativeToken(c),messages:messages.map(m=>({key:nativeMessageKey(m),text:m.text,source:`Meshtastic · ${c.name||'LoRa'} · ${m.name||'!'+m.from.toString(16)}`}))};}
async function sendForwardText(target:string,m:ForwardText){
  const generation=authGeneration,source=textForward;
  if(!source||endingSession||screen!=='account')throw Error('Сеанс завершён.');
  if(target.startsWith('radio:')){
    const c=meshtastic.channels.find(c=>nativeToken(c)===target.slice(6));if(!c)throw Error('Канал недоступен.');
    await sendNativeText(c,m.text);
  }else{
    const peer=target.slice(5);
    if(sessionChats.byPeer[peer]?.contact==='new'&&source.messages.length>1)throw Error('Новому контакту можно переслать одно текстовое сообщение.');
    if(source.native)await queueRichMessage(peer,`${m.source}\n${m.text}`,{});
    else {const original=source.peer&&sessionChats.byPeer[source.peer]?.messages.find(entry=>entry.id===m.key);if(!original||original.file||original.details?.ephemeral)throw Error('Исходное сообщение удалено или отсутствует на этом устройстве.');
      const author={accountId:original.from,nickname:original.from===address?selfNickname:declaredNames[original.from]??''};
      await queueRichMessage(peer,original.text,forwardingDetails(original,author,allowForwardAttribution,address));}
  }
  if(generation!==authGeneration)throw Error('Сеанс завершён.');
}
function finishTextForward(){if(textForward?.native)nativeForwardDone++;textForward=null;selecting=false;selectedMessages=[];status='Переслано или добавлено в очередь доставки.';}
function setNativeDraft(c:NativeChannel,text:string,replyId?:number){meshtastic={...meshtastic,channels:meshtastic.channels.map(entry=>nativeToken(entry)===nativeToken(c)?{...entry,draft:text.slice(0,600),replyId}:entry)};saveNativeSoon();}
function nativeBottom(value:boolean){nativeAtBottom=value;if(value&&nativeOpen&&accountView==='chats'&&(!narrowScreen||mobilePane==='chat')&&document.visibilityState==='visible'){const c=meshtastic.channels.find(c=>nativeToken(c)===nativeSelected);if(c?.unread){meshtastic={...meshtastic,channels:meshtastic.channels.map(entry=>nativeToken(entry)===nativeSelected?{...entry,unread:0}:entry)};saveNativeSoon();}}}
async function setNativePreferences(patch:Partial<Pick<typeof meshtastic,'showAll'|'historyLimit'>>){
  const before=meshtastic,generation=authGeneration;
  const limit=nativeHistoryLimit(patch.historyLimit??meshtastic.historyLimit);
  meshtastic={...meshtastic,...patch,historyLimit:limit,channels:meshtastic.channels.map(c=>({...c,messages:c.messages.slice(-limit),unread:Math.min(c.unread,limit)}))};
  if(!await persistLocalChats()&&generation===authGeneration){
    meshtastic={...meshtastic,showAll:before.showAll,historyLimit:before.historyLimit,channels:meshtastic.channels.map(c=>{const old=before.channels.find(x=>nativeToken(x)===nativeToken(c));return old?{...c,messages:mergeNativeHistory(old,c,nativeHistoryLimit(before.historyLimit))}:c;})};throw Error('Не удалось сохранить настройку.');
  }
}
async function deleteNativeMessages(c:NativeChannel,ids:string[]){
  const generation=authGeneration,before=meshtastic.channels.find(x=>nativeToken(x)===nativeToken(c));if(!before)return;
  meshtastic=removeNativeMessages(meshtastic,c,ids);
  if(!await persistLocalChats()&&generation===authGeneration){
    const removed=new Set(ids.filter(id=>before.messages.some(m=>nativeMessageKey(m)===id)&&!before.deleted?.includes(id)));
    meshtastic={...meshtastic,channels:meshtastic.channels.map(x=>{if(nativeToken(x)!==nativeToken(c))return x;const restored={...x,deleted:(x.deleted??[]).filter(id=>!removed.has(id)),unread:Math.max(x.unread,before.unread)};return {...restored,messages:mergeNativeHistory(before,restored,nativeHistoryLimit(meshtastic.historyLimit))};})};
    throw Error('Не удалось сохранить историю.');
  }
}

const nativeToken=(c:Pick<NativeChannel,'node'|'key'>)=>`${c.node}:${c.key}`;
function saveNativeSoon(){
  if(nativeSaveTimer)return;const generation=authGeneration;
  nativeSaveTimer=setTimeout(()=>{nativeSaveTimer=null;if(generation===authGeneration&&radioAvailable)void persistLocalChats();},300);
}
function receiveNativeText(node:number,packet:ChannelText){
  if(!radioAvailable||!meshtastic.enabled)return;
  const c=meshtastic.channels.find(c=>c.node===node&&c.index===packet.channel&&nativeLive.includes(nativeToken(c)));
  if(!c)return;
  if(packet.from===node){meshtastic=channelMessageStatus(meshtastic,c.key,node,packet.id,'accepted');saveNativeSoon();return;}
  const visible=nativeOpen&&nativeAtBottom&&accountView==='chats'&&(!narrowScreen||mobilePane==='chat')&&document.visibilityState==='visible'&&nativeSelected===nativeToken(c);
  meshtastic=appendChannelMessage(meshtastic,c.key,node,{id:packet.id,from:packet.from,name:packet.name,text:packet.text,timestamp:packet.receivedAt,outgoing:false,status:'accepted',...(packet.reception?{reception:packet.reception}:{}),...(packet.replyId?{replyId:packet.replyId}:{})},visible);
  saveNativeSoon();
}
function receiveNativeStatus(node:number,update:ChannelStatus){
  if(!radioAvailable)return;
  const c=meshtastic.channels.find(c=>c.node===node&&c.index===update.channel&&nativeLive.includes(nativeToken(c)));
  if(!c||!c.messages.some(m=>m.outgoing&&m.from===node&&m.id===update.id))return;
  meshtastic=channelMessageStatus(meshtastic,c.key,node,update.id,update.status,update.failure);saveNativeSoon();
}
function openNativeChannels(value?:string){
  if(navigationBusy()||voiceBusy||!meshtastic.enabled)return;
  clearMediaPreview();selecting=false;messageTools=null;attachmentMenu=false;emojiOpen=false;nativeOpen=true;mobilePane='chat';
  selectNativeChannel(value||nativeLive[0]||(nativeListed[0]?nativeToken(nativeListed[0]):''));
}
function selectNativeChannel(value:string){nativeInitialUnread=meshtastic.channels.find(c=>nativeToken(c)===value)?.unread??0;nativeAtBottom=true;nativeSelected=value;}
async function setNativeEnabled(value:boolean){
  const before=meshtastic,generation=authGeneration;meshtastic={...meshtastic,enabled:value,configured:true};
  if(!await persistLocalChats()&&generation===authGeneration){meshtastic={...meshtastic,enabled:before.enabled,configured:before.configured};throw Error(radioError('radio_history_not_saved'));}
  if(generation===authGeneration&&!value)nativeOpen=false;
}
async function setNativeSignature(channel:NativeChannel,value:boolean){
  const generation=authGeneration,before=channel.signature;meshtastic={...meshtastic,channels:meshtastic.channels.map(c=>nativeToken(c)===nativeToken(channel)?{...c,signature:value}:c)};
  if(!await persistLocalChats()&&generation===authGeneration){meshtastic={...meshtastic,channels:meshtastic.channels.map(c=>nativeToken(c)===nativeToken(channel)?{...c,signature:before}:c)};throw Error(radioError('radio_history_not_saved'));}
}
async function sendNativeText(channel:NativeChannel,text:string,options:{replyId?:number;retryOf?:number;literal?:boolean}={}){
  const runtime=radioRuntime,usb=radioUsb,generation=authGeneration,epoch=radioEpoch,node=radioSnapshot?.node;
  const current=()=>generation===authGeneration&&epoch===radioEpoch&&runtime===radioRuntime&&usb===radioUsb&&radioAvailable&&meshtastic.enabled&&nativeLive.includes(nativeToken(channel));
  if(!runtime||!usb||nativeSending||radioConnection!=='connected'||node!==channel.node||!current())throw Error(radioError('radio_not_ready'));
  let full:string;try{full=channelText(text,options.literal?false:channel.signature,contactLink(address));}catch{throw Error('Сообщение с подписью не должно превышать 200 байт.');}
  let id=crypto.getRandomValues(new Uint32Array(1))[0]||1;while(channel.messages.some(m=>m.from===node&&m.id===id))id=(id+1)>>>0||1;
  nativeSending=true;let recorded=false;
  meshtastic=appendChannelMessage(meshtastic,channel.key,node,{id,from:node,name:radioBoardLabel,text:full,timestamp:Date.now(),outgoing:true,status:'queued',...(options.replyId?{replyId:options.replyId}:{}),...(options.retryOf?{retryOf:options.retryOf}:{})},nativeOpen&&nativeSelected===nativeToken(channel)&&nativeAtBottom);
  try{
    if(!await persistLocalChats())throw Error('radio_history_not_saved');
    recorded=true;
    await runtime.scheduleChannelSend(()=>usb.sendChannelText(channel.index,id,full,options.replyId),current);
    if(current()){meshtastic=channelMessageStatus(meshtastic,channel.key,node,id,'accepted');await persistLocalChats();}
  }catch(error){
    if(generation===authGeneration){const code=error instanceof Error?error.message:'';meshtastic=channelMessageStatus(meshtastic,channel.key,node,id,code==='radio_queue_confirmation_timeout'||!current()?'unknown':'failed');await persistLocalChats();}
    throw recorded?Object.assign(Error(radioError(error)),{nativeAttemptRecorded:true}):Error(radioError(error));
  }finally{if(generation===authGeneration)nativeSending=false;}
}
let radioTransportReady=$state(false),radioRoutesRevision=$state(0);
let radioOverviewOpen=$state(false);
let radioHeard = $state<Record<string,number>>({});
let preferRadio = $derived(radioState.preferredPeers?.includes(sessionChats.activePeer)??false);
let radioRuntime = $state.raw<RadioAccountController|null>(null), radioUsb:SerialRadio|null=null;
const activeRadioNode = $derived.by(()=>{void radioRoutesRevision;void keyBudgetNow;return radioContact && radioState.routes[sessionChats.activePeer] ? radioRuntime?.peerNode(sessionChats.activePeer) : undefined;});
const activeRadioRoute=$derived.by(()=>{void radioRoutesRevision;void keyBudgetNow;return !!radioRuntime?.hasRoute(sessionChats.activePeer);});
const radioBoardLabel=$derived(radioState.boards?.find(b=>b.node===(radioSnapshot?.node??radioState.connection?.node))?.name??'');
const activeRadioReception=$derived(sessionChats.byPeer[sessionChats.activePeer]?.messages.findLast(m=>m.direction==='incoming'&&m.radioReception)?.radioReception);
let radioProbe:SerialRadio|null=null;
let radioEpoch = 0, radioAutomaticBusy = false;
let radioClosing: Promise<unknown> = Promise.resolve(), radioRecoverAfter=0;
let radioHealthCheck:Promise<void>|null=null,lastRadioWake=0;
const rememberedRadioPorts = new Map<string,SerialPortLike>();
let radioAvailable = $derived(screen === 'account' && !!identity && profileNetwork && trustedSession && !!chatStoreKey && !endingSession && !switchingTrust);
let radioConnection = $derived(radioBusy || radioChecking ? 'connecting' as const : radioTransportReady && radioRuntime && radioSnapshot && radioContact ? 'connected' as const : 'offline' as const);
const nativeListed=$derived(visibleNativeChannels(meshtastic,radioConnection==='connected'?radioSnapshot?.node:undefined,nativeLive,chatSearch));
const conversationItems=$derived([
  ...listedPeers.map(peer=>({kind:'chat' as const,id:peer,time:peer===address?Number.MAX_SAFE_INTEGER:sessionChats.byPeer[peer]?.messages.at(-1)?.timestamp??0})),
  ...nativeListed.map(channel=>({kind:'radio' as const,id:nativeToken(channel),channel,time:channel.messages.at(-1)?.timestamp??0}))
].sort((a,b)=>b.time-a.time));
const textForwardTargets=$derived<ForwardTarget[]>([
  ...sessionChats.order.filter(peer=>['new','accepted'].includes(sessionChats.byPeer[peer]?.contact)).map(peer=>({id:'chat:'+peer,name:peer===address?$i18n.text('Сохранённые'):contactName(peer),radio:false})),
  ...(meshtastic.enabled&&radioConnection==='connected'?meshtastic.channels.filter(c=>nativeLive.includes(nativeToken(c))).map(c=>({id:'radio:'+nativeToken(c),name:`${c.name||'Meshtastic'} · ${c.boardName||radioBoardLabel}`,radio:true,signatureBytes:c.signature?new TextEncoder().encode('\n'+channelSignature(contactLink(address))).length:0})):[])
]);

function disconnectRadio() {
  radioOverviewOpen=false;
  ++radioEpoch; radioRuntime?.close(); radioRuntime = null;
  const usb = radioUsb,probe=radioProbe; radioUsb = null;radioProbe=null;
  radioClosing=Promise.all([radioClosing,usb?.close(),probe?.close()]).catch(()=>{});
  radioSnapshot = null; radioContact = ''; radioBusy = false;radioChecking=false; radioTransportReady=false; radioHeard = {};radioRoutesRevision++;nativeLive=[];
}
$effect(() => {
  const scope = `${authGeneration}:${address}:${radioAvailable}`;
  untrack(() => { if (radioScope !== scope) { radioScope = scope; disconnectRadio();radioRecoverAfter=0;lastRadioWake=0; } });
});
let radioScope = '';
$effect(()=>{if(radioAvailable&&radioState.reconnect)untrack(()=>void recoverRadio());});
let radioQueue = $derived(sessionChats.order.flatMap(peer => sessionChats.byPeer[peer].messages.filter(m => m.radioDelivery && !['delivered','read'].includes(m.delivery??'')).map(m => ({peer,id:m.id,timestamp:m.timestamp}))));
async function attachRadio(snapshot: RadioSnapshot, channel: number, epoch: number, packets:RadioPacket[]=[],channelPackets:ChannelText[]=[] ) {
  const usb = radioUsb, signer = identity, generation = authGeneration, account = address;
  if (!usb || !signer) return;
  const current = () => radioEpoch === epoch && radioUsb === usb && authGeneration === generation && address === account && radioAvailable;
  usb.onPacket=packet=>{if(current()&&packets.length<32)packets.push(packet);};
  usb.onChannelText=packet=>{if(current()&&channelPackets.length<64)channelPackets.push(packet);};
  const selected = snapshot.channels.find(c => c.index === channel); if (!selected) throw Error('radio_incomplete_config');
  radioRuntime?.close(); radioRuntime = null; radioContact = '';
  const network = await networkId(networkInvite(snapshot.profile, selected));
  if (!current()) return;
  const runtime = await RadioAccountController.open({ signer, account, current,
    state: () => radioState, setState: value => radioState = value,
    chats: () => sessionChats, setChats: value => sessionChats = value, persist: persistLocalChats,
    nodeReserved: (peer,id) => courierState.pending.some(job => job.body.id === id) || offlineDeliveryState.pending.some(job => job.messageId === id) || !!sessionChats.byPeer[peer]?.messages.find(m => m.id === id && (m.delivery === 'stored' || m.courierStage)),
    error: code => { if (current()) radioErrorText = radioError(code); },
    delivered: (peer,id) => outbox.acknowledge(peer,id),
  }, network, snapshot.node, usb, channel, radioFrameGap(snapshot.profile.preset));
  if (!current()) { runtime.close(); return; }
  radioRuntime = runtime; radioContact = runtime.contact; radioSelected = channel;radioRoutesRevision++;
  const native=await syncNativeChannels(meshtastic,snapshot);if(!current()){runtime.close();return;}
  meshtastic=native;
  nativeLive=native.channels.filter(c=>c.node===snapshot.node&&snapshot.channels.some(s=>s.index===c.index)).filter(c=>native.channels.filter(x=>x.node===snapshot.node&&x.index===c.index).at(-1)===c).map(nativeToken);
  if(nativeOpen&&!meshtastic.showAll&&!nativeLive.includes(nativeSelected)&&nativeLive.length)selectNativeChannel(nativeLive[0]);
  const connection={node:snapshot.node,network,channel,...(usb.selectedPort?.transport==='bluetooth'?{transport:'bluetooth' as const,deviceId:usb.selectedPort.deviceId}:{})};
  radioState=rememberBoard({...radioState,reconnect:true,connection},{...connection,name:automaticBoardName(snapshot.name,snapshot.shortName,usb.selectedPort?.deviceName,snapshot.node),customName:false,firmware:snapshot.firmware.slice(0,64),lastSeen:Date.now()});
  if (!await persistLocalChats()) { if(current())disconnectRadio(); return; }
  if(current()) {
    radioErrorText='';usb.onPacket=packet=>{if(current())runtime.receivePacket(packet);};
    for(const packet of packets)runtime.receivePacket(packet);packets.length=0;
    usb.onChannelText=packet=>{if(current())receiveNativeText(snapshot.node,packet);};
    usb.onChannelStatus=update=>{if(current())receiveNativeStatus(snapshot.node,update);};
    for(const packet of channelPackets)receiveNativeText(snapshot.node,packet);channelPackets.length=0;
    void runtime.resumePending().catch(error=>{if(current())radioErrorText=radioError(error);});
  }
}
async function connectRadio(automatic=false,requestedNode?:number,kind?:'usb'|'bluetooth') {
  if (!radioAvailable || radioBusy || radioUsb) return;
  const epoch = ++radioEpoch, usb = new SerialRadio(); radioUsb = usb; radioBusy = true; radioErrorText = '';
  usb.onConnection=ready=>{if(radioEpoch===epoch&&radioUsb===usb)radioTransportReady=ready;};
  const packets:RadioPacket[]=[];usb.onPacket=packet=>{if(radioEpoch===epoch&&packets.length<32)packets.push(packet);};
  const channelPackets:ChannelText[]=[];usb.onChannelText=packet=>{if(radioEpoch===epoch&&channelPackets.length<64)channelPackets.push(packet);};
  usb.onDiagnostics = value => { if (radioEpoch === epoch && radioUsb === usb) radioDiagnostics = value; };
  usb.onHeard=(node,at)=>{if(radioEpoch!==epoch||radioUsb!==usb)return;radioHeard=recordRadioHeard(radioHeard,node,at);};
  usb.onError = code => {
    if (radioEpoch !== epoch || radioUsb !== usb) return;
    radioErrorText = radioError(code);
    if (['radio_usb_disconnected','radio_serial_error','radio_bluetooth_disconnected','radio_bluetooth_timeout','radio_device_restarted'].includes(code)) disconnectRadio();
  };
  try {
    const target=requestedNode?(radioState.boards??[]).find(b=>b.node===requestedNode):automatic?preferredConnection(radioState):radioState.connection;
    const key=`${address}:${target?.node??radioState.own?.contact.body.node??''}`;
    const previous=rememberedRadioPorts.get(key);
    const transport=kind??target?.transport??'usb';
    const cached=previous&&(previous.transport??'usb')===transport?previous:undefined;
    const port = transport==='bluetooth' ? (automatic ? cached??await BluetoothRadioPort.remembered(target?.deviceId??'') : requestedNode&&cached?cached:await BluetoothRadioPort.requestPort()) : automatic ? rememberedPort(await SerialRadio.grantedPorts(),cached) : requestedNode&&cached?cached:await SerialRadio.requestPort();
    await radioClosing;
    if(radioEpoch!==epoch||radioUsb!==usb||!radioAvailable)return;
    const selectedPort=port instanceof BluetoothRadioPort?new BluetoothRadioPort(port.device):port;
    const snapshot = await usb.open(selectedPort);
    if (radioEpoch !== epoch || radioUsb !== usb) { void usb.close(); return; }
    radioSnapshot = snapshot;
    if(requestedNode&&snapshot.node!==requestedNode)throw Error('radio_wrong_board');
    const channel=await rememberedChannel(snapshot,target?{...radioState,connection:target}:radioState,automatic||!!requestedNode);
    if(radioEpoch!==epoch||radioUsb!==usb)return;
    rememberedRadioPorts.set(`${address}:${snapshot.node}`,selectedPort);
    const savedKeys=[radioState.own,...(radioState.keys??[])].filter(k=>k?.contact.body.node===snapshot.node&&k.contact.body.network===(target?.network??radioState.connection?.network));
    if(automatic&&savedKeys.length&&!savedKeys.some(k=>k&&k.contact.body.expires>Date.now()))throw Error('radio_contact_expired');
    await attachRadio(snapshot, channel, epoch,packets,channelPackets);
  } catch (error) { if (radioEpoch === epoch) {
    // Preserve a freshly read channel list only when the user needs to choose
    // a replacement network. Every other incomplete start releases the link.
    if(automatic||requestedNode||!(error instanceof Error&&error.message==='radio_channel_changed'&&radioSnapshot))disconnectRadio();
    radioErrorText = radioError(error);radioRecoverAfter=Date.now()+30000;
  } }
  finally { if (radioEpoch === epoch) radioBusy = false; }
}
async function recoverRadio(wake=false){
  if(!radioAvailable||!radioState.reconnect||!preferredConnection(radioState)||radioBusy)return;
  if(wake&&Date.now()-lastRadioWake<3000)return;
  if(wake)lastRadioWake=Date.now();
  if(radioUsb){
    if(!wake||radioHealthCheck||!radioRuntime||radioUsb.selectedPort?.transport!=='bluetooth')return;
    const usb=radioUsb,epoch=radioEpoch;
    radioChecking=true;
    const work=(async()=>{
      try{await usb.resume();}
      catch(error){
        // A GATT error may already have closed the failed session via onError.
        // Never close a newer session, or recover after the account was locked.
        if(radioUsb===usb&&radioEpoch===epoch){disconnectRadio();radioErrorText=radioError(error);}
        if(!radioUsb&&radioAvailable&&radioState.reconnect){radioRecoverAfter=0;await connectRadio(true);}
      }
    })();
    radioHealthCheck=work;try{await work;}finally{if(radioHealthCheck===work){radioHealthCheck=null;radioChecking=false;}}
    return;
  }
  if(!wake&&Date.now()<radioRecoverAfter)return;
  radioRecoverAfter=Date.now()+30000;await connectRadio(true);
}
async function stopRadio(){radioState={...radioState,reconnect:false};disconnectRadio();await persistLocalChats();}
async function chooseRadioBoard(node:number){if(radioSnapshot?.node===node&&radioContact)return;disconnectRadio();await connectRadio(false,node);}
function selectRadioBoard(kind:'usb'|'bluetooth'='usb'){disconnectRadio();void connectRadio(false,undefined,kind);}
function reconnectRadioBoard(){disconnectRadio();void connectRadio(false,preferredConnection(radioState)?.node);}
async function commitRadioPreferences(next:typeof radioState){
  const previous=radioState,generation=authGeneration;radioState=next;
  if(!await persistLocalChats()&&generation===authGeneration){
    radioState={...radioState,boards:previous.boards,defaultNode:previous.defaultNode,connection:previous.connection,reconnect:previous.reconnect};
    radioErrorText=radioError('radio_history_not_saved');
  }
}
async function saveRadioBoard(node:number,name:string){
  const value=name.trim();if(!value||value.length>32||/[\u0000-\u001f\u007f]/.test(value))return;
  await commitRadioPreferences({...radioState,boards:(radioState.boards??[]).map(b=>b.node===node?{...b,name:value,customName:true}:b)});
}
async function defaultRadioBoard(node:number){const board=radioState.boards?.find(b=>b.node===node);if(!board)return;await commitRadioPreferences({...radioState,defaultNode:node,connection:board});}
async function deleteRadioBoard(node:number){if(radioSnapshot?.node===node)disconnectRadio();rememberedRadioPorts.delete(`${address}:${node}`);await commitRadioPreferences(forgetBoard(radioState,node));}
async function checkRadioBoard(node:number){
  if(!radioAvailable||radioBusy)return;
  const generation=authGeneration,account=address,active=radioSnapshot?.node===node&&!!radioContact,probe=active?radioUsb!:new SerialRadio();radioBusy=true;radioErrorText='';
  if(!active)radioProbe=probe;
  try{
    const savedBoard=radioState.boards?.find(b=>b.node===node);
    const port=active?undefined:rememberedRadioPorts.get(`${account}:${node}`)??(savedBoard?.transport==='bluetooth'?await BluetoothRadioPort.requestPort():await SerialRadio.requestPort());
    await radioClosing;if(generation!==authGeneration||account!==address||!radioAvailable)return;
    const snapshot=active?await probe.check():await probe.open(port!);
    if(generation!==authGeneration||account!==address||!radioAvailable)return;
    if(snapshot.node!==node)throw Error('radio_wrong_board');
    if(port)rememberedRadioPorts.set(`${account}:${node}`,port);
    const board=radioState.boards?.find(b=>b.node===node);
    const channel=board?await rememberedChannel(snapshot,{...radioState,connection:board},true):radioSelected;
    if(active){radioSnapshot=snapshot;await attachRadio(snapshot,channel,radioEpoch);}
    else if(board){radioState=rememberBoard(radioState,{...board,name:automaticBoardName(snapshot.name,snapshot.shortName,probe.selectedPort?.deviceName,node),customName:false,firmware:snapshot.firmware.slice(0,64),lastSeen:Date.now()});await persistLocalChats();}
  }catch(error){if(generation===authGeneration){if(active)disconnectRadio();radioErrorText=radioError(error);radioRecoverAfter=0;}}
  finally{if(!active){await probe.close();if(radioProbe===probe)radioProbe=null;}if(generation===authGeneration)radioBusy=false;}
}
async function setPreferRadio(value:boolean){
  const peer=sessionChats.activePeer,previous=radioState,generation=authGeneration;
  radioState={...radioState,preferredPeers:value?[...new Set([...(radioState.preferredPeers??[]),peer])].slice(-16):(radioState.preferredPeers??[]).filter(p=>p!==peer)};
  if(!await persistLocalChats()&&generation===authGeneration){radioState=previous;throw Error(radioError('radio_history_not_saved'));}
}
async function changeRadioChannel(index: number) {
  if (!radioSnapshot || radioBusy) return;
  const epoch = radioEpoch; radioBusy = true; radioErrorText = '';
  try { await attachRadio(radioSnapshot,index,epoch); }
  catch (error) { if (radioEpoch === epoch) radioErrorText = radioError(error); }
  finally { if (radioEpoch === epoch) radioBusy = false; }
}
async function setRadioAutomatic(value: boolean) {
  const old = radioState, generation = authGeneration; radioState = { ...old, automatic: value };
  if (!await persistLocalChats() && generation === authGeneration) radioState = old;
}
async function importRadioRoute(text: string) {
  if (!radioRuntime || !radioAvailable) throw Error('radio_not_ready');
  try { const runtime=radioRuntime,peer=await runtime.addRoute(text);radioRoutesRevision++; radioErrorText = '';await runtime.resumePending(peer); }
  catch (error) { throw Error(radioError(error)); }
}
async function shareRadioContact(peer: string, replyTo?: string) {
  const runtime=radioRuntime;
  if(!runtime||!radioAvailable||radioBusy)throw Error(radioError('radio_not_ready'));
  if(peer===address||sessionChats.byPeer[peer]?.contact!=='accepted')throw Error(radioError('radio_contact_not_accepted'));
  const invite=runtime.contact;
  // A repeated accept click reuses the durable outgoing card rather than
  // producing a second handshake. Normal delivery retries remain responsible.
  const prior=sessionChats.byPeer[peer].messages.find(m=>m.direction==='outgoing'&&!m.details?.forwarded&&
    m.details?.radioContact?.invite===invite&&m.details.radioContact.replyTo===replyTo);
  if(!prior)await queueRichMessage(peer,'LoRa',{radioContact:{invite,...(replyTo?{replyTo}:{})}});
  else {courierDelivery?.wake();if(chat)void flushOutbox(peer,chat);}
  attachmentMenu=false;
}
async function acceptChatRadioContact(peer:string,id:string){
  const runtime=radioRuntime,generation=authGeneration;
  if(!runtime||!radioAvailable||radioBusy)throw Error(radioError('radio_not_ready'));
  const message=sessionChats.byPeer[peer]?.messages.find(m=>m.id===id),offer=message?.details?.radioContact;
  if(!message||message.direction!=='incoming'||message.details?.forwarded||!offer||sessionChats.byPeer[peer].contact!=='accepted')throw Error(radioError('radio_contact_not_accepted'));
  try{
    const contact=await verifyChatRadioContact(offer.invite,peer,runtime.crypto.contact.body.network);
    if(runtime!==radioRuntime||generation!==authGeneration)throw Error('radio_closed');
    await runtime.addRoute(offer.invite,true,peer);
    radioRoutesRevision++;
    if(!offer.replyTo)await shareRadioContact(peer,contact.body.keyId);
    if(runtime===radioRuntime)await runtime.resumePending(peer);
  }catch(error){throw Error(radioError(error));}
}
const radioRepliesChecked=new WeakMap<RadioAccountController,Set<string>>();
$effect(()=>{
  const runtime=radioRuntime,available=radioAvailable,chats=sessionChats;
  if(!runtime||!available)return;
  untrack(()=>{
    const checked=radioRepliesChecked.get(runtime)??new Set<string>();radioRepliesChecked.set(runtime,checked);
    for(const peer of chats.order){
      const c=chats.byPeer[peer];if(c.contact!=='accepted')continue;
      for(const message of c.messages.filter(m=>m.direction==='incoming'&&m.details?.radioContact?.replyTo).slice(-1)){
        const key=`${peer}:${message.id}`;if(checked.has(key))continue;
        if(checked.size>=256)checked.delete(checked.values().next().value!);checked.add(key);
        // Only a matching answer to our own sent offer is automatic. Unsolicited
        // and forwarded cards always require an explicit accept action.
        void (async()=>{
          if(!await matchingRadioReply(message,c.messages,runtime.crypto.contact))return;
          if(runtime!==radioRuntime||!radioAvailable||sessionChats.byPeer[peer]?.contact!=='accepted')return;
          await runtime.addRoute(message.details!.radioContact!.invite,true,peer);
          radioRoutesRevision++;
          if(runtime===radioRuntime)await runtime.resumePending(peer);
        })().catch(()=>{/* Invalid cards remain visible for an explicit retry. */});
      }
    }
  });
});
async function retryRadio(peer: string,id: string) {
  const runtime=radioRuntime,generation=authGeneration;
  try {
    if (!runtime) throw Error('radio_not_ready');
    sessionChats=updateConversation(sessionChats,peer,c=>({...c,messages:c.messages.map(m=>m.id===id&&!m.radioDelivery&&radioEligible(m)?{...m,radioDelivery:'queued',deliveryIssue:undefined,deliveryError:undefined}:m)}));
    if(!await persistLocalChats()||generation!==authGeneration)return;
    await runtime.send(peer,id);radioErrorText='';
  }
  catch(error){if(generation===authGeneration){radioErrorText=radioError(error);const m=sessionChats.byPeer[peer]?.messages.find(m=>m.id===id);if(m?.radioDelivery==='queued')markRadioRetry(peer,id);}}
}
async function releaseRadio(peer: string,id: string) {
  const generation = authGeneration, previousRadio=radioState;
  radioRuntime?.acknowledge(peer,id);
  radioState = { ...radioState, pending: radioState.pending.filter(e => e.peer !== peer || e.id !== id) };
  sessionChats = updateConversation(sessionChats,peer,c => ({...c,messages:c.messages.map(m => m.id === id ? {...m,radioDelivery:'stopped',radioSuppressed:true} : m)}));
  if (!await persistLocalChats()) {
    if (generation === authGeneration) {
      disconnectRadio();radioState=previousRadio;
      sessionChats=updateConversation(sessionChats,peer,c=>({...c,messages:c.messages.map(m=>m.id===id?{...m,radioDelivery:'retry',radioSuppressed:undefined}:m)}));
    }
    return;
  }
  if (generation !== authGeneration) return;
  sessionChats = updateConversation(sessionChats,peer,c => ({...c,messages:c.messages.map(m => m.id === id ? {...m,radioDelivery:undefined} : m)}));
  if (!await persistLocalChats() || generation !== authGeneration) return;
  courierDelivery?.wake(); if (chat && sessionChats.byPeer[peer]?.connection === 'connected') void flushOutbox(peer,chat);
}
async function automaticRadio() {
  const runtime = radioRuntime, generation = authGeneration;
  if (radioAutomaticBusy || !runtime || !radioState.automatic || !radioAvailable) return;
  radioAutomaticBusy = true;
  try {
    for (const peer of sessionChats.order) {
      const c = sessionChats.byPeer[peer];
      if (c.contact !== 'accepted' || c.connection === 'connected' || !runtime.hasRoute(peer)) continue;
      for (const m of c.messages.filter(m => radioFallbackReady(m,{accepted:c.contact==='accepted',directConnected:c.connection==='connected',hasRoute:runtime.hasRoute(peer),
        nodeReady:!!(courierState.enabled&&courierState.node&&courierStatus.connection==='connected')||!!(offlineDeliveryState.enabled&&offlineDeliveryState.node),
        nodeReserved:courierState.pending.some(j=>j.body.id===m.id)||offlineDeliveryState.pending.some(j=>j.messageId===m.id)}))) {
        if (generation !== authGeneration || runtime !== radioRuntime) return;
        if (courierState.pending.some(job => job.body.id === m.id) || offlineDeliveryState.pending.some(job=>job.messageId===m.id)) continue;
        sessionChats = updateConversation(sessionChats,peer,c => ({...c,messages:c.messages.map(e => e.id === m.id ? {...e,radioDelivery:'queued',deliveryIssue:undefined,deliveryError:undefined} : e)}));
        if (!await persistLocalChats() || generation !== authGeneration) return;
        try { await runtime.send(peer,m.id); } catch (error) { if (generation === authGeneration) { radioErrorText=radioError(error); markRadioRetry(peer,m.id); } }
      }
    }
  } finally { radioAutomaticBusy = false; }
}
function markRadioRetry(peer:string,id:string) {
  sessionChats=updateConversation(sessionChats,peer,c=>({...c,messages:c.messages.map(m=>m.id===id&&!['delivered','read'].includes(m.delivery??'')?{...m,radioDelivery:'retry'}:m)}));
  void persistLocalChats();
}
let chat = $state.raw<ChatService | null>(null);
let calls: CallController | null = null;
let callView = $state<CallView>(idleCall());
let callStream = $state<MediaStream | null>(null);
let callBusy = $derived(callView.phase !== 'idle' && callView.phase !== 'ended');
async function startCall(peer: string): Promise<void> {
  if (!calls || navigationBusy() || voiceBusy || callBusy) return;
  if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') {
    status = 'Этот браузер не поддерживает голосовые звонки. Откройте приложение по HTTPS в современном браузере.'; return;
  }
  try { await calls.start(peer); }
  catch { status = 'Для звонка собеседник должен быть на связи и принять контакт. Попробуйте подключиться к чату.'; }
}
const historyWrites = new SerializedWrites();
const outbox = new OutboxController<ChatService>({
  state: () => sessionChats, setState: (state) => { sessionChats = state; },
  sender: () => chat, persist: persistLocalChats,
  authorize: authorizePrimary, issue: outgoingIssue,
});
const readReceiptSending = new Set<string>();
const peerReadConfirmed = new Set<string>();
const visibleReadNodes = new Map<string, { peer: string; messageId: string; visible: boolean }>();
const sessionFiles = new Map<string, Uint8Array>();
let lockedSession: { accountId: string; data: LocalChatData; files: Map<string, Uint8Array>; trusted: boolean } | null = null;
const incomingFiles = new Map<string, FileReceiver>();
const sendingFiles = new Set<string>();
const fileRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const fileRetryAttempts = new Map<string, number>();
const pendingFileWrites = new Set<Promise<void>>();
const imageLoading = new Set<string>();
const imageUrlOrder: string[] = [];
let previewGeneration = 0;
let lastActivity = Date.now();

onMount(() => {
  const keyBudgetTimer = setInterval(() => { keyBudgetNow = Date.now(); void recoverConfiguredDeviceNode().catch(() => {});
    for (const peer of sessionChats.order) publishDeliveryKeys(peer);
    void automaticRadio();
    void recoverRadio();
  }, 10_000);

  if (!browser) return;
  const nodeAdminLink = location.href;
  let adminBridge: ReturnType<typeof adminConnectBridge> | undefined;
  if (typeof BroadcastChannel !== 'undefined') {
    adminBridge = adminConnectBridge(new BroadcastChannel('Automesh/node-admin-connect/v1'),
      () => screen === 'account' && !!identity && !endingSession && !pendingNodeAdmin,
      request => { pendingNodeAdmin = request; },
      ticket => { if (pendingNodeAdmin?.ticket === ticket && screen !== 'account') { pendingNodeAdmin = null; status = 'Подтвердите вход в уже открытой вкладке Automesh.'; } });
  }
  if (new URL(location.href).searchParams.has('nodeAdmin')) {
    try { pendingNodeAdmin = parseAdminConnect(location.href); } catch { status = 'Запрос входа в ноду неверен или истёк.'; }
    const clean = new URL(location.href);
    for (const key of ['nodeAdmin', 'nodeId', 'ticket', 'expiresAt']) clean.searchParams.delete(key);
    history.replaceState(history.state, '', clean);
    if (pendingNodeAdmin) adminBridge?.send(nodeAdminLink);
  }
  const readContactLink = (event?: Event) => {
    // The SPA router may have restored a clean URL before hashchange reaches
    // this listener. Use the event's original destination, not a mutable hash.
    const source = event instanceof HashChangeEvent ? event.newURL : location.href;
    const sourceHash = new URL(source).hash;
    if (sourceHash.startsWith(DEVICE_LINK_PREFIX)) {
      try {
        const text = source, link = readDeviceLink(text);
        if (link.kind === 'invite') { deviceInvitation = link.value; if (screen !== 'account') newDeviceOpen = true; else status = 'Это приглашение для нового устройства. Откройте ссылку на нём; текущий аккаунт не изменён.'; }
        else { status = 'Подключение начинается в основном аккаунте: «Настройки → Безопасность → Подключить новое устройство». На втором устройстве отсканируйте его QR; обратная заявка больше не нужна.'; }
      } catch { status = 'Ссылка подключения повреждена. Скопируйте её целиком или покажите новый QR.'; }
      const clean = new URL(location.href); clean.hash = ''; history.replaceState(history.state, '', clean); return;
    }
    const id = contactFromHash(sourceHash);
    if (id) pendingContactLink = id;
    else if (sourceHash.startsWith('#/contact/')) status = 'Ссылка содержит неверный Mesh ID.';
  };
  readContactLink(); window.addEventListener('hashchange', readContactLink);
  pageNavigation = new PageNavigation({
    get state() { return untrack(() => page.state); },
    pushState(state) { pushState('', state as App.PageState); },
    replaceState(state) { replaceState('', state as App.PageState); },
    back() { window.history.back(); },
    go(delta) { window.history.go(delta); },
  }, restorePageRoute, () => {
    status = 'Ещё раз «Назад» — покинуть приложение. Это не выход из аккаунта.';
    clearTimeout(rootBackTimer);
    rootBackTimer = setTimeout(() => {
      pageNavigation?.rearmRoot();
      if (status.startsWith('Ещё раз «Назад»')) status = '';
    }, 2000);
  }, undefined, navigationLevel);
  // Let the router process its entry first, but restore from the event payload:
  // a reactive page.state can still point at the screen we are leaving.
  const onPageBack = (event: PopStateEvent) => queueMicrotask(() => {
    if (navigationBusy()) { pageNavigation?.stay(); return; }
    if (audioControls?.dismissOverlay()) { pageNavigation?.stay(); return; }
    if (allProfileChats && accountView === 'chats' && profileNetwork) { allProfileChats = false; pageNavigation?.stay(); return; }
    restoringPage = true;
    pageNavigation?.pop(historyPageState(event.state));
    void tick().then(() => { restoringPage = false; });
  });
  window.addEventListener('popstate', onPageBack);
  removeLegacyBrowserLogs(() => window.localStorage);
  appUpdater = createBrowserUpdater(state => { updateState = state; });
  const checkUpdates = () => { if (!document.hidden && navigator.onLine) void appUpdater?.updater.check(); };
  const initialUpdateCheck = window.setTimeout(checkUpdates, 10_000);
  const periodicUpdateCheck = window.setInterval(checkUpdates, 15 * 60_000);
  window.addEventListener('online', checkUpdates);
  const onStorageReset = (event: StorageEvent) => {
    if (event.key !== RESET_KEY || !event.newValue) return;
    discardAllOpenData();
    status = 'В другой вкладке запрошено экстренное стирание. Этот сеанс завершён.';
  };
  window.addEventListener('storage', onStorageReset);

  const mobileQuery = window.matchMedia('(max-width: 700px)');
  const updateScreenWidth = () => { narrowScreen = mobileQuery.matches; };
  updateScreenWidth();
  mobileQuery.addEventListener('change', updateScreenWidth);

  discardTransientVaultOnStartup();
  const exists = hasVault();
  trustedDeviceChoice = exists ? isTrustedDevice() : true;
  savedLinkedDevice = !!localStorage.getItem('automesh-device-lab-id-v1');
  if (!exists && savedLinkedDevice) newDeviceOpen = true;

  if (exists) {

    screen = 'unlock';

  }

  const handleUnload = () => {
    adminBridge?.close();
    stopNodeTools();
    clearMediaPreview();
    clearSensitiveData();
    releaseAccountLease();
    discardTransientVaultOnStartup();
    // This synchronous cleanup also covers a browser restoring an old tab after restart.
    if (sessionStorage.getItem('vault')) sessionStorage.removeItem('vault');
  };

  const handleVisibility = () => {

    if (document.hidden) {

      hideDisplayedSecrets();
    } else {
      checkIdleTimeout();
      scanVisibleMessages();
      void resumeDelivery();
      void recoverRadio(true);
    }
  };

  const handleFocus = () => {scanVisibleMessages();void recoverRadio(true);};
  const handlePageShow = (event: PageTransitionEvent) => { if (event.persisted) {void resumeDelivery();void recoverRadio(true);} };
  window.addEventListener('pageshow', handlePageShow);
  window.addEventListener('online', resumeDelivery);

  const handleActivity = () => {
    if (screen === 'account' && autoLockIsDue(lastActivity, Date.now(), autoLockMinutes)) {
      checkIdleTimeout();
    } else {
      lastActivity = Date.now();
    }
  };

  const idleTimer = window.setInterval(() => { checkIdleTimeout(); void purgeExpiredMessages(); }, 1000);
  for (const eventName of ['pointerdown', 'keydown', 'touchstart', 'wheel']) {
    window.addEventListener(eventName, handleActivity, { passive: true });
  }

  window.addEventListener(
    'beforeunload',
    handleUnload
  );

  document.addEventListener(
    'visibilitychange',
    handleVisibility
  );
  window.addEventListener('focus', handleFocus);

  return () => {
    offlineDelivery?.stop(); offlineDelivery = null;
    adminBridge?.close();
    courierDelivery?.stop(); courierDelivery = null; queueOverviewOpen=false;
    window.removeEventListener('hashchange', readContactLink);
    pageNavigation?.clear(); pageNavigation = null;
    clearTimeout(rootBackTimer);
    window.removeEventListener('popstate', onPageBack);
    clearInterval(keyBudgetTimer);
    clearSensitiveData();
    releaseAccountLease();
    discardTransientVaultOnStartup();
    void chat?.disconnect();
    appUpdater?.dispose(); appUpdater = null;
    window.clearTimeout(initialUpdateCheck); window.clearInterval(periodicUpdateCheck);
    window.removeEventListener('online', checkUpdates);
    window.removeEventListener('storage', onStorageReset);
    stopNodeTools();
    mobileQuery.removeEventListener('change', updateScreenWidth);
    clearMediaPreview();

    window.removeEventListener(
      'beforeunload',
      handleUnload
    );

    document.removeEventListener(
      'visibilitychange',
      handleVisibility
    );
    window.removeEventListener('focus', handleFocus);
    window.removeEventListener('pageshow', handlePageShow);
    window.removeEventListener('online', resumeDelivery);
    window.clearInterval(idleTimer);
    for (const eventName of ['pointerdown', 'keydown', 'touchstart', 'wheel']) {
      window.removeEventListener(eventName, handleActivity);
    }
  };
});

function checkIdleTimeout(): void {
  if (screen === 'account' && !endingSession && autoLockIsDue(lastActivity, Date.now(), autoLockMinutes)) {
    void endSession('lock', false);
  }
}

async function prepareAppReload(): Promise<string | null> {
  if (callBusy) return 'Завершите звонок перед обновлением приложения.';
  if (authBusy || endingSession || switchingTrust || pendingExit) return 'Дождитесь завершения текущей операции.';
  if (voiceBusy || attachingFiles) return 'Завершите запись аудио или добавление файлов перед обновлением.';
  if (sendingFiles.size || incomingFiles.size || pendingFileWrites.size || sessionChats.order.some(peer =>
      sessionChats.byPeer[peer].messages.some(message => message.fileStatus === 'sending' || message.fileStatus === 'receiving' || message.delivery === 'sending')))
    return 'Дождитесь завершения передачи сообщений и файлов.';
  if (sessionChats.order.some(peer => sessionChats.byPeer[peer].draft.trim())) return 'Сначала отправьте или сохраните черновики сообщений.';
  if (backupOpen || fullBackupOpen || mnemonic || pin || importMnemonic || oldPassword || newPassword || confirmPassword)
    return 'Завершите работу с резервной копией или паролем перед обновлением.';
  if (screen === 'account') {
    await endSession('lock', false);
    if ((screen as Screen) !== 'unlock' || status) return status || 'Не удалось безопасно заблокировать аккаунт. Обновление отменено.';
  }
  return null;
}

async function applyAppUpdate(): Promise<void> {
  await appUpdater?.updater.apply(prepareAppReload);
  if (updateState.phase === 'error') status = updateState.message;
}

function clearSensitiveData() {
  if(nativeSaveTimer)clearTimeout(nativeSaveTimer);nativeSaveTimer=null;meshtastic=emptyNativeChannels();nativeOpen=false;nativeSelected='';nativeSending=false;textForward=null;
  disconnectRadio(); radioState = emptyRadioState(); radioDiagnostics = null; radioErrorText = '';
  historyTarget = null;
  deviceAttempt++; deviceInitialization = null; deviceBusy = false; deviceErrorCode = '';
  void deviceRuntime?.stop(); deviceRuntime = null; deviceStore = null; deviceOwnerKey = null;
  devicesOpen = false; deviceSettings = emptyDeviceSettings(); deviceStatus = 'Не настроено'; deviceLastReceive = 0;
  deviceSessionRequested = false; deviceBackgroundNeeded = false; keyExchange.clear();
  deviceRequestInput = ''; deviceRequestNeedsOpen = false; deviceInvitation = null; deviceOffer = false;
  disposeFullBackup(pendingFullBackup); pendingFullBackup = undefined; pendingFullRestored = false; fullBackupOpen = false;
  calls?.dispose(); calls = null; callView = idleCall(); callStream = null;
  audioTrack = null;
  pendingProfileBackup = undefined;
  rootAccountId = ''; profileRegistry = null; activeProfileId = '';
  profileNetwork = true; allProfileChats = false; profileInboxViewer = ''; profileInboxSnapshot = emptyInboxPage(); requestedProfilePeer = ''; requestedProfileId = '';
  requestedInboxPage = 0; requestedInboxFocus = undefined;

  autoUnlock.cancel();
  authGeneration++;
  replyDrafts = {}; selecting = false; selectedMessages = []; attachmentMenu = false;
  networkSummaryOpen = false; nodeBudgetOpen = false; fileDragActive = false;
  actionMode = null; actionError = ''; highlightedMessage = ''; allowForwardAttribution = true;
  messageTools = null;
  copiedMessageId = ''; pinBusy = false;
  actionBusy = false; forwardCompleted.clear();
  identity?.dispose();
  hideDisplayedSecrets();
  status = '';
  tempSeed?.fill(0);
  tempSeed = null;
  mnemonic = '';

}

function releaseAccountLease(): void {
  accountLease?.release();
  accountLease = null;
  tabCoordinationUnsupported = false;
}

async function prepareAccount(mnemonic: string, generation: number) {
  const account = await accountFromMnemonic(mnemonic);
  try {
    if (generation !== authGeneration) throw new Error('auth_cancelled');
    if (accountLease?.accountId !== account.accountId) {
      const lease = await acquireAccountLease(account.accountId);
      if (generation !== authGeneration) { lease.release(); throw new Error('auth_cancelled'); }
      if (!lease.available) throw new Error('account_already_open');
      releaseAccountLease();
      accountLease = lease;
      tabCoordinationUnsupported = !lease.supported;
    }
    rootAccountId = account.accountId;
    return account;
  } catch (error) {
    account.identitySeed.fill(0); account.provider.dispose();
    throw error;
  }
}

function accountBusyError(error: unknown): boolean {
  return error instanceof Error && error.message === 'account_already_open';
}

function hideDisplayedSecrets(): void {
  closeEphemeral(); sendOptionsOpen = false; emojiOpen = false;
  pin = '';
  unlockPin = '';
  oldPassword = '';
  newPassword = '';
  confirmPassword = '';
}

function contactName(accountId: string): string {
  if (accountId === address) return 'Сохранённые';
  return aliases[accountId] || declaredNames[accountId] || `${accountId.slice(0, 12)}…`;
}

function contactPhoto(accountId: string): string { return accountId === address ? selfAvatar : peerAvatars[accountId] ?? ''; }

function publishAvatar(activeChat: ChatService, peer: string): void {
  if (chat === activeChat && sessionChats.byPeer[peer]?.contact === 'accepted') void activeChat.sendAvatar(selfAvatar, peer).catch(() => {});
}

async function changeOwnAvatar(file: File | null, crop?: AvatarCrop): Promise<void> {
  if (avatarBusy || endingSession || switchingTrust || memoryBusy || profileSwitchBusy || !profileNetwork) return;
  const generation = authGeneration, owner = address;
  const current = () => generation === authGeneration && address === owner && !endingSession;
  avatarBusy = true; avatarError = '';
  const previous = selfAvatar;
  try {
    const next = file ? await createPhotoAvatar(file,crop) : '';
    if (!current()) return;
    selfAvatar = next;
    if (!await persistLocalChats()) {
      if (current()) { selfAvatar = previous; avatarError = 'Не удалось сохранить фото. Попробуйте ещё раз.'; }
      return;
    }
    if (!current()) return;
    if (chat) for (const peer of sessionChats.order) if (sessionChats.byPeer[peer]?.connection === 'connected') publishAvatar(chat, peer);
  } catch (error) {
    if (current()) avatarError = error instanceof Error ? error.message : 'Не удалось подготовить фото.';
  } finally { if (generation === authGeneration && address === owner) avatarBusy = false; }
}

function applyChatData(saved: LocalChatData): void {
  meshtastic=normalizeNativeChannels(saved.meshtastic);
  radioState = normalizeRadioState(saved.radioState);
  deviceSettings = normalizeDeviceSettings(saved.deviceSettings);
  mediaLibrary = normalizeMediaLibrary(saved.mediaLibrary); mediaOpen = false; receivedPack = null;
  sessionChats = restoreChats(saved.chats);
  selfNickname = saved.selfNickname;
  selfLinks = normalizeProfileLinks(saved.selfLinks); peerLinks = normalizePeerLinks(saved.peerLinks);
  seedNoticeDismissed = saved.seedNoticeDismissed === true; deviceOffer = saved.deviceOffer === true;
  selfAvatar = normalizeAvatar(saved.selfAvatar) ?? ''; peerAvatars = normalizePeerAvatars(saved.peerAvatars);
  avatarBusy = false; avatarError = '';
  seedBackupVerified = saved.seedBackupVerified === true;
  readReceiptsEnabled = saved.readReceiptsEnabled;
  autoLockMinutes = normalizeAutoLockMinutes(saved.autoLockMinutes);
  autoReceiveFilesEnabled = saved.autoReceiveFilesEnabled !== false;
  autoPlayVideoEnabled = saved.autoPlayVideoEnabled !== false;
  cleanImageMetadataEnabled = saved.cleanImageMetadataEnabled !== false;
  allowForwardAttribution = saved.allowForwardAttribution !== false;
  networkSettings = normalizeNetworkSettings(saved.networkSettings);
  offlineDeliveryState = restoreOfflineState(saved.offlineState);
  courierState = restoreCourierState(saved.courierState);
  peerReadPreferences = saved.peerReadPreferences;
  nicknameDraft = saved.selfNickname;
  aliases = saved.aliases;
  declaredNames = saved.declaredNames;
  peerPublicKeys = saved.peerPublicKeys;
}

async function restoreLocalChats(seed: Uint8Array, trusted: boolean): Promise<void> {
  if(nativeSaveTimer){clearTimeout(nativeSaveTimer);nativeSaveTimer=null;}
  meshtastic=emptyNativeChannels();nativeOpen=false;nativeSelected='';nativeSending=false;textForward=null;
  disconnectRadio(); radioState = emptyRadioState();
  const generation = authGeneration; const accountId = address;
  await historyWrites.settled();
  if (generation !== authGeneration || address !== accountId) return;
  sessionChats = emptySessionChats();
  mediaLibrary = emptyMediaLibrary(); mediaOpen = false; receivedPack = null;
  selfNickname = ''; selfLinks = []; peerLinks = {}; seedNoticeDismissed = false; deviceOffer = false;
  selfAvatar = ''; peerAvatars = {}; avatarBusy = false; avatarError = '';
  seedBackupVerified = false;
  readReceiptsEnabled = true;
  trustedReadReceiptsPreference = true;
  autoLockMinutes = DEFAULT_AUTO_LOCK_MINUTES;
  autoReceiveFilesEnabled = true; autoPlayVideoEnabled = true;
  cleanImageMetadataEnabled = true;
  networkSettings = emptyNetworkSettings();
  offlineDeliveryState = emptyOfflineState(); offlineDeliveryError = '';
  courierState = emptyCourierState(); courierError = '';
  peerReadPreferences = {};
  peerReadConfirmed.clear();
  nicknameDraft = '';
  aliases = {};
  declaredNames = {};
  peerPublicKeys = {};
  aliasDraft = '';
  chatStoreKey = null;
  try {
    const key = await deriveChatStoreKey(seed, accountId);
    const devicesKey = await deriveOwnerDeviceKey(seed, accountId);
    if (generation !== authGeneration || address !== accountId) return;
    const saved = await loadLocalChatData(key, accountId);
    if (generation !== authGeneration || address !== accountId) return;
    if (saved) applyChatData(saved);
    trustedReadReceiptsPreference = readReceiptsEnabled;
    chatStoreKey = key;
    deviceOwnerKey = devicesKey;
  } catch (e) {
    if (generation !== authGeneration || address !== accountId) return;
    status = 'Не удалось прочитать локальную историю. Новые сообщения пока не сохраняются.';
  }
  readReceiptsEnabled = readReceiptsForMode(trusted, trustedReadReceiptsPreference);
}

async function restoreLockedChats(seed: Uint8Array): Promise<boolean> {
  if (!lockedSession || lockedSession.accountId !== address) return false;
  const previous = lockedSession;
  const generation = authGeneration; const accountId = address;
  const key = await deriveChatStoreKey(seed, accountId);
  if (generation !== authGeneration || address !== accountId || lockedSession !== previous) return true;
  chatStoreKey = key;
  applyChatData(previous.data);
  sessionFiles.clear();
  for (const [key, bytes] of previous.files) sessionFiles.set(key, bytes);
  lockedSession = null;
  return true;
}

function persistLocalChats(): Promise<boolean> {
  const key = chatStoreKey;
  const accountId = address;
  if (memoryBusy) return Promise.resolve(false);
  if (!trustedSession) return Promise.resolve(true);
  if (!key || !accountId) return Promise.resolve(false);
  const snapshot = chatSnapshot();
  const epoch = storageEpoch();
  const generation = authGeneration;
  const saved = historyWrites.enqueue(() => {
    requireStorageEpoch(epoch);
    // A queued chat snapshot must not overwrite a library transaction that
    // completed ahead of it (nor leak another profile's library into this one).
    if (address === accountId && generation === authGeneration) snapshot.mediaLibrary = normalizeMediaLibrary(mediaLibrary);
    return saveLocalChatData(key, accountId, snapshot);
  });
  return saved.then(() => true, (e) => {

    if (address === accountId) status = 'Не удалось сохранить локальную историю.';
    return false;
  });
}

function saveOwnNickname(): void {
  const cleaned = nicknameDraft.trim();
  if (cleaned.length > 32 || /[\u0000-\u001f\u007f]/.test(cleaned)) {
    status = 'Ник: максимум 32 символа, без управляющих знаков.';
    return;
  }
  selfNickname = cleaned;
  nicknameDraft = cleaned;
  status = '';
  persistLocalChats();
  const activeChat = chat;
  if (activeChat) {
    for (const peer of sessionChats.order) {
      if (sessionChats.byPeer[peer]?.connection === 'connected') {
        void activeChat.sendProfile(cleaned, peer).catch(() => {});
      }
    }
  }
}

async function saveProfileLinks(links: ProfileLink[]): Promise<boolean> {
  if (screen !== 'account' || endingSession || switchingTrust || memoryBusy || profileSwitchBusy || !profileNetwork) return false;
  const owner = address, generation = authGeneration, previous = selfLinks;
  selfLinks = normalizeProfileLinks(links);
  if (!await persistLocalChats()) {
    if (address === owner && authGeneration === generation) selfLinks = previous;
    return false;
  }
  if (address !== owner || authGeneration !== generation || screen !== 'account') return false;
  const active = chat;
  if (active) for (const peer of sessionChats.order) if (peer !== address && sessionChats.byPeer[peer].contact === 'accepted' && sessionChats.byPeer[peer].connection === 'connected')
    void active.sendProfileLinks(selfLinks, peer).catch(() => {});
  return true;
}

function dismissAccountNotice(kind: 'backup' | 'devices') {
  if (kind === 'backup') seedNoticeDismissed = true; else deviceOffer = false;
  void persistLocalChats();
}
function openAccountBackup() {
  hideDisplayedSecrets(); status = ''; changeAccountView('profile'); selectSettings('security'); backupOpen = true;
  void tick().then(() => document.getElementById('seed-backup-section')?.scrollIntoView({block:'start'}));
}

function showDevices(): void {
  deviceOffer = false; void persistLocalChats(); changeAccountView('profile'); selectSettings('security'); devicesOpen = true;
  if (!deviceStore && !deviceBusy) void retryDevices();
}
$effect(() => {
  if (screen === 'account' && !authBusy && deviceRequestNeedsOpen) untrack(() => { deviceRequestNeedsOpen = false; showDevices(); });
});

async function confirmSeedBackup(): Promise<boolean> {
  const accountId = address;
  if (!accountId || screen !== 'account') return false;
  const previous = seedBackupVerified;
  seedBackupVerified = true;
  const saved = await persistLocalChats();
  if (address !== accountId || screen !== 'account') return false;
  if (!saved) seedBackupVerified = previous;
  return saved;
}

function handleAuthKey(event: KeyboardEvent): void {
  if (!submitOnEnter(event)) return;
  event.preventDefault();
  if (screen === 'unlock') void unlockAccount();
  else if (screen === 'setPin') void saveWithPin();
}

function handleComposerKey(event: KeyboardEvent): void {
  if (!submitOnEnter(event)) return;
  event.preventDefault();
  void send();
}

function focusComposer(node: HTMLTextAreaElement, _peer: string) {
  const focus = () => { if (!narrowScreen) void tick().then(() => { if (node.isConnected) node.focus({ preventScroll: true }); }); };
  focus();
  return { update: focus };
}

function canDropFiles(): boolean {
  return !nativeOpen && screen === 'account' && accountView === 'chats' && !!chat && !!activeConversation &&
    activeConversation.contact === 'accepted' && !navigationBusy() && !attachingFiles && !voiceBusy &&
    !selecting && !galleryId && !messageTools && !nodeBudgetOpen && !networkSummaryOpen && !mediaOpen;
}

function fileDrop(node: HTMLElement) {
  return installFileDrop(node, { canDrop: canDropFiles, target: () => sessionChats.activePeer,
    onFiles: files => { stageAttachments(files); }, onActive: active => { fileDragActive = active; } });
}

function toggleAllMessages(): void {
  if (actionBusy) return;
  selectedMessages = selectionSummary(activeMessages, selectedMessages).all ? [] : selectEveryMessage(activeMessages);
}

function openConnectionSection(section: 'direct' | 'servers' | 'outgoing' | 'incoming' | 'radio'): void {
  networkSummaryOpen = false; nodeBudgetOpen = false;
  changeAccountView('profile'); selectSettings('connection'); connectionSection = section;
}

function showChatList(): void {
  if (navigationBusy()) return;
  nativeOpen=false;
  clearMediaPreview();
  messageTools = null; selecting = false; selectedMessages = []; attachmentMenu = false;
  restoringPage = true;
  const root = rootRoute('account');
  if (pageNavigation) pageNavigation.returnToRoot(root);
  else restorePageRoute(root);
  void tick().then(() => { restoringPage = false; });
}

async function changeReadReceipts(enabled: boolean): Promise<void> {
  const accountId = address;
  const previous = readReceiptsEnabled;
  const previousChats = sessionChats;
  readReceiptsEnabled = enabled;
  if (!enabled) {
    for (const peer of sessionChats.order) clearPendingReads(peer);
  }
  if (!await persistLocalChats()) {
    if (address === accountId) {
      readReceiptsEnabled = previous;
      sessionChats = previousChats;
    }
    return;
  }
  if (address !== accountId) return;
  if (trustedSession) trustedReadReceiptsPreference = enabled;
  const activeChat = chat;
  if (activeChat) {
    for (const peer of sessionChats.order) {
      if (sessionChats.byPeer[peer].contact === 'accepted' && sessionChats.byPeer[peer].connection === 'connected') {
        void activeChat.sendReadPreference(enabled, peer).catch(() => {});
      }
    }
  }
  if (enabled) scanVisibleMessages();
}

async function changeAutoLock(minutes: number): Promise<void> {
  const accountId = address;
  const previous = autoLockMinutes;
  autoLockMinutes = normalizeAutoLockMinutes(minutes);
  if (!await persistLocalChats()) {
    if (address === accountId) autoLockMinutes = previous;
  }
}

async function changeFilePreference(kind: 'receive' | 'video', enabled: boolean): Promise<void> {
  const accountId = address;
  const previous = kind === 'receive' ? autoReceiveFilesEnabled : autoPlayVideoEnabled;
  if (kind === 'receive') autoReceiveFilesEnabled = enabled;
  else autoPlayVideoEnabled = enabled;
  if (!await persistLocalChats() && address === accountId) {
    if (kind === 'receive') autoReceiveFilesEnabled = previous;
    else autoPlayVideoEnabled = previous;
  }
}

async function changeImagePrivacy(enabled: boolean): Promise<void> {
  const generation = authGeneration, previous = cleanImageMetadataEnabled;
  cleanImageMetadataEnabled = enabled;
  if (!await persistLocalChats() && generation === authGeneration) {
    cleanImageMetadataEnabled = previous; status = 'Не удалось сохранить настройку очистки изображений.';
  }
}

function saveContactAlias(): boolean {
  const peer = accountView === 'peer' ? peerCardAddress : sessionChats.activePeer;
  if (!peer) return false;
  const cleaned = aliasDraft.trim();
  if (cleaned.length > 32 || /[\u0000-\u001f\u007f]/.test(cleaned)) {
    status = 'Имя контакта: максимум 32 символа, без управляющих знаков.';
    return false;
  }
  aliases = { ...aliases, [peer]: cleaned };
  aliasDraft = cleaned;
  status = '';
  persistLocalChats();
  return true;
}

function restorePageRoute(route: PageRoute): void {
  chatSearchOpen = false; emojiOpen = false; sendOptionsOpen = false; closeEphemeral();
  panicOpen = false; memoryConfirmation = null; pendingExit = null; nodeScannerOpen = false;
  openHelp = null; backupOpen = false;
  networkSummaryOpen = false; nodeBudgetOpen = false; fileDragActive = false;
  if (screen !== 'account') {
    if (route.screen === 'account' || route.screen === 'unlock' && screen !== 'unlock') return;
    if (route.screen === 'setPin') {
      // Never resurrect a cleared seed/provider using browser Forward.
      if ((newAccountFlow && screen === 'setPin') || (identity && mnemonic)) screen = 'setPin';
      return;
    }
    if (screen !== route.screen && screen !== 'unlock') cancelAccountSetup(route.screen === 'import' ? 'import' : 'entry');
    return;
  }
  if (route.screen !== 'account') return;
  if (screen !== 'account' || !address) return;
  actionMode = null; selecting = false; selectedMessages = []; attachmentMenu = false;
  messageTools = null;
  if (route.layer !== 'media-library') { mediaOpen = false; receivedPack = null; }
  if (accountView !== route.view || peerCardAddress !== route.card) changeAccountView(route.view);
  if (route.peer && !sessionChats.byPeer[route.peer]) return;
  sessionChats = { ...sessionChats, activePeer: route.peer };
  mobilePane = route.pane; chatOpenToken++;
  if (route.view === 'profile') {
    const destination = settingsLocation(route.settings, route.connection, route.media);
    if (settingsSection !== destination.section) selectSettings(destination.section);
    connectionSection = destination.connection; mediaSettingsSection = destination.media;
    if (destination.section === 'files' && destination.media === 'storage') void refreshStorage();
  }
  if (route.view === 'peer' && route.card) void openPeerCard(route.card);
  galleryId = route.gallery;
  if (route.gallery && route.peer) void ensureImageUrl(route.peer, route.gallery);
}
function backWithinApp(): void {
  if(radioOverviewOpen){radioOverviewOpen=false;return;}
  if (navigationBusy()) return;
  if (ephemeralView) { closeEphemeral(); return; }
  if (sendOptionsOpen) { sendOptionsOpen = false; return; }
  if (emojiOpen) { emojiOpen = false; return; }
  if (chatSearchOpen) { toggleChatSearch(); return; }
  if (audioControls?.dismissOverlay()) return;
  if (mediaOpen || receivedPack) { mediaOpen = false; receivedPack = null; return; }
  if (messageTools) { messageTools = null; return; }
  if (galleryId) { closeGallery(); return; }
  if (screen === 'account' && accountView === 'profile' && !openHelp && !pendingExit && !backupOpen && !panicOpen && !memoryConfirmation && !nodeScannerOpen && !networkSummaryOpen && !nodeBudgetOpen) {
    const route:PageRoute={...rootRoute('account'),view:'profile',settings:settingsSection,connection:connectionSection,media:mediaSettingsSection,peer:sessionChats.activePeer,pane:mobilePane};
    const parent=settingsParent(route);
    if (parent) pageNavigation?.backTo(candidate=>sameSettingsLocation(candidate,parent),parent);
    else pageNavigation?.backTo(candidate=>candidate.screen==='account'&&candidate.view!=='profile'&&!candidate.layer&&!candidate.gallery,{...route,view:'chats'});
    return;
  }
  if (screen === 'account' && accountView === 'chats' && mobilePane === 'chat' && !galleryId && !selecting && !attachmentMenu && !actionMode && !networkSummaryOpen && !nodeBudgetOpen) { showChatList(); return; }
  if (allProfileChats && accountView === 'chats') { allProfileChats = false; return; }
  if (!pageNavigation?.back()) pageNavigation?.rearmRoot();
}
function navigationBusy(includeVoice = true): boolean {
  return (includeVoice && voiceBusy) || authBusy || endingSession || switchingTrust || memoryBusy || panicBusy || actionBusy || pinBusy || profileSwitchBusy || mediaBusy;
}
function cancelAccountSetup(target: 'entry' | 'import' = 'entry'): void {
  clearSensitiveData(); releaseAccountLease(); identity = null;
  newAccountFlow = false; authNickname = ''; importMnemonic = '';
  publicKey = ''; address = ''; qrPublic = ''; pin = ''; unlockPin = '';
  screen = target;
}
function handleAppKey(event: KeyboardEvent): void {
  if (isAppEscape(event)) {
    // A native modal owns Escape (and may deny dismissal while committing).
    if (document.querySelector('dialog[open]')) return;
    event.preventDefault();
    // ESC dismisses an internal view; it never closes a tab or leaves the site.
    backWithinApp();
    return;
  }
}
async function copyContactAddress(id: string): Promise<void> {
  const generation = authGeneration;
  try {
    await navigator.clipboard.writeText(id);
    if (generation !== authGeneration) return;
    copiedContactId = id;
    setTimeout(() => { if (copiedContactId === id) copiedContactId = ''; }, 2000);
  } catch { if (generation === authGeneration) status = 'Не удалось скопировать ID. Его можно выделить вручную.'; }
}
async function shareContact(id: string): Promise<void> {
  if (!profileNetwork && id === address) { status = 'Главный профиль остаётся локальным.'; return; }
  if (sharingContact) return;
  const generation = authGeneration; const url = contactLink(id);
  sharingContact = true; shareFallbackLink = '';
  try {
    if (navigator.share && (!navigator.canShare || navigator.canShare({ url }))) {
      try { await navigator.share({ title: 'Контакт Automesh', url }); return; }
      catch (error) { if (error instanceof Error && error.name === 'AbortError') return; }
    }
    if (generation !== authGeneration) return;
    try {
      await navigator.clipboard.writeText(url);
      if (generation === authGeneration) status = 'Ссылка на контакт скопирована.';
    } catch {
      if (generation === authGeneration) { shareFallbackLink = url; status = 'Скопируйте ссылку вручную.'; }
    }
  } finally { if (generation === authGeneration) sharingContact = false; }
}
async function openContactMessage(peer: string, id: string): Promise<void> {
  const generation = authGeneration;
  changeAccountView('chats');
  void openConversation(peer);
  await tick();
  // Let the conversation's own initial scroll finish before the explicit jump.
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  if (generation === authGeneration && sessionChats.activePeer === peer) jumpToMessage(id);
}

function changeAccountView(view: 'chats' | 'own' | 'profile' | 'peer'): void {
  profileManagementOpen = false; profileBackupOpen = false;
  memoryConfirmation = null;
  backupOpen = false;
  stopNodeTools();
  if (view !== 'chats') clearMediaPreview();
  if (view === 'profile' && accountView !== 'profile') settingsSection = 'overview';
  publicKeyOpen = false;
  accountView = view;
  addressCopied = false;
  copiedContactId = '';
  openHelp = null;
  pendingExit = null;
  unlockPin = '';
  oldPassword = '';
  newPassword = '';
  confirmPassword = '';
  if (view === 'profile' && settingsSection === 'application') { void checkOfflineReady(); void appUpdater?.updater.check(); }
  if (view === 'profile' && settingsSection === 'files' && mediaSettingsSection === 'storage') void refreshStorage();
}

function selectSettings(section: LegacySettingsSection): void {
  profileManagementOpen = false; profileBackupOpen = false;
  if (settingsSection === 'overview' && section !== 'overview' && accountView === 'profile' && !restoringPage && routerReady) {
    // Shortcut entries (indicators/profile) still get a Settings parent.
    pageNavigation?.visit({ ...rootRoute('account'), view: 'profile', settings: 'overview',
      peer: sessionChats.activePeer, pane: mobilePane });
  }
  memoryConfirmation = null;
  backupOpen = false;
  stopNodeTools(); openHelp = null; pendingExit = null;
  unlockPin = ''; oldPassword = ''; newPassword = ''; confirmPassword = '';
  const destination = settingsLocation(section);
  settingsSection = destination.section;
  connectionSection = destination.connection; mediaSettingsSection = destination.media;
  publicKeyOpen = false;
  if (section === 'application') { void checkOfflineReady(); void appUpdater?.updater.check(); }
  if (section === 'storage') void refreshStorage();
}

function selectConnection(section: ConnectionSection): void {
  stopNodeTools(); openHelp = null; connectionSection = section;
}
function selectMediaSettings(section: string): void {
  if (section === 'library') { openMediaLibrary('stickers'); return; }
  mediaSettingsSection = settingsLocation('files', undefined, section).media;
  if (mediaSettingsSection === 'storage') void refreshStorage();
}

function prepareDirectPeer(peer: string): void {
  if (sessionChats.byPeer[peer]?.contact === 'blocked') throw new Error('blocked_peer');
  sessionChats = ensureConversation(sessionChats, peer);
  void persistLocalChats();
}

function openDirectChat(peer: string): void {
  if (navigationBusy()) return;
  changeAccountView('chats');
  void openConversation(peer);
}

function stopNodeTools(): void {
  nodeWorkToken++;
  nodeScannerOpen = false;
  nodeCandidate = null;
  nodeInput = '';
  candidateName = '';
  nodeError = '';
  nodeQr = '';
  nodeQrUrl = '';
  for (const controller of nodeProbes.values()) controller.abort();
  nodeProbes.clear();
}

async function checkOfflineReady(): Promise<void> {
  const token = nodeWorkToken;
  offlineState = 'checking';
  const result = await offlineReadiness();
  if (token === nodeWorkToken && accountView === 'profile' && settingsSection === 'application') offlineState = result;
}

function previewLocalNode(text = nodeInput): void {
  nodeScannerOpen = false;
  nodeError = '';
  try {
    nodeCandidate = parseSignalingNode(text, location.href);
    candidateName = nodeCandidate.name;
    nodeInput = nodeCandidate.url;
  } catch { nodeCandidate = null; nodeError = 'Нужен QR сервера или адрес wss://…/signal. Mesh ID и seed не подходят.'; }
}

async function importNodeImage(event: Event): Promise<void> {
  const input = event.currentTarget as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  const token = nodeWorkToken;
  try {
    const text = await readQrImage(file);
    if (token === nodeWorkToken && screen === 'account') previewLocalNode(text);
  } catch { if (token === nodeWorkToken) nodeError = 'QR не найден. Используйте PNG/JPEG/WebP до 5 МБ или вставьте адрес.'; }
}

async function saveNetworkSettings(next: NetworkSettings): Promise<boolean> {
  if (networkBusy || !routedTransport || endingSession) return false;
  networkBusy = true;
  const previous = normalizeNetworkSettings(networkSettings);
  const accountId = address;
  const transport = routedTransport;
  networkSettings = normalizeNetworkSettings(next);
  try {
    if (!await persistLocalChats()) { if (address === accountId) networkSettings = previous; return false; }
    if (address !== accountId || routedTransport !== transport) return false;
    await refreshReceiveRouting();
    return true;
  } finally { networkBusy = false; }
}
async function addNodeSignaling(url: string): Promise<void> {
  if (endingSession || !identity) throw new Error('account_locked');
  const field = isLocalHost(new URL(url).hostname) ? 'nodes' : 'internetNodes';
  const nodes = networkSettings[field] ?? [];
  if (nodes.some(node => node.url === url && node.enabled)) return;
  const previous = nodes.filter(node => node.url !== url);
  if (previous.length >= MAX_LOCAL_NODES) throw new Error('node_limit');
  if (!await saveNetworkSettings({ ...networkSettings, [field]: [...previous, { url, name: field === 'nodes' ? 'Домашняя нода' : 'Серверная нода', enabled: true }] })) throw new Error('network_not_saved');
}
async function rememberAdminNode(request: AdminConnect): Promise<void> {
  if (endingSession || !identity) throw new Error('account_locked');
  const nodes = (networkSettings.managedNodes ?? []).filter(node => node.url !== request.url);
  if (nodes.length >= MAX_MANAGED_NODES) throw new Error('node_limit');
  if (!await saveNetworkSettings({ ...networkSettings, managedNodes: [...nodes, { url: request.url, nodeId: request.nodeId, name: new URL(request.url).host }] })) throw new Error('network_not_saved');
}

async function addLocalNode(): Promise<void> {
  if (!nodeCandidate) return;
  try {
    const node = parseSignalingNode(nodeInvite({ ...nodeCandidate, name: candidateName }), location.href);
    const field = isLocalHost(new URL(node.url).hostname) ? 'nodes' : 'internetNodes';
    const nodes = (networkSettings[field] ?? []).filter((item) => item.url !== node.url);
    if (nodes.length >= MAX_LOCAL_NODES) { nodeError = 'Не больше 6 сохранённых локальных узлов.'; return; }
    if (await saveNetworkSettings({ ...networkSettings, [field]: [...nodes, node] })) {
      nodeCandidate = null;
      nodeInput = '';
      nodeError = '';
      void checkLocalNode(node.url);
    }
  } catch { nodeError = 'Не удалось добавить локальный узел.'; }
}

async function toggleLocalNode(node: LocalNode): Promise<void> {
  const field = isLocalHost(new URL(node.url).hostname) ? 'nodes' : 'internetNodes';
  const nodes = (networkSettings[field] ?? []).filter((item) => item.url !== node.url);
  if (nodes.length >= MAX_LOCAL_NODES) { nodeError = 'Сначала удалите один из сохранённых узлов.'; return; }
  await saveNetworkSettings({ ...networkSettings, [field]: [...nodes, { ...node, enabled: !node.enabled }] });
}

async function removeLocalNode(node: LocalNode): Promise<void> {
  const field = isLocalHost(new URL(node.url).hostname) ? 'nodes' : 'internetNodes';
  const nodes = (networkSettings[field] ?? []).filter((item) => item.url !== node.url);
  if (configuredNodes.some((item) => item.url === node.url)) nodes.push({ ...node, enabled: false });
  if (await saveNetworkSettings({ ...networkSettings, [field]: nodes })) {
    delete nodeChecks[node.url];
    if (nodeQrUrl === node.url) { nodeQr = ''; nodeQrUrl = ''; }
  }
}

async function checkLocalNode(url: string): Promise<void> {
  if (networkSettings.internetEnabled === false && !isLocalHost(new URL(url).hostname)) {
    nodeChecks = { ...nodeChecks, [url]: 'Интернет отключён: проверка не выполнялась' }; return;
  }
  if (nodeProbes.has(url)) return;
  const token = nodeWorkToken;
  const controller = new AbortController();
  nodeProbes.set(url, controller);
  nodeChecks = { ...nodeChecks, [url]: 'Проверяем…' };
  try {
    await probeSignaling(url, controller.signal);
    if (token === nodeWorkToken) nodeChecks = { ...nodeChecks, [url]: `Последняя проверка сервера пройдена (${new Date().toLocaleTimeString($uiLocale)})` };
  } catch {
    if (token === nodeWorkToken) nodeChecks = { ...nodeChecks, [url]: 'Нет доступа: проверьте адрес, сертификат и разрешение LAN' };
  } finally { if (nodeProbes.get(url) === controller) nodeProbes.delete(url); }
}

async function shareLocalNode(node: LocalNode): Promise<void> {
  const token = nodeWorkToken;
  const content = nodeInvite(node);
  const qr = await QRCode.toDataURL(content, { width: 256, margin: 2 });
  if (token !== nodeWorkToken) return;
  nodeQrUrl = node.url;
  nodeQrContent = content;
  nodeQr = qr;
}

function localNodeStatus(url: string): string {
  const node = nodeStates.find((item) => item.url === url);
  if (node?.alias) return 'Тот же сервер, другой адрес';
  if (node?.status === 'connected') return 'Подключён';
  if (node?.status === 'connecting') return 'Подключаемся…';
  if (node?.error === 'signaling_address_busy') return 'Сигналинг сообщил: адрес занят (signaling_address_busy). Возможна незакрытая сессия после сна или другая вкладка. Повторим подключение; остальные каналы работают независимо.';
  if (node?.error === 'signaling_registration_rejected') return 'Сервер отклонил проверку входа. Это не означает, что нода устарела.';
  if (node?.status === 'offline' || node?.status === 'error') return 'Сигналинг не подключён';
  return 'Резерв';
}

function toggleHelp(topic: HelpTopic): void {
  openHelp = openHelp === topic ? null : topic;
}

async function copyOwnAddress(): Promise<void> {
  if (!address) return;
  try {
    await navigator.clipboard.writeText(address);
    addressCopied = true;
    status = '';
    window.setTimeout(() => addressCopied = false, 2000);
  } catch (e) {

    addressCopied = false;
    status = 'Не удалось скопировать Mesh ID. Его можно выделить вручную.';
  }
}

async function openPeerCard(peer: string): Promise<void> {
  if (peer === address) {
    changeAccountView('own');
    return;
  }
  peerCardAddress = peer;
  aliasDraft = aliases[peer] ?? '';
  peerQr = '';
  changeAccountView('peer');
  try {
    const qr = await QRCode.toDataURL(peer);
    if (accountView === 'peer' && peerCardAddress === peer) peerQr = qr;
  } catch (e) {

    status = 'Не удалось построить QR-код контакта.';
  }
}

function createAccount() {
  if (authBusy) return;
  trustedDeviceChoice = true;
  newAccountFlow = true;
  authNickname = '';
  pin = '';
  registrationWordCount = DEFAULT_SEED_WORD_COUNT;
  status = '';
  // Opening the form creates no mnemonic, identity or account lease.
  screen = 'setPin';
}

async function importAccount() {
  if (authBusy) return;
  newAccountFlow = false;
  authBusy = true;
  status = '';
  const generation = authGeneration;

  try {

    const cleaned =
      importMnemonic
        .trim()
        .toLowerCase();

    if (
      !validateMnemonic(
        cleaned,
        wordlist
      )
    ) {

      status =
        'Неверная seed-фраза ❌';

      return;
    }

    mnemonic = cleaned;

    const account = await prepareAccount(cleaned, generation);
    if (generation !== authGeneration) { account.identitySeed.fill(0); account.provider.dispose(); return; }
    tempSeed = account.identitySeed;
    identity = account.provider;
    publicKey = account.publicKey;
    address = account.accountId;

    qrPublic =
      await QRCode.toDataURL(address);
    if (generation !== authGeneration) return;

    screen = 'setPin';
    importMnemonic = '';

  } catch (e) {
    if (generation !== authGeneration) return;
    clearSensitiveData(); identity = null;
    releaseAccountLease();
    status =
      accountBusyError(e) ? 'Этот аккаунт уже открыт в другой вкладке. Выйдите там или закройте её.' : 'Ошибка импорта ❌';
  } finally {
    importMnemonic = '';
    authBusy = false;
  }
}

async function restoreBackup(backup: OpenedBackup): Promise<boolean> {
  const generation = authGeneration;
  // Taking ownership before import changes the screen: the reader is then
  // destroyed and must not erase the pending archive's attachment buffers.
  const full = backup.full; backup.full = undefined;
  authNickname = full ? '' : backup.nickname;
  importMnemonic = new TextDecoder().decode(backup.seed);
  await importAccount();
  if (generation !== authGeneration) { disposeFullBackup(full); return false; }
  if (screen === 'setPin') {
    pendingProfileBackup = backup.profiles ? profileRegistrySnapshot(backup.profiles) : undefined;
    disposeFullBackup(pendingFullBackup); pendingFullBackup = full; pendingFullRestored = false;
  } else disposeFullBackup(full);
  return screen === 'setPin';
}

async function exportFullData(seed: Uint8Array, current: () => void, onlyCurrent = false) {
  if (!trustedSession || !chatStoreKey || navigationBusy() || attachingFiles) throw new Error('backup_session_unavailable');
  const generation = authGeneration, owner = rootAccountId || address, active = address;
  const key = chatStoreKey; memoryBusy = true;
  const guard = () => { current(); if (generation !== authGeneration || screen !== 'account' || active !== address || endingSession) throw new Error('backup_session_changed'); };
  const previous = chat; chat = null; const stopping = stopOfflineDelivery();
  try {
    await previous?.disconnect(); await stopping; guard(); pauseFileTransfers();
    await historyWrites.settled(); await Promise.all([...pendingFileWrites]); guard();
    await saveLocalSessionData(key, active, chatSnapshot(), sessionFiles); guard();
    const snapshot = await captureFullBackup(seed, owner, guard, onlyCurrent ? active : undefined);
    return { ...snapshot, ...(activeProfileId ? { selectedProfileId: activeProfileId } : {}) };
  } finally {
    memoryBusy = false;
    if (generation === authGeneration && screen === 'account' && identity && !endingSession) await initializeChat();
  }
}

async function restoreDataArchive(full: DataBackupContents, current: () => void): Promise<boolean> {
  if (!trustedSession || !chatStoreKey || navigationBusy() || attachingFiles || full.accountId !== address) throw new Error('backup_session_unavailable');
  const generation = authGeneration, active = address, key = chatStoreKey;
  const guard = () => { current(); if (generation !== authGeneration || screen !== 'account' || active !== address || endingSession) throw new Error('backup_session_changed'); };
  memoryBusy = true;
  const previous = chat; chat = null; const stopping = stopOfflineDelivery();
  try {
    await previous?.disconnect(); await stopping; guard(); pauseFileTransfers();
    await historyWrites.settled(); await Promise.all([...pendingFileWrites]); guard();
    await saveLocalSessionData(key, active, chatSnapshot(), sessionFiles); guard();
    const data = await restoreDataBackupToStore(full, key, active, guard);
    if (generation === authGeneration && screen === 'account' && address === active && !endingSession) {
      for (const bytes of sessionFiles.values()) bytes.fill(0);
      sessionFiles.clear(); applyChatData(data); sessionChats.activePeer = '';
    }
    return true;
  } finally {
    memoryBusy = false;
    if (generation === authGeneration && screen === 'account' && identity && !endingSession) await initializeChat();
  }
}

async function exportProfiles(seed: Uint8Array): Promise<ProfileRegistry | undefined> {
  if (!trustedSession) return undefined;
  const generation = authGeneration, scope = rootAccountId || address;
  return readProfilesForBackup(seed, scope, () => generation === authGeneration && scope === (rootAccountId || address) && screen === 'account' && trustedSession && !endingSession);
}

async function readSessionProfiles(root: Uint8Array, owner: string, trusted: boolean, guard: () => void): Promise<ProfileRegistry | null> {
  if (!trusted) return null;
  guard();
  const bundle = await openBrowserProfileBundle({ root, scope: owner, trusted, isCurrent: () => { try { guard(); return true; } catch { return false; } } });
  try { return await bundle.read(); }
  catch (error) { if (error instanceof Error && error.message === 'profile_registry_missing') return null; throw error; }
  finally { bundle.close(); }
}

function adoptProfileContext(context: ProfileChatContext): void {
  audioTrack = null;
  const backupVerified = seedBackupVerified;
  clearMediaPreview(); stopNodeTools(); outbox.reset();
  for (const timer of fileRetryTimers.values()) clearTimeout(timer);
  fileRetryTimers.clear(); fileRetryAttempts.clear(); sessionFiles.clear(); incomingFiles.clear(); sendingFiles.clear();
  peerReadConfirmed.clear(); readReceiptSending.clear(); visibleReadNodes.clear(); automaticFileBytes = 0;
  replyDrafts = {}; selecting = false; selectedMessages = []; attachmentMenu = false;
  networkSummaryOpen = false; nodeBudgetOpen = false; fileDragActive = false;
  actionMode = null; actionError = ''; highlightedMessage = ''; forwardCompleted.clear();
  messageTools = null;
  copiedMessageId = ''; pinBusy = false;
  nodeChecks = {}; nodeStates = []; peerRoutes = {}; routedTransport = null;
  peerCardAddress = ''; peerQr = ''; shareFallbackLink = ''; copiedContactId = ''; addressCopied = false;
  storageRequest++; storageFiles = []; storageReading = false; memoryConfirmation = null;
  backupOpen = false; publicKeyOpen = false; aliasDraft = ''; chatSearch = ''; galleryId = '';
  chat = null; identity = context.provider; chatStoreKey = context.key; deviceOwnerKey = context.deviceKey ?? null; address = context.accountId;
  activeProfileId = context.profile?.id ?? ''; profileNetwork = context.network;
  allProfileChats = PROFILE_FEATURES.advancedInbox && !context.network; profileInboxViewer = activeProfileId;
  applyChatData(context.data ?? {
    // Registry labels are private organizational names, not public nicknames.
    selfNickname: '', seedBackupVerified: backupVerified,
    readReceiptsEnabled: true, autoLockMinutes: DEFAULT_AUTO_LOCK_MINUTES,
    autoReceiveFilesEnabled: true, autoPlayVideoEnabled: true, allowForwardAttribution: true,
    networkSettings: emptyNetworkSettings(), offlineState: emptyOfflineState(), courierState: emptyCourierState(),
    peerReadPreferences: {}, aliases: {}, declaredNames: {}, peerPublicKeys: {}, chats: saveChats(emptySessionChats()),
  });
  trustedReadReceiptsPreference = readReceiptsEnabled;
  readReceiptsEnabled = readReceiptsForMode(trustedSession, trustedReadReceiptsPreference);
  accountView = 'chats'; mobilePane = 'list'; pendingExit = null; signalingStatus = 'idle';
  offlineDeliveryError = ''; courierError = ''; courierStatus = idleCourierStatus();
}

function profileChanged(value: ProfileRegistry): void {
  profileRegistry = profileRegistrySnapshot(value);
  if (!activeProfileId) activeProfileId = value.profiles.find(p => p.accountId === address)?.id ?? '';
  // Any changed permission invalidates the loaded projection until explicit reload.
  profileInboxSnapshot = emptyInboxPage();
}

function requestInboxPage(page: number, focus?: InboxFocus): void {
  requestedInboxPage = page; requestedInboxFocus = focus; requestedProfileId = allProfileChats ? ALL_CHATS_VIEW : activeProfileId;
}

async function openAllProfileChats(password: string): Promise<boolean> {
  if (!PROFILE_FEATURES.advancedInbox || !trustedSession || navigationBusy() || screen !== 'account') return false;
  const generation = authGeneration, owner = rootAccountId || address;
  const guard = () => { if (generation !== authGeneration || screen !== 'account' || !trustedSession || endingSession || panicBusy || memoryBusy || document.hidden) throw new Error('profile_session_changed'); };
  profileSwitchBusy = true; authBusy = true; status = '';
  let account: Awaited<ReturnType<typeof accountFromMnemonic>> | undefined;
  try {
    const vault = await loadVault(password);
    if (!vault) return false;
    try { account = await accountFromMnemonic(new TextDecoder().decode(vault.mnemonic)); }
    finally { vault.mnemonic.fill(0); }
    guard(); if (account.accountId !== owner) throw new Error('profile_owner_mismatch');
    const registry = await readSessionProfiles(account.identitySeed,owner,true,guard);
    if (!registry) throw new Error('profile_registry_missing');
    // Read-only view: do not stop transports, switch signers, save a different
    // selected identity, or emit receipts for messages in this projection.
    if (!await persistLocalChats()) throw new Error('profile_previous_history_not_saved');
    guard();
    const viewer = registry.profiles.find(p => p.role === 'main')!.id;
    const snapshot = await readProfileInbox({ root: account.identitySeed,owner,registry,viewer,now: Date.now(),guard,
      page: requestedInboxPage,focus: requestedInboxFocus });
    guard(); profileRegistry = registry; profileInboxSnapshot = snapshot; profileInboxViewer = viewer;
    allProfileChats = true; changeAccountView('chats');
    return true;
  } catch { status = 'Не удалось открыть все чаты. Данные и выбранный профиль не изменены.'; return false; }
  finally { account?.identitySeed.fill(0); account?.provider.dispose(); profileSwitchBusy = false; authBusy = false; }
}

async function switchActiveProfile(id: string, password: string, current: () => boolean = () => true): Promise<boolean> {
  if (!current()) return false;
  if (id === ALL_CHATS_VIEW) return openAllProfileChats(password);
  if (!trustedSession || navigationBusy() || screen !== 'account') return false;
  if (voiceBusy || attachingFiles || sendingFiles.size || incomingFiles.size || pendingFileWrites.size ||
      sessionChats.order.some(peer => sessionChats.byPeer[peer].sending || sessionChats.byPeer[peer].draft.trim())) {
    status = 'Завершите передачу файлов и отправьте или очистите черновики перед переключением профиля.'; return false;
  }
  const generation = authGeneration, owner = rootAccountId || address;
  const guard = () => { if (!current() || generation !== authGeneration || screen !== 'account' || !trustedSession || endingSession || panicBusy || memoryBusy || document.hidden) throw new Error('profile_session_changed'); };
  profileSwitchBusy = true; authBusy = true; status = '';
  let account: Awaited<ReturnType<typeof accountFromMnemonic>> | undefined;
  let context: ProfileChatContext | undefined;
  let stopped = false, adopted = false;
  try {
    const vault = await loadVault(password);
    if (!vault) { status = 'Неверный пароль аккаунта.'; return false; }
    try { account = await accountFromMnemonic(new TextDecoder().decode(vault.mnemonic)); }
    finally { vault.mnemonic.fill(0); }
    guard(); if (account.accountId !== owner) throw new Error('profile_owner_mismatch');
    const registry = await readSessionProfiles(account.identitySeed, owner, true, guard);
    if (!registry) throw new Error('profile_registry_missing');
    if (!PROFILE_FEATURES.advancedInbox && registry.profiles.find(p => p.id === id)?.role === 'main') throw new Error('main_profile_local_only');
    context = await prepareProfileChatContext({ root: account.identitySeed, owner, registry, profileId: id, guard });
    let sources = emptyInboxPage();
    const qr = context.network ? await QRCode.toDataURL(context.accountId) : '';
    const nextPublicKey = await context.provider.getPublicKeyBytes(); guard();
    await commitProfileChatContext(context, { guard,
      stop: async () => { const previousChat = chat; chat = null; stopped = true;
        const stopping = stopOfflineDelivery(); await previousChat?.disconnect(); await stopping; await historyWrites.settled(); },
      save: persistLocalChats,
      refresh: async next => {
        // Same-profile refresh must not replace a newly saved archive with the
        // older preflight copy (receipts/messages may arrive during preflight).
        next.data = await loadLocalChatData(next.key,next.accountId) ?? undefined; guard();
        if (PROFILE_FEATURES.advancedInbox) sources = await readProfileInbox({ root: account!.identitySeed, owner, registry, viewer: id, now: Date.now(), guard,
          page: id === activeProfileId ? requestedInboxPage : 0, focus: id === activeProfileId ? requestedInboxFocus : undefined });
        await withBrowserProfileSelection({ root: account!.identitySeed, scope: owner, trusted: true, guard }, store => store.save(id));
      },
      adopt: next => { identity?.dispose(); authGeneration++; adoptProfileContext(next); adopted = true; },
    });
    profileRegistry = registry; profileInboxSnapshot = sources; rootAccountId = owner;
    publicKey = Array.from(nextPublicKey, byte => byte.toString(16).padStart(2,'0')).join(''); qrPublic = qr;
    pageNavigation?.clear(); navigationAccount = ''; lastActivity = Date.now();
    await initializeChat();
    const peer = requestedProfilePeer; requestedProfilePeer = '';
    if (context.network && peer) await openConversation(peer);
    return true;
  } catch {
    status = 'Не удалось переключить профиль. Проверьте пароль, историю и сохранённую связку. Старые данные не удалены.';
    if (stopped && !adopted && identity && screen === 'account') await initializeChat();
    return false;
  } finally {
    if (!adopted) context?.close();
    account?.identitySeed.fill(0); account?.provider.dispose(); profileSwitchBusy = false; authBusy = false;
  }
}

async function saveWithPin() {
  if (authBusy) return;

  if (!newAccountFlow && !mnemonic) return;
  if ((pendingProfileBackup || pendingFullBackup) && !trustedDeviceChoice) {
    status = 'Для восстановления связки профилей включите доверенное устройство. Временный режим не сохраняет реестр профилей.';
    return;
  }
  const nickname = authNickname.trim();
  if (nickname.length > 32 || /[\u0000-\u001f\u007f]/.test(nickname)) {
    status = 'Ник: максимум 32 символа, без управляющих знаков.';
    return;
  }

  const passwordError = passwordPolicyError(pin);
  if (passwordError) { status = passwordError; return; }

  authBusy = true;
  const generation = authGeneration;
  let seedBytes: Uint8Array | undefined;
  try {
    status = '';
    if (newAccountFlow && !mnemonic) {
      // Only a submitted, valid form may request seed entropy. Retain this seed
      // on a save failure: retrying must never silently replace the account.
      mnemonic = generateRegistrationMnemonic(pin, registrationWordCount);
    }
    if (newAccountFlow && !identity) {
      const account = await prepareAccount(mnemonic, generation);
      if (generation !== authGeneration) { account.identitySeed.fill(0); account.provider.dispose(); return; }
      tempSeed = account.identitySeed; identity = account.provider;
      publicKey = account.publicKey; address = account.accountId;
      qrPublic = await QRCode.toDataURL(address);
      if (generation !== authGeneration) return;
    }
    seedBytes = new TextEncoder().encode(mnemonic);
    if (pendingFullBackup && tempSeed && !pendingFullRestored) {
      await restoreFullBackup(pendingFullBackup, tempSeed, rootAccountId || address, pendingProfileBackup,
        () => { if (generation !== authGeneration || screen !== 'setPin') throw new Error('auth_cancelled'); });
      pendingFullRestored = true;
    }
    await saveVault(seedBytes, pin, createIdentityMetadata(), trustedDeviceChoice);
    if (generation !== authGeneration) return;

    if (pendingProfileBackup && tempSeed) {
      const bundle = await openBrowserProfileBundle({ root: tempSeed, scope: rootAccountId || address, trusted: trustedDeviceChoice,
        isCurrent: () => generation === authGeneration && screen === 'setPin' });
      try { await bundle.restore(pendingProfileBackup); }
      finally { bundle.close(); }
      if (generation !== authGeneration) return;
      pendingProfileBackup = undefined;
    }

    trustedSession = trustedDeviceChoice;
    if (tempSeed && trustedDeviceChoice) {
      const owner = rootAccountId || address;
      const guard = () => { if (generation !== authGeneration || screen !== 'setPin') throw new Error('auth_cancelled'); };
      let registry = await readSessionProfiles(tempSeed,owner,true,guard);
      if (newAccountFlow && !registry) {
        const bundle = await openBrowserProfileBundle({ root: tempSeed,scope: owner,trusted: true,
          isCurrent: () => generation === authGeneration && screen === 'setPin' });
        try { registry = await bundle.initializePersonal(); } finally { bundle.close(); }
      }
      guard();
      if (registry) {
        const selected = resolveProfileSelection(registry, pendingFullBackup?.selectedProfileId);
        let context: ProfileChatContext | undefined;
        try {
          context = await prepareProfileChatContext({ root: tempSeed,owner,registry,profileId: selected,guard });
          const qr = context.network ? await QRCode.toDataURL(context.accountId) : '';
          const nextKey = await context.provider.getPublicKeyBytes(); guard();
          if (selected) await withBrowserProfileSelection({ root: tempSeed,scope: owner,trusted: true,guard },store => store.save(selected));
          guard(); identity?.dispose(); adoptProfileContext(context); context = undefined;
          profileRegistry = registry; rootAccountId = owner;
          publicKey = Array.from(nextKey,byte => byte.toString(16).padStart(2,'0')).join(''); qrPublic = qr;
        } finally { context?.close(); }
      } else await restoreLocalChats(tempSeed,true);
    } else if (tempSeed) await restoreLocalChats(tempSeed, trustedDeviceChoice);
    if (generation !== authGeneration) return;
    if (nickname) { selfNickname = nickname; nicknameDraft = nickname; }
    if (!newAccountFlow) seedBackupVerified = true;
    else { seedNoticeDismissed = false; deviceOffer = true; }
    trustedSession = trustedDeviceChoice;
    if (!await persistLocalChats()) throw new Error('onboarding_history_not_saved');
    if (generation !== authGeneration) return;
    if (pendingFullBackup?.language) setLanguage(pendingFullBackup.language, localStorage);
    disposeFullBackup(pendingFullBackup); pendingFullBackup = undefined; pendingFullRestored = false;
    // Seed is erased below; the backup action later unlocks the existing vault.
    mnemonic = '';
    pin = '';
    tempSeed?.fill(0);
    tempSeed = null;
    lastActivity = Date.now();
    screen = 'account';
    newAccountFlow = false;
    await initializeChat();
  } catch (e) {
    if (generation !== authGeneration) return;
    status = e instanceof Error && e.message === 'backup_destination_not_empty'
      ? 'Здесь уже есть история одного из профилей. Полная копия не заменяет её. Используйте отдельный браузер или пустой профиль браузера для восстановления.'
      : e instanceof Error && e.message === 'profile_backup_conflict'
      ? 'Вход сохранён, но связка профилей конфликтует с локальной и не заменена. Перезагрузите страницу и войдите новым паролем. Импорт доступен в настройках аккаунта.'
      : 'Не удалось сохранить вход или подготовить историю. Попробуйте ещё раз.';
  } finally {
    seedBytes?.fill(0);
    authBusy = false;
  }

}

async function unlockAccount(automatic = false, password = unlockPin, current = () => true) {
  if (authBusy) return;
  if (!automatic) autoUnlock.cancel();
  authBusy = true;
  autoUnlockBusy = automatic;
  status = '';
  const generation = authGeneration;

  try {
    const vault = await loadVault(password);
    if (!vault) {
      if (generation !== authGeneration) return;
      if (!automatic) status = 'Неверный пароль ❌';
      return;
    }
    try {
      if (generation !== authGeneration || !current() || screen !== 'unlock' || password !== unlockPin) return;
      // Keep typing responsive during PBKDF2 guesses. Freeze only once the
      // current value has really decrypted the vault and account setup begins.
      autoUnlockBusy = false;
      const restoredMnemonic = new TextDecoder().decode(vault.mnemonic);
      const account = await prepareAccount(restoredMnemonic, generation);
      const seed = account.identitySeed;
      try {
        if (generation !== authGeneration || !current() || password !== unlockPin) { account.provider.dispose(); return; }
        if (vault.legacy) await saveVault(vault.mnemonic, password, vault.metadata, isTrustedDevice());
        if (generation !== authGeneration || !current() || password !== unlockPin) return;
        const sessionTrusted = lockedSession?.trusted ?? isTrustedDevice();
        const guard = () => { if (generation !== authGeneration || !current()) throw new Error('auth_cancelled'); };
        const registry = await readSessionProfiles(seed, account.accountId, sessionTrusted, guard);
        const remembered = sessionTrusted ? await withBrowserProfileSelection({ root: seed, scope: account.accountId, trusted: true, guard }, store => store.read()) : undefined;
        const selected = resolveProfileSelection(registry, lockedProfileId || remembered);
        let context: ProfileChatContext | undefined;
        try {
          context = await prepareProfileChatContext({ root: seed, owner: account.accountId, registry, profileId: selected, guard,
            read: (key, id) => lockedSession?.accountId === id ? Promise.resolve(snapshotLocalChatData(lockedSession.data)) : loadLocalChatData(key,id) });
          const sources = PROFILE_FEATURES.advancedInbox && registry && context.profile ? await readProfileInbox({ root: seed, owner: account.accountId, registry, viewer: context.profile.id, now: Date.now(), guard }) : emptyInboxPage();
          const qr = context.network ? await QRCode.toDataURL(context.accountId) : '';
          const nextKey = await context.provider.getPublicKeyBytes(); guard();
          const files = lockedSession?.accountId === context.accountId ? lockedSession.files : null;
          trustedSession = sessionTrusted; adoptProfileContext(context); context = undefined;
          for (const [key, bytes] of files ?? []) sessionFiles.set(key,bytes);
          lockedSession = null; lockedProfileId = ''; profileRegistry = registry; profileInboxSnapshot = sources;
          publicKey = Array.from(nextKey, byte => byte.toString(16).padStart(2,'0')).join(''); qrPublic = qr;
        } finally { context?.close(); }
        trustedSession = sessionTrusted;
        trustedDeviceChoice = sessionTrusted;
        unlockPin = '';
        lastActivity = Date.now();
        screen = 'account';
        await initializeChat();
      } finally { seed.fill(0); if (identity !== account.provider) account.provider.dispose(); }

    } finally {
      vault.mnemonic.fill(0);
    }
  } catch (e) {
    if (generation !== authGeneration) return;
    identity?.dispose(); identity = null;
    if (!lockedSession) releaseAccountLease();
    status = accountBusyError(e) ? 'Этот аккаунт уже открыт в другой вкладке. Выйдите там или закройте её.'
      : 'Не удалось открыть аккаунт или подготовить историю. Данные в браузере не удалены.';
  } finally {
    autoUnlockBusy = false;
    authBusy = false;
  }
}

async function send() {
  if (composerSending || attachingFiles || navigationBusy() || screen !== 'account') return;
  const peer=sessionChats.activePeer, generation=authGeneration, activeChat=chat;
  const files=[...pastedFiles];
  if (preferRadio && files.length) { status='Файлы по LoRa не передаются. Снимите выбор LoRa для обычной отправки.'; return; }
  if (!files.length) { await sendTextOnly(); return; }
  if (sessionChats.byPeer[peer]?.contact !== 'accepted') return;
  const draft=sessionChats.byPeer[peer].draft.trim();
  if (draft && !textFitsLimit(draft,false)) { status='Сообщение слишком длинное (максимум 64 КБ).'; return; }
  composerSending=true;
  try {
    for (const file of files) {
      if (generation!==authGeneration || peer!==sessionChats.activePeer || chat!==activeChat) return;
      if (!await addAttachments([file], sendRule)) return;
      if (generation!==authGeneration || peer!==sessionChats.activePeer || chat!==activeChat) return;
      // Remove each successfully queued file; a retry cannot duplicate earlier ones.
      pastedFiles=pastedFiles.filter(value=>value!==file);
    }
    if (generation===authGeneration && peer===sessionChats.activePeer && chat===activeChat) { await sendTextOnly(); if (!pastedFiles.length && !sessionChats.byPeer[peer]?.draft.trim()) sendRule = undefined; }
  } finally { composerSending=false; }
}
function pasteImage(event: ClipboardEvent): void {
  const files=clipboardImages(event.clipboardData); if (!files.length) return;
  event.preventDefault();
  const peer=sessionChats.activePeer;
  if (composerSending || attachingFiles || navigationBusy() || sessionChats.byPeer[peer]?.contact!=='accepted') { status='Сейчас вставка картинки недоступна. Дождитесь завершения текущего действия.'; return; }
  const pending=sessionChats.byPeer[peer].messages.filter(message=>message.direction==='outgoing' && message.file && !['ready','canceled','rejected'].includes(message.fileStatus??'')).length;
  const error=validateAttachmentBatch([...pastedFiles,...files],pending);
  if (error) { status=error; return; }
  if ([...pastedFiles,...files].reduce((sum,file)=>sum+file.size,0)>MAX_AUTO_FILE_BYTES) { status='Во вставленных картинках суммарно допускается до 100 МБ.'; return; }
  pastedFiles=[...pastedFiles,...files];
  const text=event.clipboardData?.getData('text/plain')??'';
  if (text) {
    const field=event.currentTarget as HTMLTextAreaElement, start=field.selectionStart, end=field.selectionEnd;
    setDraft(peer,pastedText(field.value,text,start,end));
    void tick().then(()=>{if(field.isConnected && sessionChats.activePeer===peer)field.setSelectionRange(start+text.length,start+text.length);});
  }
}
async function sendTextOnly() {
  const peer = sessionChats.activePeer;
  const conversation = sessionChats.byPeer[peer];
  const text = conversation?.draft.trim();
  if (!text || conversation.sending || switchingTrust || actionBusy || memoryBusy || endingSession) return;
  if (conversation.contact !== 'new' && conversation.contact !== 'accepted') return;
  if (!textFitsLimit(text, conversation.contact === 'new')) {
    sessionChats = updateConversation(sessionChats, peer, (current) => ({
      ...current, error: conversation.contact === 'new'
        ? 'Первое сообщение слишком длинное (максимум 4 КБ).'
        : 'Сообщение слишком длинное (максимум 64 КБ).',
    }));
    return;
  }
  const sendingChat = chat;
  const generation = authGeneration, senderAddress = address, originalContact = conversation.contact;
  const messageId = crypto.randomUUID();
  const useRadio = preferRadio, activeRadio = radioRuntime;
  if (useRadio && (!activeRadio || !radioAvailable || pastedFiles.length || conversation.contact !== 'accepted')) { status = 'Для LoRa нужен подключённый модуль и принятый контакт. Файлы не поддерживаются.'; return; }
  const details: MessageDetails = { allowForwardAttribution, ...(replyDrafts[peer] ? { reply: replyDrafts[peer] } : {}) };
  if (sendRule) {
    if (conversation.contact !== 'accepted') { status = 'Для исчезающих сообщений сначала нужен принятый запрос на переписку.'; return; }
    details.ephemeral = { ...sendRule };
  }
  try { if (!textFitsLimit(encodeChatContent(text, details), conversation.contact === 'new')) throw new Error('too_large'); }
  catch { status = 'Сообщение вместе с цитатой слишком длинное.'; return; }
  if (useRadio && (!activeRadio?.hasRoute(peer) || !radioEligible({id:messageId,text,from:address,timestamp:Date.now(),direction:'outgoing',delivery:'queued',details}))) {
    status = 'Для LoRa нужен действующий радиоконтакт и короткий обычный текст, до 320 байт вместе с оформлением.'; return;
  }

  sessionChats = updateConversation(sessionChats, peer, (current) => ({
    ...current,
    sending: true,
    error: '',
  }));
  try {
    sessionChats = recordSentMessage(sessionChats, peer, {
      id: messageId,
      text,
      from: address,
      timestamp: Date.now(),
      direction: 'outgoing',
      delivery: 'saving',
      ...(useRadio ? {radioDelivery:'queued' as const} : {}),
      deviceCopies: deviceCopyKinds(address, peer, false, deviceSettings.peers),
      details,
    });
    sessionChats = updateConversation(sessionChats,peer,c => ({...c,draft:c.draft.trim() === text ? '' : c.draft}));
    if (!await persistLocalChats()) {
      if (generation !== authGeneration || senderAddress !== address) return;
      sessionChats = updateConversation(sessionChats,peer,c => ({...c,messages:c.messages.filter(m => m.id !== messageId),
        contact:c.contact === 'outgoing' && originalContact === 'new' ? 'new' : c.contact,draft:c.draft || text}));
      throw new Error('Не удалось сохранить сообщение в браузере. Отправка отменена.');
    }
    if (generation !== authGeneration || senderAddress !== address) return;
    sessionChats = setDeliveryStatus(sessionChats,peer,messageId,peer === address ? 'delivered' : 'queued');
    sendRule = undefined;
    const nextReplies = { ...replyDrafts }; delete nextReplies[peer]; replyDrafts = nextReplies;
    if (peer === address) return;
    if (useRadio && activeRadio) { await activeRadio.send(peer,messageId); return; }
    // Primary-to-primary delivery never enters the delegated-device protocol.
    // Existing device journals remain separate; synchronization is not a gate.
    if (sessionChats.byPeer[peer]?.connection !== 'connected') outgoingIssue(peer,messageId,
      originalContact === 'new' ? 'contact_pending' : !courierState.node && !offlineDeliveryState.node ? 'node_not_configured' : !courierState.enabled && !offlineDeliveryState.enabled ? 'node_sending_disabled' : undefined);
    courierDelivery?.wake();
    void deviceRuntime?.wake().catch(() => {});
    if (sendingChat && chat === sendingChat) {
      if (sessionChats.byPeer[peer]?.connection === 'connected') void flushOutbox(peer, sendingChat);
      else void sendingChat.connect(peer).catch(() => {});
    }
  } catch (e) {
    if (generation !== authGeneration || senderAddress !== address) return;
    if (useRadio) { markRadioRetry(peer,messageId); radioErrorText=radioError(e); }
    sessionChats = updateConversation(sessionChats, peer, (current) => ({
      ...current,
      error: useRadio ? radioError(e) : e instanceof Error ? e.message : 'Не удалось отправить сообщение',
    }));
  } finally {
    if (generation === authGeneration && senderAddress === address) {
      sessionChats = updateConversation(sessionChats, peer, (current) => ({
        ...current,
        sending: false,
      }));
    }
  }
}

function fileTransferKey(peer: string, id: string): string { return `${peer}:${id}`; }

function mediaCanOpen(message: ChatEntry): boolean {
  if (message.details?.ephemeral) return false;
  return !message.fileDeleted && !!message.file && (message.direction === 'outgoing'
    ? message.fileStatus !== 'canceled' && message.fileStatus !== 'rejected'
    : message.fileStatus === 'ready');
}

function clearMediaPreview(): void {
  previewGeneration++;
  galleryId = '';
  for (const url of Object.values(imageUrls)) URL.revokeObjectURL(url);
  imageUrls = {};
  imageErrors = {};
  imageUrlOrder.length = 0;
  imageLoading.clear();
}

async function verifiedMedia(peer: string, id: string): Promise<{ bytes: Uint8Array; mime: string; kind: 'image' | 'audio' | 'video' }> {
  const generation = authGeneration, owner = address;
  const entry = sessionChats.byPeer[peer]?.messages.find((message) => message.id === id);
  if (!entry?.file || !mediaCanOpen(entry)) throw new Error('media_unavailable');
  const media = inlineMediaFor(entry.file);
  if (!media) throw new Error('media_format_not_supported');
  const bytes = await getFileBytes(peer, id);
  if (!bytes || bytes.length !== entry.file.size || await sha256Hex(bytes) !== entry.file.sha256)
    throw new Error('media_missing_or_damaged');
  if (generation !== authGeneration || owner !== address || screen !== 'account' ||
    !sessionChats.byPeer[peer]?.messages.some(message => message.id === id && mediaCanOpen(message))) throw new Error('media_session_changed');
  return { bytes, ...media };
}

async function ensureImageUrl(peer: string, id: string): Promise<void> {
  const key = fileTransferKey(peer, id);
  if (imageUrls[key] || imageLoading.has(key) || imageErrors[key]) return;
  const generation = previewGeneration;
  const account = address;
  imageLoading.add(key);
  try {
    const media = await verifiedMedia(peer, id);
    const inCard = (accountView === 'peer' && peerCardAddress === peer) || (accountView === 'own' && address === peer);
    if ((media.kind !== 'image' && media.kind !== 'video') || generation !== previewGeneration || address !== account ||
      (!inCard && sessionChats.activePeer !== peer)) return;
    const url = URL.createObjectURL(new Blob([media.bytes as BlobPart], { type: media.mime }));
    imageUrls = { ...imageUrls, [key]: url };
    imageUrlOrder.push(key);
    while (imageUrlOrder.length > 12) {
      const old = imageUrlOrder.find((candidate) => candidate !== fileTransferKey(peer, galleryId));
      if (!old) break;
      imageUrlOrder.splice(imageUrlOrder.indexOf(old), 1);
      URL.revokeObjectURL(imageUrls[old]);
      const next = { ...imageUrls };
      delete next[old];
      imageUrls = next;
    }
  } catch (e) {
    if (generation === previewGeneration) {
      imageErrors = { ...imageErrors, [key]: true };

    }
  } finally { imageLoading.delete(key); }
}

function observeImage(node: HTMLElement, details: { peer: string; id: string }) {
  const observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) void ensureImageUrl(details.peer, details.id);
  });
  observer.observe(node);
  return { destroy() { observer.disconnect(); } };
}

// Serialize decoding and recheck the active account before and after every async stage.
let storagePreviewQueue: Promise<unknown> = Promise.resolve();
function loadStoragePreview(file: ManagedFile): Promise<Blob | null> {
  const owner = address, generation = previewGeneration;
  const current = () => address === owner && generation === previewGeneration && screen === 'account' &&
    accountView === 'profile' && settingsSection === 'files' && mediaSettingsSection === 'storage';
  const work = storagePreviewQueue.catch(() => {}).then(async () => {
    if (!current() || file.category !== 'image') return null;
    const media = await verifiedMedia(file.peer, file.messageId);
    if (!current() || media.kind !== 'image') return null;
    const blob = await storageThumbnail(media.bytes, media.mime);
    return current() ? blob : null;
  });
  storagePreviewQueue = work.then(() => {}, () => {});
  return work;
}

function observeContactPreview(node: HTMLElement, details: { peer: string; id: string }) {
  const entry = sessionChats.byPeer[details.peer]?.messages.find(message => message.id === details.id);
  const kind = entry?.file && inlineMediaFor(entry.file)?.kind;
  if (!entry || !mediaCanOpen(entry) || (kind !== 'image' && kind !== 'video')) return { destroy() {} };
  return observeImage(node, details);
}

function openGallery(peer: string, id: string): void {
  galleryId = id;
  void ensureImageUrl(peer, id);
}
function closeGallery(): void {
  // Closing media updates this level instead of pushing a new "closed" view
  // which would make the next Back reopen the same media.
  restoringPage = true; galleryId = '';
  void tick().then(() => { restoringPage = false; });
}

function moveGallery(direction: -1 | 1): void {
  if (!galleryItems.length || galleryIndex < 0) return;
  const next = (galleryIndex + direction + galleryItems.length) % galleryItems.length;
  openGallery(sessionChats.activePeer, galleryItems[next].id);
}

async function galleryAction(action: 'download' | 'share' | 'forward' | 'reply' | 'show-in-chat'): Promise<void> {
  const peer = sessionChats.activePeer, generation = authGeneration;
  const message = galleryItems[galleryIndex];
  if (!message || actionBusy || memoryBusy || endingSession || switchingTrust || pinBusy || attachingFiles || voiceBusy) return;
  if (action === 'download') { downloadMessage(peer, message); return; }
  closeGallery();
  // Let the native viewer release focus before opening another dialog or input.
  await tick();
  if (generation !== authGeneration || screen !== 'account' || peer !== sessionChats.activePeer ||
    !sessionChats.byPeer[peer]?.messages.some(entry => entry.id === message.id && !entry.fileDeleted)) return;
  if (action === 'show-in-chat') jumpToMessage(message.id);
  else if (action === 'share') messageTools = { id: message.id, view: 'share' };
  else if (action === 'forward') messageAction(message, 'forward');
  else if (sessionChats.byPeer[peer]?.contact === 'accepted') startReply(message);
}

async function galleryStickerAction(action: 'save' | 'request'): Promise<string> {
  const peer = sessionChats.activePeer, generation = authGeneration, id = galleryId;
  const message = galleryItems[galleryIndex];
  if (!message || message.details?.media?.kind !== 'sticker' || mediaBusy || navigationBusy()) return 'Сейчас действие недоступно.';
  if (action === 'request') {
    if (message.direction !== 'incoming' || !message.details.media.packId || sessionChats.byPeer[peer]?.contact !== 'accepted') return 'Этот набор нельзя запросить.';
    await requestStickerPack(peer, message.details.media);
  } else await saveMessageMedia(peer, message);
  return generation === authGeneration && peer === sessionChats.activePeer && galleryId === id ? status : '';
}

function playAudio(peer: string, id: string): void {
  if (navigationBusy() || screen !== 'account') return;
  const entry = sessionChats.byPeer[peer]?.messages.find(message => message.id === id);
  if (!entry?.file || !isQueueAudio(entry) || !mediaCanOpen(entry)) return;
  if (audioTrack?.peer === peer && audioTrack.id === id) return;
  const key = `${address}:${peer}`;
  if (audioTrack?.key === key) audioTrack = { ...audioTrack, id };
  else audioTrack = { key, peer, id, load: trackId => verifiedMedia(peer,trackId),
    loadShareFile: trackId => prepareMessageFile(peer,trackId,false) };
}
async function audioQueueAction(id: string, action: 'download' | 'forward' | 'show-in-chat'): Promise<void> {
  const track = audioTrack, generation = authGeneration;
  if (!track || navigationBusy()) return;
  const peer = track.peer, message = sessionChats.byPeer[peer]?.messages.find(entry => entry.id === id && mediaCanOpen(entry));
  if (!message) return;
  if (action === 'download') { downloadMessage(peer,message); return; }
  await openContactMessage(peer,id);
  if (generation !== authGeneration || peer !== sessionChats.activePeer || screen !== 'account') return;
  if (action === 'forward') messageAction(message,'forward');
}
$effect(() => {
  const track = audioTrack;
  if (track && !sessionChats.byPeer[track.peer]?.messages.some(message => message.id === track.id && mediaCanOpen(message))) audioTrack = null;
});

function updateFileEntry(peer: string, id: string, patch: Partial<import('$lib/chat/session-chats').ChatEntry>): void {
  if (!sessionChats.byPeer[peer]) return;
  sessionChats = updateConversation(sessionChats, peer, (conversation) => ({
    ...conversation,
    messages: conversation.messages.map((message) => message.id === id && message.file ? { ...message, ...patch } : message),
  }));
}

function openMediaLibrary(tab: 'gifs' | 'stickers'): void {
  if (navigationBusy()) return;
  attachmentMenu = false; mediaTab = tab; mediaOpen = true;
}
async function loadLibraryAsset(hash: string): Promise<Uint8Array | null> {
  const generation = authGeneration; const accountId = address; const key = chatStoreKey;
  const asset = mediaLibrary.assets.find(a => a.hash === hash); if (!asset) return null;
  const id = libraryFileId(asset.id);
  const bytes = sessionFiles.get(id) ?? (key ? await loadLocalFileData(key, accountId, id) : null);
  if (generation !== authGeneration || address !== accountId || screen !== 'account') throw new Error('Профиль изменился.');
  if (!bytes || bytes.length !== asset.size || await sha256Hex(bytes) !== hash) throw new Error('Файл библиотеки отсутствует или повреждён.');
  if (generation !== authGeneration || address !== accountId || screen !== 'account') throw new Error('Профиль изменился.');
  return bytes;
}
async function commitMediaLibrary(next: MediaLibrary, files: PreparedMedia[] = [], expectedGeneration = authGeneration): Promise<void> {
  if (screen !== 'account' || expectedGeneration !== authGeneration) throw new Error('Профиль изменился.');
  if (navigationBusy()) throw new Error('Дождитесь завершения текущего действия.');
  const accountId = address; const generation = authGeneration; const key = chatStoreKey;
  const previous = mediaLibrary; const epoch = storageEpoch(); const durable = trustedSession;
  const normalized = normalizeMediaLibrary(next);
  // Reimport can also repair a missing local asset after a partial backup.
  const additions = new Map(files.filter(f => normalized.assets.some(a=>a.hash===f.asset.hash)).map(f => [libraryFileId(normalized.assets.find(a=>a.hash===f.asset.hash)!.id), f.bytes]));
  const removed = previous.assets.filter(a => !normalized.assets.some(b => b.hash === a.hash)).map(a => libraryFileId(a.id));
  mediaBusy = true;
  try {
    if (durable) {
      if (!key) throw new Error('Хранилище недоступно.');
      const snapshot = {...chatSnapshot(),mediaLibrary:normalized};
      // Metadata and new encrypted files land in a single IndexedDB transaction.
      await historyWrites.enqueue(async () => {
        requireStorageEpoch(epoch); await saveLocalSessionData(key, accountId, snapshot, additions);
        if (generation === authGeneration && address === accountId) mediaLibrary = normalized;
      });
      // Metadata is already committed: failed deletion leaves only orphaned ciphertext.
      if (removed.length) await deleteLocalFiles(accountId, removed).catch(() => { status = 'Библиотека обновлена; очистку освободившегося места можно повторить.'; });
    } else {
      for (const [id, bytes] of additions) sessionFiles.set(id, bytes.slice());
      mediaLibrary = normalized;
    }
    if (generation === authGeneration && address === accountId) for (const id of removed) { sessionFiles.get(id)?.fill(0); sessionFiles.delete(id); }
  } catch(e) {
    if (generation === authGeneration && address === accountId) mediaLibrary = previous;
    throw e;
  } finally { mediaBusy = false; }
}
async function preparedLibraryPack(pack: StickerPack): Promise<PreparedMedia[]> {
  const result: PreparedMedia[] = [];
  for (const hash of pack.assets) {
    const bytes = await loadLibraryAsset(hash); const asset = mediaLibrary.assets.find(a => a.hash === hash);
    if (!bytes || !asset) throw new Error('Набор неполный.'); result.push({asset:{...asset},bytes});
  }
  return result;
}
async function sendLibraryFile(file: File, details: MessageDetails, peer = sessionChats.activePeer): Promise<void> {
  const activeChat = chat;
  if (!activeChat || navigationBusy() || attachingFiles || sessionChats.byPeer[peer]?.contact !== 'accepted') throw new Error('Откройте чат с принятым контактом.');
  const pending = sessionChats.byPeer[peer].messages.filter(m => m.direction === 'outgoing' && m.file && !['ready','canceled','rejected'].includes(m.fileStatus ?? '')).length;
  const error = validateAttachmentBatch([file],pending); if (error) throw new Error(error);
  attachingFiles = true;
  try { if (!await enqueueAttachment(file,peer,activeChat,{ ...details, ...(sendRule ? { ephemeral:{ ...sendRule } } : {}) })) throw new Error(status || 'Не удалось добавить в очередь.'); sendRule = undefined; }
  finally { attachingFiles = false; }
}
async function sendLibraryAsset(asset: MediaAsset, pack?: StickerPack): Promise<void> {
  const peer = sessionChats.activePeer; const generation = authGeneration;
  const bytes = await loadLibraryAsset(asset.hash); if (!bytes || generation !== authGeneration || peer !== sessionChats.activePeer) throw new Error('Чат изменился.');
  await sendLibraryFile(new File([bytes as BlobPart],asset.name,{type:asset.mime}), {
    allowForwardAttribution, ...(replyDrafts[peer] ? {reply:replyDrafts[peer]} : {}),
    media: pack ? {kind:'sticker',packId:pack.id,packName:pack.name} : {kind:'gif'},
  },peer);
  if (generation !== authGeneration) return;
  const replies={...replyDrafts}; delete replies[peer]; replyDrafts=replies;
  await commitMediaLibrary({...mediaLibrary,assets:mediaLibrary.assets.map(a=>a.hash===asset.hash?{...a,usedAt:Date.now()}:a)});
  mediaOpen=false;
}
async function shareLibraryPack(pack: StickerPack, peer = sessionChats.activePeer): Promise<void> {
  const generation = authGeneration;
  const zip = exportStickerPack(pack,await preparedLibraryPack(pack));
  if (generation !== authGeneration || sessionChats.activePeer !== peer) throw new Error('Чат изменился.');
  await sendLibraryFile(new File([zip as BlobPart],`${safeFileName(pack.name)}.automesh-stickers.zip`,{type:'application/zip'}),
    {allowForwardAttribution,media:{kind:'sticker-pack',packId:pack.id,packName:pack.name}},peer);
  status='Набор добавлен в очередь файлов.';
}
async function downloadLibraryPack(pack: StickerPack): Promise<void> {
  const generation = authGeneration;
  const zip=exportStickerPack(pack,await preparedLibraryPack(pack));
  if (generation !== authGeneration || screen !== 'account') throw new Error('Профиль изменился.');
  saveDownload(zip as BlobPart,`${safeFileName(pack.name)}.automesh-stickers.zip`);
}
async function saveMessageMedia(peer: string, message: ChatEntry): Promise<void> {
  try {
    const file=await prepareMessageFile(peer,message.id); const generation=authGeneration;
    const bytes=new Uint8Array(await file.arrayBuffer());
    if (message.details?.media?.kind==='sticker-pack') {
      const pack=await importStickerPack(bytes,message.details.media.packId);
      if (generation===authGeneration && sessionChats.activePeer===peer) receivedPack=pack;
      return;
    }
    const media=await prepareMedia(bytes,file.name);
    if (generation!==authGeneration || sessionChats.activePeer!==peer) return;
    if (message.details?.media?.kind==='sticker') {
      const pack=await makePack(message.details.media.packName ? `${message.details.media.packName} · стикер` : 'Мой стикер',[media]);
      if (generation!==authGeneration) return;
      await commitMediaLibrary(addMedia(mediaLibrary,[media],pack),[media]);
    } else await commitMediaLibrary(addMedia(mediaLibrary,[media]),[media]);
    status='Добавлено в библиотеку этого профиля.';
  } catch(e) { status=e instanceof Error?e.message:'Не удалось добавить.'; }
}
async function acceptReceivedPack(): Promise<void> {
  const pack=receivedPack; if (!pack) return;
  try { await commitMediaLibrary(addMedia(mediaLibrary,pack.files,pack.pack),pack.files); receivedPack=null; status='Стикерпак добавлен.'; }
  catch(e) { status=e instanceof Error?e.message:'Не удалось добавить набор.'; }
}
async function requestStickerPack(peer: string, details: NonNullable<MessageDetails['media']>): Promise<void> {
  try { await queueRichMessage(peer,`Можно прислать набор «${details.packName}»?`,{allowForwardAttribution,media:{...details,kind:'pack-request'}}); status='Запрос отправлен. Собеседник решает, присылать ли набор.'; }
  catch(e) { status=e instanceof Error?e.message:'Не удалось отправить запрос.'; }
}
async function answerPackRequest(pack: StickerPack, peer: string): Promise<void> {
  try { await shareLibraryPack(pack,peer); }
  catch(e) { status=e instanceof Error?e.message:'Не удалось отправить набор.'; }
}

async function storeFileBytes(peer: string, id: string, bytes: Uint8Array): Promise<void> {
  if (memoryBusy || endingSession) throw new Error('storage_busy');
  const storageId = fileTransferKey(peer, id);
  if (trustedSession) {
    if (!chatStoreKey || !address) throw new Error('file_store_unavailable');
    const write = saveLocalFileData(chatStoreKey, address, storageId, bytes);
    pendingFileWrites.add(write);
    try { await write; } finally { pendingFileWrites.delete(write); }
  } else sessionFiles.set(storageId, bytes);
}

async function getFileBytes(peer: string, id: string): Promise<Uint8Array | null> {
  const storageId = fileTransferKey(peer, id);
  return sessionFiles.get(storageId) ?? (chatStoreKey ? await loadLocalFileData(chatStoreKey, address, storageId) : null);
}

async function chooseFile(event: Event): Promise<void> {
  const input = event.currentTarget as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = '';
  stageAttachments(files);
}
function stageAttachments(files: File[]): void {
  const peer = sessionChats.activePeer;
  if (!files.length || navigationBusy() || attachingFiles || composerSending || sessionChats.byPeer[peer]?.contact !== 'accepted') return;
  const pending = sessionChats.byPeer[peer].messages.filter(message => message.direction === 'outgoing' && message.file && !['ready','canceled','rejected'].includes(message.fileStatus ?? '')).length;
  const error = validateAttachmentBatch([...pastedFiles,...files],pending);
  if (error) { status = error; return; }
  pastedFiles = [...pastedFiles,...files];
}

async function addAttachments(files: File[], rule?: MessageDetails['ephemeral']): Promise<boolean> {
  const peer = sessionChats.activePeer;
  const activeChat = chat;
  if (!files.length || !activeChat || attachingFiles || navigationBusy(false) || screen !== 'account' || sessionChats.byPeer[peer]?.contact !== 'accepted') return false;
  const pending = sessionChats.byPeer[peer].messages.filter((message) => message.direction === 'outgoing' && message.file &&
    message.fileStatus !== 'ready' && message.fileStatus !== 'canceled' && message.fileStatus !== 'rejected').length;
  const error = validateAttachmentBatch(files, pending);
  if (error) { status = error; return false; }
  attachingFiles = true; status = '';
  try {
    // Sequential disk writes bound peak memory. Every file keeps its own offer,
    // authenticated chunks, progress, retry and final integrity check.
    for (const file of files) {
      if (chat !== activeChat || endingSession || sessionChats.byPeer[peer]?.contact !== 'accepted') return false;
      if (rule && !rule.allowDownload && !/^(image\/(png|jpeg|webp|gif|avif)|audio\/|video\/)/.test(file.type)) { status = 'Без скачивания пока поддерживаются только изображения, аудио и видео. Для этого файла разрешите скачивание.'; return false; }
      if (!await enqueueAttachment(file, peer, activeChat, rule ? { ephemeral: { ...rule }, allowForwardAttribution: false } : undefined)) return false;
    }
    return true;
  } finally { attachingFiles = false; }
}

async function enqueueAttachment(file: File, peer: string, activeChat: ChatService, extra?: MessageDetails): Promise<boolean> {
  try {
    if (extra?.ephemeral && !extra.ephemeral.allowDownload && !/^(image\/(png|jpeg|webp|gif|avif)|audio\/|video\/)/.test(file.type)) throw new Error('Без скачивания пока поддерживаются только изображения, аудио и видео.');
    const source = new Uint8Array(await file.arrayBuffer());
    const cleaned = cleanImageMetadataEnabled ? await preparePrivateImage(source, file.type, file.name) : { bytes: source, mime: file.type, name: file.name };
    const bytes = cleaned.bytes;
    if (bytes !== source) source.fill(0);
    if (chat !== activeChat || sessionChats.byPeer[peer]?.contact !== 'accepted') return false;
    const details: MessageDetails = extra ?? { allowForwardAttribution, ...(replyDrafts[peer] ? { reply: replyDrafts[peer] } : {}) };
    if (!details.media && await hasTransparentPixels(bytes,cleaned.mime)) details.media={kind:'sticker'};
    if (chat !== activeChat || sessionChats.byPeer[peer]?.contact !== 'accepted') return false;
    const id = crypto.randomUUID();
    const offer: FileOffer = { id, name: safeFileName(cleaned.name), size: bytes.length,
      mime: cleaned.mime.slice(0, 100), sha256: await sha256Hex(bytes),
      details };
    if (chat !== activeChat || sessionChats.byPeer[peer]?.contact !== 'accepted') return false;
    const fileAccountId = address;
    const fileWasTrusted = trustedSession;
    await storeFileBytes(peer, id, bytes);
    if (chat !== activeChat || sessionChats.byPeer[peer]?.contact !== 'accepted') {
      if (fileWasTrusted) void deleteLocalFileData(fileAccountId, fileTransferKey(peer, id)).catch(() => {});
      else sessionFiles.delete(fileTransferKey(peer, id));
      return false;
    }
    const previousChats = sessionChats;
    sessionChats = recordSentMessage(sessionChats, peer, { id, text: '', from: address,
      timestamp: Date.now(), direction: 'outgoing', details: offer.details, file: offer,
      delivery: peer === address ? 'delivered' : 'queued',
      fileStatus: peer === address ? 'ready' : 'queued', fileProgress: peer === address ? bytes.length : 0 });
    if (!await persistLocalChats()) {
      if (chat === activeChat) sessionChats = previousChats;
      if (fileWasTrusted) await deleteLocalFileData(fileAccountId, fileTransferKey(peer, id));
      else sessionFiles.delete(fileTransferKey(peer, id));
      throw new Error('Не удалось сохранить файл и историю.');
    }
    if (!extra) { const nextReplies = { ...replyDrafts }; delete nextReplies[peer]; replyDrafts = nextReplies; }
    if (peer === address) return true;
    courierDelivery?.wake();
    if (sessionChats.byPeer[peer]?.connection === 'connected') void offerFile(peer, id, activeChat);
    else void activeChat.connect(peer).catch(() => {});
    return true;
  } catch (e) {
    if (chat === activeChat) status = e instanceof Error ? e.message : 'Не удалось добавить файл.';
    return false;
  }
}

function receiveWaitingFiles(): void {
  if (!chat || profileSwitchBusy || endingSession || switchingTrust || memoryBusy || panicBusy || !autoReceiveFilesEnabled || (trustedSession && !chatStoreKey)) return;
  // Accepted contacts only; two simultaneous receives and 100 MiB per unlocked
  // session. Failed/rejected/deleted offers are never automatically retried.
  const courierReceiving = courierState.incomingFiles.filter(r => sessionChats.byPeer[r.job.body.from]?.messages.some(m => m.id === r.job.body.id && m.fileAccepted && m.fileStatus !== 'ready')).length;
  for (const offer of automaticFileOffers(sessionChats, incomingFiles.size + courierReceiving, MAX_AUTO_FILE_BYTES - automaticFileBytes, autoReceiveFilesEnabled)) {
    automaticFileBytes += offer.size;
    void acceptFile(offer.peer, offer.id);
  }
}

$effect(() => {
  const enabled = autoReceiveFilesEnabled;
  // Changes in offered/ready states wake the bounded receive queue.
  const pending = sessionChats.order.some(peer => sessionChats.byPeer[peer].messages.some(entry =>
    entry.direction === 'incoming' && entry.fileStatus === 'offered' && !entry.fileAccepted));
  if (pending && enabled) receiveWaitingFiles();
});

async function offerFile(peer: string, id: string, activeChat: ChatService): Promise<void> {
  const entry = sessionChats.byPeer[peer]?.messages.find((message) => message.id === id && message.direction === 'outgoing');
  if (!entry?.file || chat !== activeChat || sessionChats.byPeer[peer]?.contact !== 'accepted' ||
    sessionChats.byPeer[peer]?.connection !== 'connected') return;
  try {
    await activeChat.sendFileOffer(entry.file, peer);
    if (chat !== activeChat) return;
    const latest = sessionChats.byPeer[peer]?.messages.find((message) => message.id === id);
    if (latest?.fileStatus === 'ready' || latest?.fileStatus === 'rejected' || latest?.fileStatus === 'canceled') return;
    updateFileEntry(peer, id, { fileStatus: 'offered', fileProgress: 0 });
    void persistLocalChats();
    scheduleFileRetry(peer, id, activeChat);
  } catch (e) {

    updateFileEntry(peer, id, { fileStatus: 'queued' });
    void persistLocalChats();
  }
}

function clearFileRetry(peer: string, id: string): void {
  const key = fileTransferKey(peer, id);
  clearTimeout(fileRetryTimers.get(key));
  fileRetryTimers.delete(key);
  fileRetryAttempts.delete(key);
}

function scheduleFileRetry(peer: string, id: string, activeChat: ChatService): void {
  const key = fileTransferKey(peer, id);
  clearTimeout(fileRetryTimers.get(key));
  const attempt = (fileRetryAttempts.get(key) ?? 0) + 1;
  fileRetryAttempts.set(key, attempt);
  fileRetryTimers.set(key, setTimeout(() => {
    fileRetryTimers.delete(key);
    const entry = sessionChats.byPeer[peer]?.messages.find((message) => message.id === id);
    if (chat !== activeChat || !entry?.file || entry.fileStatus === 'ready' || entry.fileStatus === 'rejected' ||
      entry.fileStatus === 'canceled' || sessionChats.byPeer[peer]?.connection !== 'connected') return;
    if (sendingFiles.has(key)) { scheduleFileRetry(peer, id, activeChat); return; }
    void offerFile(peer, id, activeChat);
  }, Math.min(15_000 * 2 ** Math.min(attempt - 1, 3), 120_000)));
}

async function acceptFile(peer: string, id: string): Promise<void> {
  const entry = sessionChats.byPeer[peer]?.messages.find((message) => message.id === id && message.direction === 'incoming');
  if (!entry?.file || entry.fileDeleted || !chat || memoryBusy || panicBusy || sessionChats.byPeer[peer]?.contact !== 'accepted') return;
  if (courierState.incomingFiles.some(r => r.job.body.id === id && r.job.body.from === peer)) {
    const receiving = courierState.incomingFiles.filter(r => r.job.body.id !== id && sessionChats.byPeer[r.job.body.from]?.messages.some(m => m.id === r.job.body.id && m.fileAccepted && m.fileStatus !== 'ready')).length;
    if (receiving + incomingFiles.size >= 2) { status = 'Одновременно можно получать не более двух файлов.'; return; }
    updateFileEntry(peer, id, { fileAccepted: true, fileStatus: 'receiving' });
    if (await persistLocalChats()) courierDelivery?.wake(); else updateFileEntry(peer, id, { fileAccepted: false, fileStatus: 'offered' });
    return;
  }
  if (!incomingFiles.has(fileTransferKey(peer, id)) && incomingFiles.size >= 2) {
    status = 'Одновременно можно получать не более двух файлов.';
    return;
  }
  const activeChat = chat;
  const key = fileTransferKey(peer, id);
  // A repeated offer/accept must not reset an in-flight reassembly buffer.
  if (entry.fileStatus === 'receiving' && incomingFiles.has(key)) return;
  incomingFiles.set(key, new FileReceiver(entry.file.size));
  updateFileEntry(peer, id, { fileAccepted: true, fileStatus: 'receiving', fileProgress: 0 });
  if (!await persistLocalChats()) { incomingFiles.delete(key); updateFileEntry(peer, id, { fileAccepted: false, fileStatus: 'offered' }); return; }
  if (chat !== activeChat) return;
  try {
    if (entry.file.size === 0) {
      if (await sha256Hex(new Uint8Array()) !== entry.file.sha256) throw new Error('file_hash_mismatch');
      await storeFileBytes(peer, id, new Uint8Array());
      incomingFiles.delete(key);
      updateFileEntry(peer, id, { fileStatus: 'ready' });
      if (await persistLocalChats()) await activeChat.sendFileControl('received', id, peer);
      else updateFileEntry(peer, id, { fileStatus: 'failed' });
    } else await activeChat.sendFileControl('accept', id, peer);
  } catch (e) {

    incomingFiles.delete(key);
    if (chat === activeChat) {
      updateFileEntry(peer, id, { fileStatus: 'failed', fileProgress: 0,
        fileAccepted: e instanceof Error && e.message === 'file_hash_mismatch' ? false : true });
      void persistLocalChats();
    }
  }
}

async function rejectFile(peer: string, id: string): Promise<void> {
  incomingFiles.delete(fileTransferKey(peer, id));
  updateFileEntry(peer, id, { fileAccepted: false, fileStatus: 'rejected' });
  await persistLocalChats();
  if (chat) void chat.sendFileControl('reject', id, peer).catch(() => {});
}

let queueOverviewOpen=$state(false);
const queueChats=$derived(sessionChats.order.filter(peer=>!!sessionChats.byPeer[peer]).map(peer=>({
  peer,name:contactName(peer),groups:nodeInteractionGroups(sessionChats.byPeer[peer].messages,
    new Set(courierState.pending.filter(j=>j.body.to===peer).map(j=>j.body.id)))
})));
const queueTotals=$derived(nodeInteractionCounts(queueChats));
const remoteQueue=$derived(courierStatus.connection==='connected'&&freshQueueSnapshot(courierStatus.queue,keyBudgetNow)?courierStatus.queue:undefined);
const quotaAlert=$derived(remoteQueue?.quota&&queueQuotaFull(remoteQueue.quota)?{count:messageQuotaFull(remoteQueue.quota)?remoteQueue.quota.profileMessages??0:remoteQueue.quota.profileFiles,label:queueQuotaLabel(remoteQueue.quota)}:undefined);
const headerQueue=$derived({quota:quotaAlert,stored:remoteQueue?.messages??queueTotals.waiting,transmitting:queueTotals.transmitting,
  retrying:queueTotals.retrying+cleanupWaiting(courierStatus.cleanup),stopped:queueTotals.stopped,expired:queueTotals.expired,
  errors:queueTotals.errors+cleanupErrors(courierStatus.cleanup),canceling:queueTotals.canceling});
function recordNodeOutcome(peer:string,id:string,value:'canceling'|'canceled'|'expired') {
  const m=sessionChats.byPeer[peer]?.messages.find(m=>m.id===id);
  if(!m||['delivered','read'].includes(m.delivery??''))return;
  sessionChats=updateConversation(sessionChats,peer,c=>({...c,messages:c.messages.map(m=>m.id===id?applyNodeOutcome(m,value):m)}));
  clearFileRetry(peer,id);outbox.acknowledge(peer,id);
}
async function cancelNodeMessage(peer:string,id:string) {
  if(navigationBusy())return;
  recordNodeOutcome(peer,id,'canceling');
  if(!await persistLocalChats()){status='Не удалось сохранить отмену. Не закрывайте приложение.';return;}
  try { await courierDelivery?.cancel(id); }
  catch { status='Отмена сохранена. Нода подтвердит удаление при восстановлении связи.';courierDelivery?.wake(); }
}
async function clearQueueCounters(peer?:string) {
  if(navigationBusy())return;const generation=authGeneration;
  sessionChats={...sessionChats,byPeer:Object.fromEntries(Object.entries(sessionChats.byPeer).map(([id,c])=>[id,!peer||id===peer?{...c,messages:dismissQueueNotices(c.messages)}:c]))};
  if(!await persistLocalChats()&&generation===authGeneration)status='Не удалось сохранить очистку счётчиков. После перезапуска они могут появиться снова.';
}
async function retryNodeMessage(peer:string,id:string) {
  const m=sessionChats.byPeer[peer]?.messages.find(m=>m.id===id),activeChat=chat,generation=authGeneration;
  if(!m||!['canceled','expired'].includes(m.nodeQueue??'')||actionBusy||!activeChat||navigationBusy())return;
  actionBusy=true;
  try {
    // New message, envelope and one-time key. Never reuse a canceled reservation.
    if(m.file){
      const bytes=(await getFileBytes(peer,id))?.slice();
      if(!bytes)throw Error('Локальный файл отсутствует. Выберите его снова.');
      try { if(bytes.length!==m.file.size||await sha256Hex(bytes)!==m.file.sha256)throw Error('Локальный файл повреждён. Выберите его снова.');
        if(generation!==authGeneration) return;
        if(!await enqueueAttachment(new File([bytes as BlobPart],m.file.name,{type:m.file.mime}),peer,activeChat,m.details))throw Error('Не удалось повторить отправку.');
      }finally{bytes.fill(0);}
    } else await queueRichMessage(peer,m.text,m.details??{});
    if(generation!==authGeneration)return;
    sessionChats=updateConversation(sessionChats,peer,c=>({...c,messages:c.messages.map(m=>m.id===id?{...m,nodeQueueDismissed:true}:m)}));await persistLocalChats();
  }catch(error){if(generation===authGeneration)status=error instanceof Error?error.message:'Не удалось повторить отправку.';}
  finally{if(generation===authGeneration)actionBusy=false;}
}
async function openQueueMessage(peer:string,id:string) {
  const generation=authGeneration;queueOverviewOpen=false;changeAccountView('chats');void openConversation(peer);await tick();
  requestAnimationFrame(()=>{if(generation===authGeneration&&sessionChats.activePeer===peer)jumpToMessage(id);});
}
async function cancelFile(peer: string, id: string): Promise<void> {
  const entry = sessionChats.byPeer[peer]?.messages.find(message => message.id === id);
  if (!entry?.file || entry.nodeQueue || entry.fileStatus === 'ready' || ['delivered', 'read'].includes(entry.delivery ?? '')) return;
  clearFileRetry(peer, id);
  incomingFiles.delete(fileTransferKey(peer, id));
  updateFileEntry(peer, id, { fileStatus: 'canceled', fileProgress: 0, fileAccepted: false });
  await persistLocalChats();
  if (entry.direction === 'outgoing' && courierState.pending.some(j=>j.body.id===id)) await cancelNodeMessage(peer,id);
  if (chat) void chat.sendFileControl('cancel', id, peer).catch(() => {});
}

async function sendFileData(peer: string, id: string, activeChat: ChatService): Promise<void> {
  const key = fileTransferKey(peer, id);
  if (sendingFiles.has(key)) return;
  if (sendingFiles.size >= 2) { scheduleFileRetry(peer, id, activeChat); return; }
  const entry = sessionChats.byPeer[peer]?.messages.find((message) => message.id === id && message.direction === 'outgoing');
  if (!entry?.file || entry.nodeQueue || entry.fileStatus === 'ready' || chat !== activeChat) return;
  sendingFiles.add(key);
  try {
    const bytes = await getFileBytes(peer, id);
    if (!bytes || bytes.length !== entry.file.size || await sha256Hex(bytes) !== entry.file.sha256)
      throw new Error('Файл больше не доступен в этом браузере.');
    updateFileEntry(peer, id, { fileStatus: 'sending', fileProgress: 0 });
    for (let offset = 0, index = 0; offset < bytes.length; offset += FILE_CHUNK_BYTES, index++) {
      if (chat !== activeChat || sessionChats.byPeer[peer]?.connection !== 'connected' ||
        sessionChats.byPeer[peer]?.contact !== 'accepted' ||
        sessionChats.byPeer[peer]?.messages.find((message) => message.id === id)?.fileStatus === 'canceled')
        throw new Error('Передача прервана.');
      await activeChat.sendFileChunk(id, index, bytes.subarray(offset, offset + FILE_CHUNK_BYTES), peer);
      if (index % 8 === 0 || offset + FILE_CHUNK_BYTES >= bytes.length)
        updateFileEntry(peer, id, { fileProgress: Math.min(offset + FILE_CHUNK_BYTES, bytes.length) });
    }
    // An empty file has no chunks; the receiver completes it on acceptance.
    if (chat === activeChat && sessionChats.byPeer[peer]?.messages.find((message) => message.id === id)?.fileStatus !== 'ready') {
      updateFileEntry(peer, id, { fileStatus: 'offered' }); void persistLocalChats();
    }
  } catch (e) {

    if (chat === activeChat && sessionChats.byPeer[peer]?.messages.find((message) => message.id === id)?.fileStatus !== 'canceled') {
      updateFileEntry(peer, id, { fileStatus: 'failed', fileProgress: 0 });
      void persistLocalChats();
    }
  } finally { sendingFiles.delete(key); }
}

async function receiveFileChunk(peer: string, id: string, index: number, chunk: Uint8Array, activeChat: ChatService): Promise<void> {
  if (chat !== activeChat || sessionChats.byPeer[peer]?.contact !== 'accepted') return;
  const entry = sessionChats.byPeer[peer].messages.find((message) => message.id === id && message.direction === 'incoming');
  const transfer = incomingFiles.get(fileTransferKey(peer, id));
  if (!entry?.file || !transfer || entry.fileStatus !== 'receiving') return;
  const stillReceiving = () => chat === activeChat && sessionChats.byPeer[peer]?.contact === 'accepted' &&
    sessionChats.byPeer[peer]?.messages.some(message => message.id === id && message.fileStatus === 'receiving' && !message.fileDeleted);
  try { transfer.append(index, chunk); }
  catch {
    incomingFiles.delete(fileTransferKey(peer, id));
    updateFileEntry(peer, id, { fileStatus: 'failed', fileProgress: 0, fileAccepted: false });
    void persistLocalChats();
    void activeChat.sendFileControl('cancel', id, peer).catch(() => {});
    return;
  }
  if (transfer.nextIndex % 8 === 0 || transfer.received === entry.file.size)
    updateFileEntry(peer, id, { fileProgress: transfer.received });
  if (transfer.received !== entry.file.size) return;
  incomingFiles.delete(fileTransferKey(peer, id));
  const digest = await sha256Hex(transfer.bytes);
  if (!stillReceiving()) return;
  if (digest !== entry.file.sha256) {
    updateFileEntry(peer, id, { fileStatus: 'failed', fileProgress: 0, fileAccepted: false });
    void persistLocalChats();
    void activeChat.sendFileControl('cancel', id, peer).catch(() => {});
    return;
  }
  if (!stillReceiving()) return;
  try {
    await storeFileBytes(peer, id, transfer.bytes);
    if (!stillReceiving()) return;
    updateFileEntry(peer, id, { fileStatus: 'ready', fileProgress: transfer.received });
    if (await persistLocalChats()) await activeChat.sendFileControl('received', id, peer);
    else updateFileEntry(peer, id, { fileStatus: 'failed', fileProgress: 0 });
  } catch (e) {

    if (stillReceiving()) {
      updateFileEntry(peer, id, { fileStatus: 'failed', fileProgress: 0 });
      void persistLocalChats();
    }
  }
}

async function downloadFile(peer: string, id: string): Promise<boolean> {
  const generation = authGeneration;
  const entry = sessionChats.byPeer[peer]?.messages.find((message) => message.id === id);
  if (entry?.details?.ephemeral) return false;
  if (!entry?.file || entry.fileDeleted || (entry.direction === 'incoming' && entry.fileStatus !== 'ready')) return false;
  try {
    const bytes = await getFileBytes(peer, id);
    if (!bytes || bytes.length !== entry.file.size || await sha256Hex(bytes) !== entry.file.sha256)
      throw new Error('Сохранённый файл не найден или повреждён.');
    if (generation !== authGeneration || screen !== 'account' || sessionChats.byPeer[peer]?.messages.find(message => message.id === id)?.fileDeleted) return false;
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = entry.file.name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return true;
  } catch (e) { if (generation === authGeneration) status = e instanceof Error ? e.message : 'Не удалось скачать файл.'; return false; }
}

function receiptKey(peer: string, messageId: string): string {
  return `${peer}:${messageId}`;
}

function flushOutbox(peer: string, sendingChat: ChatService): Promise<void> {
  return outbox.flush(peer, sendingChat);
}

async function openConversation(peer: string) {
  if (ephemeralOpening || actionBusy) return;
  // Keep an unconfirmed recording with its original chat.
  if (voiceBusy && sessionChats.activePeer !== peer) return;
  ordinaryUnreadBoundary=sessionChats.byPeer[peer]?.unread?firstUnreadMessageId(sessionChats.byPeer[peer].messages)??'':'';
  nativeOpen=false;
  selecting = false; selectedMessages = []; attachmentMenu = false; chatSearchOpen = false; emojiOpen = false; sendOptionsOpen = false; closeEphemeral();
  messageTools = null;
  mobilePane = 'chat';
  if (sessionChats.activePeer !== peer) clearMediaPreview();
  const isNew = !sessionChats.byPeer[peer];
  sessionChats = selectConversation(sessionChats, peer);
  chatOpenToken += 1;
  aliasDraft = aliases[peer] ?? '';
  if (isNew) persistLocalChats();
  if (peer === address) { sessionChats = savedConversation(sessionChats, address); return; }
  if (!chat || sessionChats.byPeer[peer].connection !== 'offline') return;
  const connectingChat = chat;

  sessionChats = updateConversation(sessionChats, peer, (current) => ({
    ...current,
    connection: 'connecting',
    error: '',
  }));
  try {
    await connectingChat.connect(peer);
    setTimeout(() => {
      if (chat !== connectingChat || sessionChats.byPeer[peer]?.connection !== 'connecting') return;
      sessionChats = updateConversation(sessionChats, peer, (current) => ({
        ...current,
        connection: 'offline',
        error: current.messages.some((message) => message.delivery === 'queued' || message.delivery === 'sent')
          ? 'Сообщения ждут появления собеседника в сети.'
          : 'Собеседник не ответил. Выберите чат, чтобы повторить подключение.',
      }));
    }, 15_000);
  } catch (e) {
    if (chat !== connectingChat) return;
    sessionChats = updateConversation(sessionChats, peer, (current) => ({
      ...current,
      connection: 'offline',
      error: e instanceof Error ? e.message : 'Не удалось подключиться',
    }));
  }
}

async function addConversation(peer: string, signalingUrl?: string) {
  if (screen !== 'account' || accountView !== 'chats' || endingSession || switchingTrust) return;
  peer = peer.trim();
  if (!isValidAccountId(peer)) {
    status = 'Проверьте адрес собеседника';
    return;
  }
  if (signalingUrl && !nodeRows.some(node => node.url === signalingUrl && node.enabled)) {
    pendingContactRoute = { peer, url: signalingUrl, owner: address };
    return;
  }
  if (peer === address) {
    sessionChats = savedConversation(sessionChats, address);
  }
  status = '';
  chatSearch = '';
  await openConversation(peer);
}

async function acceptContactRoute(): Promise<void> {
  const request = pendingContactRoute, generation = authGeneration;
  if (!request || request.owner !== address || networkBusy || endingSession) return;
  if (networkSettings.internetEnabled === false || networkSettings.signalingEnabled === false) {
    status = 'Связь через интернет-серверы выключена. Включите её в настройках сети или откройте контакт без добавления сервера.';
    return;
  }
  try {
    await addNodeSignaling(request.url);
    if (generation !== authGeneration || pendingContactRoute !== request) return;
    pendingContactRoute = null;
    await addConversation(request.peer);
  } catch {
    if (generation === authGeneration) status = 'Не удалось добавить сервер из ссылки. Проверьте настройки сети и доступное место в списке серверов.';
  }
}

function setDraft(peer: string, draft: string) {
  sessionChats = updateConversation(sessionChats, peer, (current) => ({
    ...current,
    draft,
  }));
}

function startReply(message: ChatEntry): void {
  replyDrafts = { ...replyDrafts, [sessionChats.activePeer]: replyReference(message) };
  document.querySelector<HTMLTextAreaElement>('textarea[data-message-composer]')?.focus();
}
function cancelReply(): void {
  const next = { ...replyDrafts }; delete next[sessionChats.activePeer]; replyDrafts = next;
}
function jumpToMessage(id: string): void {
  const node = [...document.querySelectorAll<HTMLElement>('[data-chat-message-id]')].find(item => item.dataset.chatMessageId === id);
  if (!node) { status = 'Исходное сообщение удалено или отсутствует на этом устройстве.'; return; }
  const scroll = node.closest<HTMLElement>('[data-chat-scroll]');
  if (scroll) scroll.scrollTo({ top:scroll.scrollTop + node.getBoundingClientRect().top - scroll.getBoundingClientRect().top - (scroll.clientHeight - node.offsetHeight) / 2, behavior:'smooth' });
  highlightedMessage = id;
  setTimeout(() => { if (highlightedMessage === id) highlightedMessage = ''; }, 1800);
}
function toggleMessage(id: string): void {
  if (!actionBusy) selectedMessages = toggleSelection(selectedMessages, id);
}
function openChatAction(mode: 'forward' | 'contact' | 'delete'): void {
  if (actionBusy || memoryBusy || switchingTrust || endingSession || attachingFiles || voiceBusy) return;
  if(mode==='forward'){
    const messages=sessionChats.byPeer[sessionChats.activePeer]?.messages.filter(m=>selectedMessages.includes(m.id))??[];
    if(messages.length&&messages.every(m=>!m.file&&!m.details?.ephemeral&&!m.details?.contactCard&&!m.details?.pin&&!m.localCall)){
      textForward={peer:sessionChats.activePeer,messages:messages.map(m=>({key:m.id,text:m.text,source:m.from===address?selfNickname:contactName(m.from)}))};attachmentMenu=false;return;
    }
  }
  actionPeer = sessionChats.activePeer; actionError = ''; actionMode = mode; attachmentMenu = false;
  forwardCompleted.clear();
}
function messageAction(message: ChatEntry, mode: 'forward' | 'delete' | 'select'): void {
  if (actionBusy || memoryBusy || switchingTrust || endingSession || attachingFiles || voiceBusy) return;
  selectedMessages = [message.id];
  if (mode === 'select') selecting = true;
  else openChatAction(mode);
}
async function copyMessage(message: ChatEntry): Promise<void> {
  if (message.details?.ephemeral) return;
  const generation = authGeneration; const peer = sessionChats.activePeer;
  const text = message.file ? message.file.name : message.details?.contactCard ? contactLink(message.details.contactCard.accountId) : message.text;
  try {
    await navigator.clipboard.writeText(text);
    if (generation !== authGeneration || peer !== sessionChats.activePeer || screen !== 'account') return;
    copiedMessageId = message.id;
    setTimeout(() => { if (copiedMessageId === message.id) copiedMessageId = ''; }, 1800);
  } catch { if (generation === authGeneration) status = 'Браузер не разрешил копирование. Можно выделить текст вручную.'; }
}
async function pinMessage(targetId: string | null): Promise<void> {
  const peer = sessionChats.activePeer; const generation = authGeneration;
  const conversation = sessionChats.byPeer[peer];
  if (navigationBusy() || attachingFiles || voiceBusy || conversation?.contact !== 'accepted' ||
    targetId && !conversation.messages.some(message => message.id === targetId && !message.details?.pin && !message.details?.ephemeral)) return;
  pinBusy = true;
  try {
    await queueRichMessage(peer, '', { pin: { targetId, revision: nextPinRevision(conversation.messages, address, peer) } });
    if (generation === authGeneration) status = peer === address ? 'Закрепление сохранено.' : 'Закрепление сохранено и отправляется собеседнику.';
  } catch (error) { if (generation === authGeneration) status = error instanceof Error ? error.message : 'Не удалось сохранить закрепление.'; }
  finally { if (generation === authGeneration) pinBusy = false; }
}
function downloadMessage(peer: string, message: ChatEntry): void {
  if (message.details?.ephemeral) return;
  if (message.file) void downloadFile(peer, message.id);
  else saveDownload(message.details?.contactCard ? contactLink(message.details.contactCard.accountId) : message.text, `Automesh-message-${message.id}.txt`);
}
async function prepareMessageFile(peer: string, id: string, requireActiveChat = true): Promise<File> {
  const generation = authGeneration;
  const entry = sessionChats.byPeer[peer]?.messages.find(message => message.id === id);
  if (entry?.details?.ephemeral) throw new Error('Исчезающее вложение доступно только в окне просмотра.');
  if (!entry?.file || entry.fileDeleted || entry.direction === 'incoming' && entry.fileStatus !== 'ready') throw new Error('Сначала получите файл целиком.');
  const bytes = await getFileBytes(peer, id);
  if (!bytes || bytes.length !== entry.file.size || await sha256Hex(bytes) !== entry.file.sha256) throw new Error('Файл отсутствует или повреждён.');
  if (generation !== authGeneration || screen !== 'account' || requireActiveChat && sessionChats.activePeer !== peer || !sessionChats.byPeer[peer]?.messages.some(message => message.id === id && !message.fileDeleted)) throw new Error('Сеанс или чат изменился.');
  return new File([bytes as BlobPart], entry.file.name, { type: entry.file.mime || 'application/octet-stream' });
}
function saveDownload(bytes: BlobPart, name: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
async function copySelection():Promise<void>{
  const peer=sessionChats.activePeer,generation=authGeneration;
  const messages=sessionChats.byPeer[peer]?.messages.filter(m=>selectedMessages.includes(m.id))??[];
  if(!messages.length||actionBusy||messages.some(m=>m.details?.ephemeral))return;
  actionBusy=true;try{await navigator.clipboard.writeText(messages.map(m=>m.file?.name||m.text).join('\n\n'));if(generation===authGeneration){selectedMessages=[];selecting=false;status='Текст скопирован.';}}
  catch{if(generation===authGeneration)status='Не удалось скопировать текст.';}finally{if(generation===authGeneration)actionBusy=false;}
}
async function downloadSelection(): Promise<void> {
  const peer = sessionChats.activePeer; const generation = authGeneration;
  const messages = sessionChats.byPeer[peer]?.messages.filter(message => selectedMessages.includes(message.id)) ?? [];
  if (!messages.length || actionBusy) return;
  if (messages.some(message => message.details?.ephemeral)) { status = 'Исчезающие сообщения скачиваются только из окна просмотра, если это разрешил автор. Уберите их из выбора.'; return; }
  actionBusy = true;
  try {
    // Validate the ENTIRE selection before starting any browser downloads.
    for (const message of messages) if (message.file) await prepareMessageFile(peer, message.id);
    if (generation !== authGeneration || peer !== sessionChats.activePeer) return;
    saveDownload(transcript(messages), `Automesh-messages-${new Date().toISOString().slice(0, 10)}.txt`);
    for (const message of messages) if (message.file && !await downloadFile(peer,message.id)) throw new Error('Не все файлы удалось подготовить к скачиванию. Выбор сохранён.');
    selectedMessages = []; selecting = false;
    status = 'Файлы переданы браузеру для скачивания. Сохранение на диск управляется браузером.';
  } catch (error) { if (generation === authGeneration) status = error instanceof Error ? error.message : 'Не удалось подготовить скачивание. Выбор сохранён.'; }
  finally { if (generation === authGeneration) actionBusy = false; }
}
async function queueRichMessage(peer: string, text: string, details: MessageDetails): Promise<void> {
  const generation = authGeneration; const sendingChat = chat;
  const conversation = sessionChats.byPeer[peer];
  if (!conversation || (conversation.contact !== 'new' && conversation.contact !== 'accepted')) throw new Error('Сначала дождитесь принятия запроса или разблокируйте контакт.');
  if (!textFitsLimit(encodeChatContent(text, details), conversation.contact === 'new')) throw new Error('Сообщение слишком длинное для этого чата.');
  const id = crypto.randomUUID();
  sessionChats = recordSentMessage(sessionChats, peer, { id, text, details, from: address, timestamp: Date.now(), direction: 'outgoing', delivery: peer === address ? 'delivered' : 'queued' });
  if (!await persistLocalChats()) {
    if (generation === authGeneration) sessionChats = updateConversation(sessionChats, peer, current => ({ ...current, messages: current.messages.filter(message => message.id !== id) }));
    throw new Error('Не удалось сохранить сообщение.');
  }
  if (generation !== authGeneration) throw new Error('Сеанс завершён.');
  if (peer !== address && sendingChat && sendingChat === chat) {
    courierDelivery?.wake();
    if (sessionChats.byPeer[peer].connection === 'connected') void flushOutbox(peer, sendingChat);
    else void sendingChat.connect(peer).catch(() => {});
  }
}
const forwardCompleted = new Set<string>();
async function confirmChatAction(targets: string[]): Promise<void> {
  const mode = actionMode; const peer = actionPeer; const generation = authGeneration;
  if (!mode || actionBusy || screen !== 'account' || endingSession || switchingTrust || memoryBusy) return;
  actionBusy = true; actionError = '';
  try {
    if (mode === 'contact') {
      const id = targets[0]; if (!sessionChats.byPeer[id]) throw new Error('Контакт не найден.');
      await queueRichMessage(peer, '', { contactCard: { accountId: id, nickname: id === address ? selfNickname : declaredNames[id] ?? '' },
        allowForwardAttribution, ...(replyDrafts[peer] ? { reply: replyDrafts[peer] } : {}) });
      if (generation === authGeneration) cancelReply();
    } else if (mode === 'delete') {
      await deleteSelectedMessages(peer, [...selectedMessages], generation);
    } else {
      const messages = sessionChats.byPeer[peer]?.messages.filter(message => selectedMessages.includes(message.id)) ?? [];
      const destinations = [...new Set(targets)];
      if (!messages.length || !destinations.length || destinations.length > 20) throw new Error('Выберите сообщения и до 20 чатов.');
      for (const target of destinations) {
        const remaining = messages.filter(message => !forwardCompleted.has(`${target}:${message.id}`));
        if (!remaining.length) continue;
        const conversation = sessionChats.byPeer[target];
        if (!conversation || !['new', 'accepted'].includes(conversation.contact)) throw new Error('Выбран чат с непринятым запросом или блокировкой.');
        if (conversation.contact === 'new' && (messages.length > 1 || messages.some(message => message.file))) throw new Error('Новому контакту можно переслать одно текстовое сообщение. Для файлов сначала нужен принятый запрос.');
        const files = remaining.filter(message => message.file);
        const pending = conversation.messages.filter(message => message.direction === 'outgoing' && message.file && !['ready', 'canceled', 'rejected'].includes(message.fileStatus ?? '')).length;
        const error = validateAttachmentBatch(files.map(message => ({ size: message.file!.size })), pending);
        if (error) throw new Error(error);
      }
      for (const target of destinations) for (const message of messages) {
        if (generation !== authGeneration) return;
        const key = `${target}:${message.id}`; if (forwardCompleted.has(key)) continue;
        const author = { accountId: message.from, nickname: message.from === address ? selfNickname : declaredNames[message.from] ?? '' };
        const details = forwardingDetails(message, author, allowForwardAttribution, address);
        if (message.file) {
          if (message.fileDeleted || (message.direction === 'incoming' && message.fileStatus !== 'ready')) throw new Error('Для пересылки сначала получите файл; удалённый файл переслать нельзя.');
          const bytes = await getFileBytes(peer, message.id);
          if (generation !== authGeneration) return;
          if (!bytes || bytes.length !== message.file.size || await sha256Hex(bytes) !== message.file.sha256) throw new Error('Исходный файл отсутствует или повреждён.');
          if (generation !== authGeneration || !chat) return;
          if (!await enqueueAttachment(new File([bytes as BlobPart], message.file.name, { type: message.file.mime }), target, chat, details)) throw new Error('Не удалось добавить файл в очередь.');
        } else await queueRichMessage(target, message.text, details);
        if (generation !== authGeneration) return;
        forwardCompleted.add(key);
        sessionChats = updateConversation(sessionChats, peer, conversation => ({ ...conversation, messages: conversation.messages.map(entry => entry.id === message.id
          ? { ...entry, forwardedTo: [...new Set([...(entry.forwardedTo ?? []), target])] } : entry) }));
        if (!await persistLocalChats()) throw new Error('Сообщение добавлено в очередь, но счётчик не сохранён.');
      }
    }
    if (generation === authGeneration) { actionMode = null; selecting = false; selectedMessages = []; status = mode === 'forward' ? 'Переслано или добавлено в очередь доставки.' : mode === 'delete' ? 'Сообщения удалены только у вас.' : 'Контакт добавлен в сообщение.'; }
  } catch (error) {
    if (generation === authGeneration) actionError = (error instanceof Error ? error.message : 'Не удалось выполнить действие.') +
      (forwardCompleted.size ? ' Уже добавленные сообщения не откатываются; повтор продолжит оставшиеся.' : '');
  } finally { if (generation === authGeneration) actionBusy = false; }
}
async function deleteSelectedMessages(peer: string, ids: string[], generation: number): Promise<void> {
  if (!ids.length) return;
  memoryBusy = true; const activeChat = chat; chat = null; const previous = sessionChats;
  const previousOffline = offlineDeliveryState; const previousCourier = courierState; const stoppingOffline = stopOfflineDelivery();
  try {
    await activeChat?.disconnect(); if (generation !== authGeneration) return;
    await stoppingOffline;
    pauseFileTransfers(); await historyWrites.settled(); await Promise.allSettled([...pendingFileWrites]);
    if (generation !== authGeneration) return;
    const fileIds = ids.filter(id => previous.byPeer[peer]?.messages.some(message => message.id === id && message.file)).map(id => fileTransferKey(peer, id));
    for (const r of courierState.incomingFiles) if (r.job.body.from === peer && ids.includes(r.job.body.id)) {
      for (let i = 0; i < r.manifest.attachment.chunks; i++) fileIds.push(fileTransferKey(peer, `${r.job.body.id}:courier:${i}`));
    }
    sessionChats = removeMessages(sessionChats, peer, ids);
    offlineDeliveryState = { ...offlineDeliveryState, pending: offlineDeliveryState.pending.filter(mail => mail.peer !== peer || !ids.includes(mail.messageId)) };
    courierState = pruneCourierFiles(courierState, (p, id) => p === peer && ids.includes(id));
    if (!chatStoreKey) throw new Error('История недоступна.');
    if (trustedSession) await saveChatDataWithFileDeletion(chatStoreKey, address, chatSnapshot(), fileIds);
    else {
      const baseline = await loadLocalChatData(chatStoreKey, address); if (generation !== authGeneration) return;
      if (baseline) {
        const restored = restoreChats(baseline.chats);
        const cleaned = baseline.chats.byPeer[peer] ? removeMessages(restored, peer, ids) : restored;
        await saveChatDataWithFileDeletion(chatStoreKey, address, { ...baseline, chats: saveChats(cleaned) }, fileIds);
      } else await deleteLocalFiles(address, fileIds);
    }
    if (generation !== authGeneration) return;
    for (const id of fileIds) { sessionFiles.get(id)?.fill(0); sessionFiles.delete(id); }
    if (replyDrafts[peer] && ids.includes(replyDrafts[peer].id)) { const next = { ...replyDrafts }; delete next[peer]; replyDrafts = next; }
  } catch (error) { if (generation === authGeneration) { sessionChats = previous; offlineDeliveryState = previousOffline; courierState = previousCourier; } throw error; }
  finally { memoryBusy = false; if (generation === authGeneration && screen === 'account' && identity) await initializeChat(); }
}
async function saveForwardPrivacy(enabled: boolean): Promise<void> {
  const generation = authGeneration;
  const previous = allowForwardAttribution; allowForwardAttribution = enabled;
  if (!await persistLocalChats() && generation === authGeneration) { allowForwardAttribution = previous; status = 'Не удалось сохранить настройку.'; }
}

function clearPendingReads(peer: string): void {
  sessionChats = updateConversation(sessionChats, peer, (conversation) => {
    const messages = conversation.messages.map((message) =>
      message.direction === 'incoming' && (message.readState === 'waiting' || message.readState === 'pending')
        ? { ...message, readState: 'skipped' as const } : message);
    return { ...conversation, messages, unread: unreadMessageCount(messages) };
  });
}

function scanVisibleMessages(): void {
  if (document.hidden || !document.hasFocus() || galleryId || allProfileChats || accountView !== 'chats' || (narrowScreen && mobilePane !== 'chat')) return;
  for (const item of visibleReadNodes.values()) {
    if (item.visible && sessionChats.activePeer === item.peer) void markVisibleRead(item.peer, item.messageId);
  }
}

async function markVisibleRead(peer: string, messageId: string): Promise<void> {
  if (document.hidden || !document.hasFocus() || galleryId || allProfileChats || accountView !== 'chats' || sessionChats.activePeer !== peer ||
    (narrowScreen && mobilePane !== 'chat')) return;
  const conversation = sessionChats.byPeer[peer];
  const message = conversation?.messages.find((entry) => entry.id === messageId && entry.direction === 'incoming');
  if (message?.details?.pin || message?.details?.ephemeralOpened || message?.details?.ephemeral) return;
  if ((conversation?.contact !== 'accepted' && conversation?.contact !== 'pending') || !message ||
    message.readState === 'sent' || message.readState === 'skipped' || message.readState === 'pending') return;

  const state = conversation.contact === 'pending' || message.file || !readReceiptsEnabled ||
    (peerReadConfirmed.has(peer) && peerReadPreferences[peer] === false)
    ? 'skipped' : peerReadConfirmed.has(peer) && peerReadPreferences[peer] === true ? 'pending' : 'waiting';
  if (message.readState === state) return;
  sessionChats = setReadState(sessionChats, peer, messageId, state);
  if (!await persistLocalChats()) return;
  if (state === 'pending' && chat) void flushReadReceipts(peer, chat);
}

function observeIncoming(node: HTMLElement, initial: { peer: string; messageId: string }) {
  let current = initial;
  const register = () => visibleReadNodes.set(receiptKey(current.peer, current.messageId), {
    peer: current.peer, messageId: current.messageId, visible: false,
  });
  register();
  const scrollRoot = node.closest<HTMLElement>('[data-chat-scroll]');
  const observer = new IntersectionObserver((entries) => {
    const item = visibleReadNodes.get(receiptKey(current.peer, current.messageId));
    if (!item) return;
    item.visible = entries.some((entry) => entry.isIntersecting &&
      entry.intersectionRect.height >= Math.min(entry.boundingClientRect.height * 0.5,
        (scrollRoot?.clientHeight ?? window.innerHeight) * 0.5));
    if (item.visible) void markVisibleRead(current.peer, current.messageId);
  }, { threshold: [0, 0.01, 0.05, 0.1, 0.25, 0.5] });
  observer.observe(node);
  return {
    update(next: { peer: string; messageId: string }) {
      if (next.peer === current.peer && next.messageId === current.messageId) return;
      observer.unobserve(node);
      visibleReadNodes.delete(receiptKey(current.peer, current.messageId));
      current = next;
      register();
      observer.observe(node);
    },
    destroy() {
      observer.disconnect();
      visibleReadNodes.delete(receiptKey(current.peer, current.messageId));
    },
  };
}

const manageChatScroll = createChatScroll({ activePeer: () => sessionChats.activePeer,
  firstUnread: peer => sessionChats.byPeer[peer]?.unread ? firstUnreadMessageId(sessionChats.byPeer[peer]?.messages ?? []) : undefined,
  onJump: visible => showJumpDown = visible });

function jumpToBottom(): void {
  const node = document.querySelector<HTMLElement>('[data-chat-scroll]');
  node?.scrollTo({ top: node.scrollHeight, behavior: 'smooth' });
}
function rememberComposerCaret(event: Event): void {
  const field = event.currentTarget as HTMLTextAreaElement;
  composerCaret = { peer: sessionChats.activePeer, start: field.selectionStart, end: field.selectionEnd };
}
function insertEmoji(value: string): void {
  const peer = sessionChats.activePeer, draft = sessionChats.byPeer[peer]?.draft ?? '';
  const { start, end } = composerCaret.peer === peer ? composerCaret : { start: draft.length, end: draft.length };
  setDraft(peer, draft.slice(0, start) + value + draft.slice(end));
  composerCaret = { peer, start: start + value.length, end: start + value.length };
  void tick().then(() => { const field = document.querySelector<HTMLTextAreaElement>('textarea[data-message-composer]'); field?.focus(); field?.setSelectionRange(composerCaret.start, composerCaret.end); });
}

function sendPress(node: HTMLButtonElement) {
  let timer: ReturnType<typeof setTimeout> | undefined, held = false, x = 0, y = 0;
  const stop = () => { clearTimeout(timer); };
  const down = (event: PointerEvent) => { if (event.button !== 0) return; held = false; x = event.clientX; y = event.clientY; timer = setTimeout(() => { held = true; sendOptionsOpen = true; }, 500); };
  const move = (event: PointerEvent) => { if (Math.hypot(event.clientX-x,event.clientY-y) > 12) stop(); };
  const click = (event: MouseEvent) => { const suppress = held; held = false; if (suppress) { event.preventDefault(); event.stopImmediatePropagation(); } };
  const keydown = (event: KeyboardEvent) => { if (event.key === 'Enter' || event.key === ' ') held = false; };
  node.addEventListener('pointerdown', down); node.addEventListener('pointermove', move); node.addEventListener('click', click, true); node.addEventListener('keydown',keydown);
  window.addEventListener('pointerup', stop); window.addEventListener('pointercancel', stop);
  return { destroy() { stop(); node.removeEventListener('pointerdown', down); node.removeEventListener('pointermove', move); node.removeEventListener('click', click, true); node.removeEventListener('keydown',keydown); window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop); } };
}
function closeEphemeral(): void {
  if (ephemeralView?.url) URL.revokeObjectURL(ephemeralView.url);
  ephemeralView?.bytes?.fill(0); ephemeralView = null;
}
async function openEphemeral(peer: string, id: string): Promise<void> {
  if (ephemeralOpening || ephemeralView || navigationBusy() || screen !== 'account' || accountView !== 'chats' || sessionChats.byPeer[peer]?.contact !== 'accepted') return;
  const message = sessionChats.byPeer[peer]?.messages.find(entry => entry.id === id);
  if (!message?.details?.ephemeral || ephemeralExpired(message, ephemeralState(message, sessionChats.byPeer[peer].messages))) return;
  if (message.file && (message.fileDeleted || message.direction === 'incoming' && message.fileStatus !== 'ready')) { status = 'Сначала получите файл целиком. Просмотр не израсходован.'; return; }
  const generation = authGeneration;
  ephemeralOpening = true;
  let bytes: Uint8Array | undefined;
  try {
    if (message.file) {
      const source = await getFileBytes(peer,id);
      if (!source || source.length !== message.file.size || await sha256Hex(source) !== message.file.sha256) throw new Error('Файл не получен целиком или повреждён. Просмотр не израсходован.');
      bytes = source.slice();
    }
    if (generation !== authGeneration || peer !== sessionChats.activePeer || screen !== 'account' || accountView !== 'chats' || navigationBusy() ||
      !sessionChats.byPeer[peer]?.messages.some(entry => entry.id === id && !ephemeralExpired(entry,ephemeralState(entry,sessionChats.byPeer[peer].messages)))) return;
    let firstViewedAt = message.ephemeralState?.firstViewedAt ?? Date.now();
    if (message.direction === 'incoming' || peer === address) {
      const previous = message.ephemeralState;
      const previousRead = message.readState;
      const next = nextEphemeralOpening(message); if (!next) return;
      firstViewedAt = next.firstViewedAt; const views = next.views;
      setEphemeralViewState(peer,id,next,'skipped');
      try { await queueRichMessage(peer,'',{ ephemeralOpened:{ targetId:id, viewedAt:firstViewedAt, views } }); }
      catch (error) { if (generation === authGeneration) setEphemeralViewState(peer,id,previous,previousRead); throw error; }
    } else firstViewedAt = ephemeralState(message,sessionChats.byPeer[peer].messages)?.firstViewedAt ?? 0;
    if (generation !== authGeneration || peer !== sessionChats.activePeer || screen !== 'account' || accountView !== 'chats' || document.hidden) return;
    const deadline = message.details.ephemeral.seconds && firstViewedAt ? firstViewedAt + message.details.ephemeral.seconds * 1000 : 0;
    if (deadline && deadline <= Date.now()) return;
    ephemeralView = { message:JSON.parse(JSON.stringify(message)), peer, account:address, deadline, ...(bytes ? { bytes, url:URL.createObjectURL(new Blob([bytes as BlobPart],{ type:message.file!.mime })) } : {}) };
    bytes = undefined;
  } catch (error) { if (generation === authGeneration) status = error instanceof Error ? error.message : 'Не удалось открыть сообщение.'; }
  finally { bytes?.fill(0); if (generation === authGeneration) ephemeralOpening = false; }
}
function setEphemeralViewState(peer: string, id: string, state: ChatEntry['ephemeralState'], readState: ChatEntry['readState']): void {
  sessionChats = updateConversation(sessionChats,peer,current => {
    const messages = current.messages.map(entry => entry.id === id ? { ...entry, ephemeralState:state, readState } : entry);
    return { ...current, messages, unread:unreadMessageCount(messages) };
  });
}
function downloadEphemeral(): void {
  const view = ephemeralView;
  if (!view || view.account !== address || screen !== 'account' || !view.message.details?.ephemeral?.allowDownload || view.deadline && Date.now() >= view.deadline) return;
  saveDownload((view.bytes ?? view.message.text) as BlobPart,view.message.file?.name ?? `Automesh-message-${view.message.id}.txt`);
}
async function purgeExpiredMessages(): Promise<void> {
  if (ephemeralView && (screen !== 'account' || accountView !== 'chats' || ephemeralView.account !== address || ephemeralView.peer !== sessionChats.activePeer || document.hidden || ephemeralView.deadline && Date.now() >= ephemeralView.deadline)) closeEphemeral();
  if (ephemeralPurging || screen !== 'account' || !chatStoreKey || endingSession || switchingTrust || memoryBusy || profileSwitchBusy) return;
  const generation = authGeneration;
  ephemeralPurging = true;
  try {
    const ids: string[] = [];
    for (const peer of sessionChats.order) {
      const messages = sessionChats.byPeer[peer].messages;
      const states = ephemeralStates(messages);
      const expired = messages.filter(message => message.details?.ephemeral && ephemeralExpired(message,states.get(message.id)) && !purgedEphemeral.has(`${generation}:${peer}:${message.id}`));
      if (!expired.length) continue;
      const keys = new Set(expired.map(message => message.id));
      sessionChats = updateConversation(sessionChats,peer,current => {
        const messages = current.messages.map(message => keys.has(message.id) ? expiredMessage({ ...message, ephemeralState:states.get(message.id) }) : message);
        return { ...current, deletedIds:[...new Set([...(current.deletedIds ?? []),...keys])], messages, unread:unreadMessageCount(messages) };
      });
      for (const message of expired) ids.push(fileTransferKey(peer,message.id));
      for (const partial of courierState.incomingFiles) if (partial.job.body.from === peer && keys.has(partial.job.body.id)) {
        for (let index = 0; index < partial.manifest.attachment.chunks; index++) ids.push(fileTransferKey(peer,`${partial.job.body.id}:courier:${index}`));
      }
      courierState = pruneCourierFiles(courierState,(p,id) => p === peer && keys.has(id));
    }
    if (!ids.length || !await persistLocalChats() || generation !== authGeneration) return;
    await deleteLocalFiles(address,ids);
    if (generation !== authGeneration) return;
    for (const id of ids) { sessionFiles.get(id)?.fill(0); sessionFiles.delete(id); purgedEphemeral.add(`${generation}:${id}`); }
  } catch { /* Keep tombstones hidden; retry durable cleanup on the next tick. */ }
  finally { ephemeralPurging = false; }
}

async function flushReadReceipts(peer: string, activeChat: ChatService): Promise<void> {
  const conversation = sessionChats.byPeer[peer];
  if (chat !== activeChat || conversation?.contact !== 'accepted' || conversation.connection !== 'connected' ||
    !readReceiptsEnabled || !peerReadConfirmed.has(peer) || peerReadPreferences[peer] !== true) return;
  for (const message of conversation.messages) {
    if (message.direction !== 'incoming' || message.readState !== 'pending') continue;
    const key = receiptKey(peer, message.id);
    if (readReceiptSending.has(key)) continue;
    readReceiptSending.add(key);
    try {
      await activeChat.sendReadReceipt(message.id, peer);
      if (chat === activeChat && sessionChats.byPeer[peer]?.messages.some((entry) =>
        entry.id === message.id && entry.readState === 'pending')) {
        sessionChats = setReadState(sessionChats, peer, message.id, 'sent');
        void persistLocalChats();
      }
    } catch (e) {

      break;
    } finally {
      readReceiptSending.delete(key);
    }
  }
}

async function acceptRequest(peer: string): Promise<void> {
  if (sessionChats.byPeer[peer]?.contact !== 'pending') return;
  const activeChat = chat;
  const accountId = address;
  const previous = sessionChats;
  sessionChats = setContactState(sessionChats, peer, 'accepted');
  if (!await persistLocalChats()) {
    if (address === accountId) sessionChats = previous;
    return;
  }
  if (chat === activeChat && address === accountId && activeChat) {
    if (sessionChats.byPeer[peer].connection === 'connected') {
      publishDeliveryKeys(peer);
      void activeChat.sendContactAccepted(peer).catch(() => {});
      void activeChat.sendReadPreference(readReceiptsEnabled, peer).catch(() => {});
      void activeChat.sendProfile(selfNickname, peer).catch(() => {});
      publishAvatar(activeChat, peer);
      void activeChat.sendProfileLinks(selfLinks, peer).catch(() => {});
    } else {
      void activeChat.connect(peer).catch(() => {});
    }
  }
}

async function blockRequest(peer: string): Promise<void> {
  if (sessionChats.byPeer[peer]?.contact !== 'pending') return;
  const accountId = address;
  const previous = sessionChats;
  sessionChats = updateConversation(sessionChats, peer, (conversation) => ({
    ...conversation, contact: 'blocked', blockedFrom: 'pending', messages: [], unread: 0, draft: '',
  }));
  for (const key of incomingFiles.keys()) if (key.startsWith(`${peer}:`)) incomingFiles.delete(key);
  if (!await persistLocalChats() && address === accountId) sessionChats = previous;
}

async function blockContact(peer: string): Promise<void> {
  if (peer === address) return;
  const existing = sessionChats.byPeer[peer];
  if (!existing || existing.contact === 'blocked') return;
  calls?.revoke(peer);
  const previous = sessionChats;
  const accountId = address;
  sessionChats = updateConversation(sessionChats, peer, (conversation) => ({
    ...conversation, blockedFrom: conversation.contact, contact: 'blocked', unread: 0,
  }));
  for (const key of incomingFiles.keys()) if (key.startsWith(`${peer}:`)) incomingFiles.delete(key);
  for (const message of existing.messages) if (message.file) clearFileRetry(peer, message.id);
  if (!await persistLocalChats() && address === accountId) sessionChats = previous;
}

function unblockContact(peer: string): void {
  if (sessionChats.byPeer[peer]?.contact !== 'blocked') return;
  const contact = sessionChats.byPeer[peer].blockedFrom === 'accepted' ? 'accepted' : 'new';
  sessionChats = updateConversation(sessionChats, peer, (conversation) => ({
    ...conversation, contact, blockedFrom: undefined,
  }));
  void persistLocalChats();
  if (contact === 'accepted' && chat) void chat.connect(peer).catch(() => {});
}

async function commitDeviceMessage(event: DeviceEvent, kind: 'message' | 'sync'): Promise<void> {
  const peer = kind === 'sync' ? event.to : event.from, decoded = decodeChatContent(event.text);
  if (!decoded || decoded.details?.pin || decoded.details?.ephemeral || decoded.details?.ephemeralOpened) throw new Error('device_content_invalid');
  const current = sessionChats.byPeer[peer];
  if (current?.contact === 'blocked') throw new Error('blocked_contact');
  if (current?.deletedIds?.includes(event.id)) return;
  const existing = current?.messages.find(m => m.id === event.id);
  if (existing) {
    if (existing.text !== decoded.text || existing.direction !== (kind === 'sync' ? 'outgoing' : 'incoming') ||
      JSON.stringify(existing.details ?? {}) !== JSON.stringify(decoded.details ?? {})) throw new Error('device_message_conflict');
    if (!await persistLocalChats()) throw new Error('device_history_not_saved'); return;
  }
  if (kind === 'message' && (!current || current.contact === 'pending' || current.contact === 'new')) {
    if (current?.contact === 'pending' && current.messages.length || !current && sessionChats.order.filter(p => sessionChats.byPeer[p].contact === 'pending').length >= 32) throw new Error('device_request_limit');
  }
  const entry: ChatEntry = { id: event.id, text: decoded.text, from: event.from, timestamp: event.timestamp,
    direction: kind === 'sync' ? 'outgoing' : 'incoming', deviceMessage: true, ...(decoded.details ? { details: decoded.details } : {}) };
  if (kind === 'sync') sessionChats = recordSentMessage(sessionChats, peer, entry);
  else {
    if (current?.contact === 'outgoing') sessionChats = setContactState(sessionChats, peer, 'accepted');
    sessionChats = receiveMessage(sessionChats, entry);
  }
  if (!await persistLocalChats()) throw new Error('device_history_not_saved');
  deviceLastReceive = Date.now();
}

function initializeDevices(nextChat: ChatService, generation: number): Promise<void> {
  if (deviceInitialization?.chat === nextChat) return deviceInitialization.promise;
  if (deviceRuntime) return Promise.resolve();
  const attempt = ++deviceAttempt;
  deviceBusy = true; deviceErrorCode = ''; deviceStatus = 'Проверяем подключение устройств…';
  const promise = startDevices(nextChat, generation, attempt).finally(() => {
    if (deviceInitialization?.promise === promise) { deviceInitialization = null; deviceBusy = false; }
  });
  deviceInitialization = { chat: nextChat, promise }; return promise;
}

async function startDevices(nextChat: ChatService, generation: number, attempt: number): Promise<void> {
  if (!trustedSession) { deviceStatus = 'Для управления устройствами нужен доверенный режим входа.'; return; }
  if (!deviceSettings.enabled) { deviceStatus = 'Подключение дополнительных устройств выключено. Его можно включить здесь, не меняя существующие ноды.'; return; }
  if (!deviceOwnerKey || !identity || !chatStoreKey) { deviceStatus = 'Ключи управления устройствами не готовы. Заблокируйте приложение и войдите снова.'; return; }
  const node = deviceNodeCandidate(deviceSettings.authority, courierState.node, offlineDeliveryState.node), signer = identity, owner = address, key = deviceOwnerKey, historyKey = chatStoreKey;
  const current = () => attempt === deviceAttempt && chat === nextChat && generation === authGeneration && screen === 'account' && !endingSession && !memoryBusy && !panicBusy;
  const guard = () => { if (!current()) throw new Error('device_session_changed'); };
  let store: ReturnType<typeof openBrowserOwnerDevicesWithKey> | undefined, opened: DeviceRuntime | undefined;
  const timeout = new AbortController(), timer = setTimeout(() => timeout.abort(), 6000);
  try {
    deviceStore?.close();
    store = openBrowserOwnerDevicesWithKey({ key, owner, signer, trusted: true, isCurrent: current }); deviceStore = store;
    const own = await store.snapshot(); guard();
    deviceBackgroundNeeded = deviceSessionRequested || hasDelegatedWork(own,deviceSettings.peers,sessionChats);
    if (!deviceBackgroundNeeded) {
      deviceStatus = 'Основной аккаунт · обычная доставка. Модуль дополнительных устройств не требуется.';
      return;
    }
    let authority: import('$lib/devices/membership').DirectoryAuthority | null = null;
    if (node) try {
      requireNodeNetwork(node.url, networkSettings.internetEnabled === false);
      const info = await inspectHomeNode(node.url, timeout.signal); guard();
      if (info.nodeId !== node.nodeId || !info.deviceDirectory) throw new Error('device_node_changed');
      authority = { url: node.url, nodeId: node.nodeId, publicKey: info.deviceDirectory.publicKey };
      requireDeviceAuthority(deviceSettings.authority, authority);
    } catch (error) { guard(); const failure = deviceStartupFailure(error); deviceErrorCode = failure.code; deviceStatus = failure.message + ' Доступен прямой режим; прежняя привязка сохранена.'; }
    const options = { owner, device: owner, identity: signer, key: historyKey, store,
      settings: () => deviceSettings, save: async settings => {
        guard(); const previous = sessionChats; deviceSettings = settings;
        sessionChats = reconcileRootOnlyOutbox(sessionChats,settings.peers);
        if (!await persistLocalChats()) { sessionChats = previous; throw new Error('device_settings_not_saved'); }
        if (previous !== sessionChats) courierDelivery?.wake();
      },
      chat: nextChat, guard, lanOnly: () => networkSettings.internetEnabled === false,
      onlinePeers: () => sessionChats.order.filter(p => p !== owner && sessionChats.byPeer[p].connection === 'connected'),
      contacts: () => sessionChats.order.filter(p => p !== owner && sessionChats.byPeer[p].contact === 'accepted'),
      primaryRouted: (peer,id) => !!sessionChats.byPeer[peer]?.messages.some(m => m.id === id && m.from === owner && m.direction === 'outgoing' && !m.deviceMessage && !m.file && !m.restoredFromBackup),
      copies: () => deviceCopyJobs(sessionChats, owner),
      copied: async item => {
        guard(); const previous = sessionChats;
        sessionChats = updateConversation(sessionChats, item.peer, conversation => ({ ...conversation,
          messages: conversation.messages.map(message => message.id === item.id ? withoutDeviceCopy(message, item.kind) : message) }));
        if (!await persistLocalChats()) { sessionChats = previous; throw new Error('device_history_not_saved'); }
      },
      allowed: peer => isValidAccountId(peer) && sessionChats.byPeer[peer]?.contact !== 'blocked',
      queued: () => sessionChats.order.filter(to => sessionChats.byPeer[to].contact === 'accepted' || sessionChats.byPeer[to].contact === 'outgoing').flatMap(to => sessionChats.byPeer[to].messages.filter(m => m.deviceMessage && !m.restoredFromBackup && m.direction === 'outgoing' &&
        ['queued', 'sending', 'sent', 'stored'].includes(m.delivery ?? '')).map(m => ({ to, id: m.id, text: encodeChatContent(m.text, m.details) }))),
      commit: async (event, kind) => { guard(); await commitDeviceMessage(event, kind); guard(); },
      delivery: (peer, id, value) => {
        guard(); const old = sessionChats.byPeer[peer]?.messages.find(m => m.id === id);
        if (!old || old.delivery === 'delivered' || old.delivery === 'read') return;
        if (!old.deviceMessage) {
          if (old.direction !== 'outgoing' || old.deviceCopyDelivery === 'delivered' || old.deviceCopyDelivery === value) return;
          sessionChats = updateConversation(sessionChats, peer, conversation => ({ ...conversation,
            messages: conversation.messages.map(message => message.id === id ? { ...message, deviceCopyDelivery: value } : message) }));
          void persistLocalChats(); return;
        }
        if (old.delivery === value) return;
        sessionChats = setDeliveryStatus(sessionChats, peer, id, value); void persistLocalChats();
      },
      status: (value, reason) => { if (current()) deviceStatus = value === 'fresh' ? (reason === 'direct' ? 'Прямой режим · права проверяются у владельца' : 'Список устройств проверен') : value === 'cached'
        ? 'Используется сохранённый список · менее безопасно' : reason === 'send' ? 'Очередь ожидает отправки: проверьте доступ или лимит хранилища' : 'Ожидаем безопасное подключение к ноде'; }
    } satisfies Omit<import('$lib/devices/runtime').DeviceRuntimeOptions, 'authority'>;
    if (authority) try { opened = await openDeviceRuntime({ ...options, authority }); }
    catch (error) { guard(); const failure = deviceStartupFailure(error); deviceErrorCode = failure.code; store = openBrowserOwnerDevicesWithKey({ key, owner, signer, trusted: true, isCurrent: current }); opened = await openDirectDeviceRuntime({ ...options, store }); }
    else opened = await openDirectDeviceRuntime(options);
    guard();
    deviceRuntime = opened; deviceStore = store; opened.start();
  } catch (error) {
    await opened?.stop(); store?.close();
    if (current()) {
      const failure = deviceStartupFailure(error); deviceStatus = failure.message; deviceErrorCode = failure.code;
      // Runtime startup may close its store on failure. Keep local management
      // reachable; publication still requires a verified working runtime.
      deviceStore = openBrowserOwnerDevicesWithKey({ key, owner, signer, trusted: true, isCurrent: current });
    }
  } finally { clearTimeout(timer); }
}

async function retryDevices(recheck = false): Promise<void> {
  if (navigationBusy() || deviceBusy) return;
  if (recheck && deviceRuntime) {
    const previous = deviceRuntime; deviceRuntime = null; deviceStore = null;
    await previous.stop();
  }
  if (chat) await initializeDevices(chat, authGeneration);
  else await initializeChat();
}

async function prepareDeviceLink(): Promise<void> {
  if (!trustedSession) { deviceStatus = 'Для выдачи прав нужен доверенный вход владельца.'; return; }
  deviceSessionRequested = true;
  if (!deviceSettings.enabled) { deviceSettings = { ...deviceSettings, enabled: true }; if (!await persistLocalChats()) throw new Error('device_settings_not_saved'); }
  await retryDevices(true);
}
async function setupDeviceNode(text: string, code: string): Promise<void> {
  if (!identity || !trustedSession || !profileNetwork) throw new Error('device_owner_required');
  const generation = authGeneration, owner = address, signer = identity, input = parseNodeSetup(text);
  const guard = () => { if (generation !== authGeneration || address !== owner || identity !== signer || screen !== 'account') throw new Error('device_session_changed'); };
  requireNodeNetwork(input.url, networkSettings.internetEnabled === false);
  const signal = AbortSignal.timeout(15000), info = await inspectHomeNode(input.url, signal); guard();
  if (input.nodeId && input.nodeId !== info.nodeId || !info.deviceDirectory) throw new Error('device_node_changed');
  const authority = { url: input.url, nodeId: info.nodeId, publicKey: info.deviceDirectory.publicKey };
  requireDeviceAuthority(deviceSettings.authority, authority);
  const pairCode = (input.code || code).replace(/[\s-]/g, '').toLowerCase();
  if (pairCode) await signedNodeRequest(input.url, info.nodeId, signer, owner, info.multiMailbox ? '/node/join' : '/node/pair', { code: pairCode }, signal);
  else await signedNodeRequest(input.url, info.nodeId, signer, owner, '/mailbox/status', {}, signal);
  guard(); deviceSessionRequested = true; deviceSettings = { ...deviceSettings, enabled: true, authority };
  if (!await persistLocalChats()) throw new Error('device_settings_not_saved'); guard(); await retryDevices(true);
  if (!deviceRuntime || deviceRuntime.mode !== 'node') throw new Error('device_connection_required');
}

async function transferDeviceContacts(): Promise<void> {
  const runtime = deviceRuntime; if (!runtime) throw new Error('device_connection_required');
  const packets = deviceBootstrapPackets({ nickname: selfNickname, contacts: sessionChats.order.filter(p => p !== address && sessionChats.byPeer[p].contact === 'accepted')
    .map(p => ({ address: p, name: aliases[p] || declaredNames[p] || '' })) });
  for (const packet of packets) await runtime.send(address, packet, crypto.randomUUID());
}

async function authorizeHistoryTarget(device: string): Promise<void> {
  if (!trustedSession || !deviceStore || !chatStoreKey || screen !== 'account' || endingSession || memoryBusy) throw new Error('history_access');
  const active = deviceStore, generation = authGeneration, owner = address;
  const member = (await active.list()).find(item => item.device === device);
  if (active !== deviceStore || generation !== authGeneration || owner !== address || member?.status !== 'authorized') throw new Error('history_access');
}
async function captureHistory(peers: string[], attachments: boolean, current: () => void) {
  const key = chatStoreKey, owner = address, generation = authGeneration;
  if (!key || !trustedSession) throw new Error('history_access');
  const guard = () => { current(); if (generation !== authGeneration || owner !== address || key !== chatStoreKey || screen !== 'account' || endingSession || memoryBusy) throw new Error('history_access'); };
  guard(); if (!await persistLocalChats()) throw new Error('history_storage'); guard();
  // One read-only disk snapshot, no network stop, seed read or queue rewrite.
  return captureDeviceHistory(owner, key, peers, attachments, guard);
}

let chatStartVersion = 0;
async function initializeChat() {
  // A network/settings restart can overlap an unlock while old queues settle.
  // Only the newest start may publish a transport for this identity; otherwise
  // the abandoned transport can retain a second signaling registration.
  const startVersion = ++chatStartVersion;
  if (address && screen === 'account') sessionChats = savedConversation(sessionChats, address);
  if (memoryBusy || panicBusy || screen !== 'account') return;
  if (!identity || !address) {
    throw new Error('identity_not_ready');
  }
  if (!profileNetwork) { signalingStatus = 'idle'; return; }

  const stoppingOffline = stopOfflineDelivery();
  const previousChat = chat;
  const generation = authGeneration;
  chat = null;
  signalingStatus = 'connecting';
  if (previousChat) await previousChat.disconnect();
  await stoppingOffline;
  if (startVersion !== chatStartVersion || generation !== authGeneration || !identity || screen !== 'account' || memoryBusy || panicBusy || !profileNetwork) return;
  await preparePrimaryQueues(generation);
  if (startVersion !== chatStartVersion || generation !== authGeneration || !identity || screen !== 'account' || memoryBusy || panicBusy || !profileNetwork) return;

  const receiveConfig = receiveRouting(configuredNodes, networkSettings, location.href, trustedSession ? courierState : emptyCourierState());
  const transport = new RoutedWebRTCTransport(receiveConfig.endpoints, networkSettings.quickReserve, undefined, undefined, receiveConfig.required);
  receiveRoutingStamp = JSON.stringify([address, receiveConfig, networkSettings.quickReserve]);
  deliveryDiagnostics = emptyDeliveryDiagnostics();
  routedTransport = transport;
  const updateNodes = () => {
    if (routedTransport !== transport) return;
    nodeStates = transport.getNodeStates();
    peerRoutes = transport.getPeerRoutes();
  };
  transport.onNodesChange(updateNodes);
  const nextChat = new ChatService(transport);
  installDeviceDiscovery({ chat: nextChat,
    current: () => chat === nextChat && generation === authGeneration && screen === 'account' && !endingSession && !memoryBusy,
    allowed: peer => sessionChats.byPeer[peer]?.contact === 'accepted',
    previous: peer => deviceSettings.peers.find(roster => roster.record.author === peer),
    accepted: async roster => {
      const previous = deviceSettings.peers.find(value => value.record.author === roster.record.author);
      requirePolicyProgress(previous, roster);
      if (JSON.stringify(previous) === JSON.stringify(roster) || !previous && deviceSettings.peers.length >= 50) return;
      deviceSettings = { ...deviceSettings, peers: [...deviceSettings.peers.filter(value => value.record.author !== roster.record.author), roster] };
      if (!await persistLocalChats()) return;
      if (chat === nextChat && generation === authGeneration && deviceSettings.enabled) {
        deviceBackgroundNeeded = true; void initializeDevices(nextChat, generation).catch(() => {});
      }
    } });
  callView = idleCall(); callStream = null;
  const nextCalls = new CallController({
    self: address,
    allowed: peer => chat === nextChat && screen === 'account' && !endingSession && !voiceBusy && !memoryBusy && !panicBusy && !profileSwitchBusy && !authBusy && !backupOpen && sessionChats.byPeer[peer]?.contact === 'accepted',
    online: peer => sessionChats.byPeer[peer]?.connection === 'connected',
    send: (peer, signal) => nextChat.sendCall(signal, peer),
    // Future TURN credentials belong in an authenticated, short-lived config
    // provider here, not in the public shell or the courier queue.
    config: peer => ({ iceServers: networkSettings.internetEnabled === false || transport.isLocalOnlyPeer(peer) ? [] : defaultStunServers() }),
    media: () => navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false }),
    peerConnection: config => new RTCPeerConnection(config),
    update: view => {
      if (calls !== nextCalls) return;
      callView = view;
      const next = recordCall(sessionChats, address, view);
      if (next !== sessionChats) { sessionChats = next; void persistLocalChats(); }
    },
    remote: stream => { if (calls === nextCalls) callStream = stream; },
  });
  calls = nextCalls;
  nextChat.onCall((peer, signal) => nextCalls.receive(peer, signal));
  nextChat.onDisconnect(() => nextCalls.dispose());
  if (trustedSession && chatStoreKey) {
    const worker = new OfflineController({ address, identity, lanOnly: () => networkSettings.internetEnabled === false,
      authorize: authorizePrimary, issue: outgoingIssue,
      state: () => offlineDeliveryState, update: state => { offlineDeliveryState = state; },
      chats: () => sessionChats, persist: persistLocalChats, receive: receiveOfflineMessage,
      delivery: (peer, id, value) => {
        const message = sessionChats.byPeer[peer]?.messages.find(msg => msg.id === id);
        if (!message || message.delivery === 'delivered' || message.delivery === 'read') return;
        sessionChats = setDeliveryStatus(sessionChats, peer, id, value);
        if (message.file && value === 'delivered') updateFileEntry(peer, id, { fileStatus: 'ready', fileProgress: message.file.size });
        if (value === 'delivered') outbox.acknowledge(peer, id);
      },
      publish: (peer, bundle) => nextChat.sendOfflineBundle(bundle, peer),
      preferCourier: () => courierState.enabled && Boolean(courierState.node),
      error: message => { offlineDeliveryError = message; },
    });
    offlineDelivery = worker;
    nextChat.onOfflineBundle((peer, value) => worker.accept(peer, value));
    const courier = new CourierController({ address, identity, lanOnly: () => networkSettings.internetEnabled === false,
      activity:(peer,id,stage)=>{
        if(chat!==nextChat)return;
        sessionChats=updateConversation(sessionChats,peer,c=>({...c,messages:c.messages.map(m=>m.id===id?nodeTransferUpdate(m,stage):m)}));
      },
      approvedKeySource:source=>(networkSettings.managedNodes??[]).some(n=>n.url===source.url&&n.nodeId===source.nodeId),
      signalingRoutes: () => networkSettings.signalingEnabled === false ? [] : nodeStates.filter(n => n.status === 'connected').map(n => n.url),
      authorize: authorizePrimary, issue: outgoingIssue,
      files: {
        load: async (peer, id) => (await getFileBytes(peer, id))?.slice() ?? null,
        offer: (peer, offer, timestamp, courierAddress) => {
          if (chat !== nextChat || sessionChats.byPeer[peer]?.contact !== 'accepted' || sessionChats.byPeer[peer].deletedIds?.includes(offer.id)) throw new Error('attachment_contact_unavailable');
          const existing = sessionChats.byPeer[peer].messages.find(m => m.id === offer.id);
          if (existing?.file) {
            if (existing.direction !== 'incoming' || JSON.stringify(existing.file) !== JSON.stringify(offer)) throw new Error('conflicting_message_id');
            updateFileEntry(peer, offer.id, { courierVia: courierAddress });
          } else sessionChats = receiveFileMessage(sessionChats, { id: offer.id, text: '', from: peer, timestamp, direction: 'incoming', file: offer,
            fileStatus: 'offered', fileProgress: 0, courierVia: courierAddress, ...(offer.details ? { details: offer.details } : {}) });
        },
        accepted: (peer, id) => {
          const m = sessionChats.byPeer[peer]?.messages.find(m => m.id === id);
          return chat === nextChat && !!m && !m.fileDeleted && !['rejected', 'canceled'].includes(m.fileStatus ?? '') && (m.fileAccepted === true || m.fileStatus === 'ready');
        },
        progress: (peer, id, bytes, uploading) => {
          if (chat !== nextChat) return;
          const m = sessionChats.byPeer[peer]?.messages.find(m => m.id === id);
          if (!m || ['ready', 'rejected', 'canceled'].includes(m.fileStatus ?? '')) return;
          updateFileEntry(peer, id, { fileStatus: uploading ? 'sending' : 'receiving', fileProgress: bytes });
        },
        complete: async (peer, id, bytes) => {
          if (chat !== nextChat) throw new Error('courier_session_closed');
          const canceled = () => sessionChats.byPeer[peer]?.messages.some(m => m.id === id && (m.fileDeleted || ['canceled', 'rejected'].includes(m.fileStatus ?? '')));
          if (canceled()) throw new Error('attachment_canceled');
          await storeFileBytes(peer, id, bytes);
          if (chat !== nextChat) throw new Error('courier_session_closed');
          if (canceled()) throw new Error('attachment_canceled');
          updateFileEntry(peer, id, { fileStatus: 'ready', fileProgress: bytes.length });
        },
        savePart: (peer, id, index, bytes) => storeFileBytes(peer, `${id}:courier:${index}`, bytes),
        loadPart: async (peer, id, index) => (await getFileBytes(peer, `${id}:courier:${index}`))?.slice() ?? null,
        cleanup: async (peer, id, chunks) => {
          if (!chatStoreKey || chat !== nextChat) throw new Error('courier_session_closed');
          await deleteLocalFiles(address, Array.from({ length: chunks }, (_, i) => fileTransferKey(peer, `${id}:courier:${i}`)));
        },
      },
      state: () => courierState, update: state => { courierState = state; },
      chats: () => sessionChats, persist: persistCourierState, receive: receiveOfflineMessage,
      outcome: recordNodeOutcome,
      delivery: (peer, id, value) => {
        const message = sessionChats.byPeer[peer]?.messages.find(msg => msg.id === id);
        if (!message || message.delivery === 'delivered' || message.delivery === 'read') return;
        sessionChats = setDeliveryStatus(sessionChats, peer, id, value);
        if (message.file && value === 'delivered') updateFileEntry(peer, id, { fileStatus: 'ready', fileProgress: message.file.size });
        if (value === 'delivered') outbox.acknowledge(peer, id);
      },
      publish: (peer, bundle) => nextChat.sendCourierBundle(bundle, peer),
      error: message => { courierError = message; },
      status: value => { if (courierDelivery === courier) {courierStatus = value;keyBudgetNow=Date.now();} },
      diagnostics: value => { if (courierDelivery === courier) deliveryDiagnostics = value; },
    });
    courierDelivery = courier;
    nextChat.onCourierBundle((peer, value) => courier.accept(peer, value));
    transport.onCourier((data, reply) => { void courier.receive(data, reply).catch(error => {
      if (courierDelivery === courier) courierError = error instanceof Error && error.message === 'attachment_relay_update_required'
        ? 'Для получения файлов обновите сервер связи или подключитесь к обновлённому LAN-сигналингу ноды.'
        : 'Конверт не принят: не прошёл проверку либо нет сохранённого одноразового ключа.';
    }); });
  }
  nextChat.onMessage(async (msg) => {
    if (chat !== nextChat) return;
    const current = sessionChats.byPeer[msg.from];
    if (current?.contact === 'blocked') throw new Error('blocked_contact');
    if ((msg.details?.pin || msg.details?.ephemeral || msg.details?.ephemeralOpened) && current?.contact !== 'accepted') throw new Error('pin_contact_not_accepted');
    if (current?.deletedIds?.includes(msg.id)) return;
    if (!textFitsLimit(msg.text, false)) throw new Error('message_too_large');
    const existing = current?.messages.find((entry) => entry.id === msg.id);
    if (existing && (existing.direction !== 'incoming' || encodeChatContent(existing.text,existing.details) !== encodeChatContent(msg.text,msg.details))) {
      throw new Error('conflicting_message_id');
    }
    if (!existing && (current?.contact === 'pending' || !current || current.contact === 'new')) {
      if (!textFitsLimit(encodeChatContent(msg.text, msg.details), true)) throw new Error('request_too_large');
      if (current?.contact === 'pending' && current.messages.length > 0) throw new Error('request_already_pending');
      if (!current && sessionChats.order.filter((peer) => sessionChats.byPeer[peer]?.contact === 'pending').length >= 32) {
        throw new Error('too_many_pending_requests');
      }
    }
    const handshake = contactHandshake(current?.contact,'message'), reciprocalRequest = handshake.accept;
    if (reciprocalRequest) sessionChats = setContactState(sessionChats, msg.from, 'accepted');
    sessionChats = receiveMessage(sessionChats, {
      id: msg.id,
      text: msg.text,
      from: msg.from,
      timestamp: msg.timestamp,
      direction: 'incoming',
      deviceCopies: deviceCopyKinds(address, msg.from, true, deviceSettings.peers),
      ...(msg.details ? { details: msg.details } : {}),
    });
    sessionChats = updateConversation(sessionChats, msg.from, (conversation) => ({
      ...conversation, connection: 'connected',
    }));
    if (!await persistLocalChats()) {
      if (reciprocalRequest && chat === nextChat) sessionChats = setContactState(sessionChats, msg.from, 'outgoing');
      throw new Error('incoming_message_not_saved');
    }
    if (handshake.confirm) void nextChat.sendContactAccepted(msg.from).catch(() => {});
    void deviceRuntime?.wake().catch(() => {});
    if (handshake.keys) publishDeliveryKeys(msg.from,true);
    if (reciprocalRequest) void nextChat.sendReadPreference(readReceiptsEnabled, msg.from).catch(() => {});
  });
  nextChat.onReceipt((peer, messageId) => {
    if (chat !== nextChat) return;
    const message = sessionChats.byPeer[peer]?.messages.find((entry) => entry.id === messageId && entry.direction === 'outgoing');
    if (!message?.delivery || message.file) return;
    sessionChats = setDeliveryStatus(sessionChats, peer, messageId, 'delivered');
    outbox.acknowledge(peer, messageId);
    radioRuntime?.acknowledge(peer, messageId);
    void persistLocalChats();
  });
  nextChat.onContactAccepted((peer) => {
    if (chat !== nextChat) return;
    const handshake = contactHandshake(sessionChats.byPeer[peer]?.contact,'accepted');
    if (handshake.keys && !handshake.accept) { publishDeliveryKeys(peer,true); return; }
    if (!handshake.accept) return;
    sessionChats = setContactState(sessionChats, peer, 'accepted');
    publishDeliveryKeys(peer,true);
    // One echo after a state transition. An already accepted side only resends
    // keys, never another echo, so confirmations cannot loop indefinitely.
    void nextChat.sendContactAccepted(peer).catch(() => {});
    void persistLocalChats();
    void nextChat.sendReadPreference(readReceiptsEnabled, peer).catch(() => {});
    publishAvatar(nextChat, peer);
    void nextChat.sendProfileLinks(selfLinks, peer).catch(() => {});
    scanVisibleMessages();
  });
  nextChat.onReadPreference((peer, enabled) => {
    if (chat !== nextChat || sessionChats.byPeer[peer]?.contact !== 'accepted') return;
    peerReadConfirmed.add(peer);
    peerReadPreferences = { ...peerReadPreferences, [peer]: enabled };
    void persistLocalChats();
    if (!enabled) {
      clearPendingReads(peer);
      void persistLocalChats();
    } else {
      scanVisibleMessages();
      void flushReadReceipts(peer, nextChat);
    }
  });
  nextChat.onReadReceipt((peer, messageId) => {
    if (chat !== nextChat || !readReceiptsEnabled || !peerReadConfirmed.has(peer) || peerReadPreferences[peer] !== true ||
      sessionChats.byPeer[peer]?.contact !== 'accepted') return;
    const message = sessionChats.byPeer[peer].messages.find((entry) => entry.id === messageId && entry.direction === 'outgoing');
    if (!message?.delivery || (message.file && message.fileStatus !== 'ready')) return;
    sessionChats = setDeliveryStatus(sessionChats, peer, messageId, 'read');
    outbox.acknowledge(peer, messageId);
    void persistLocalChats();
  });
  nextChat.onProfile((accountId, nickname) => {
    if (chat !== nextChat || sessionChats.byPeer[accountId]?.contact === 'blocked') return;
    declaredNames = { ...declaredNames, [accountId]: nickname };
    persistLocalChats();
  });
  nextChat.onProfileLinks((peer, links) => {
    if (chat !== nextChat || sessionChats.byPeer[peer]?.contact !== 'accepted') return;
    if (!peerLinks[peer] && Object.keys(peerLinks).length >= 256) return;
    peerLinks = { ...peerLinks, [peer]: links }; void persistLocalChats();
  });
  nextChat.onAvatar((accountId, avatar) => {
    if (chat !== nextChat || sessionChats.byPeer[accountId]?.contact !== 'accepted' || peerAvatars[accountId] === avatar) return;
    if (!avatar && !peerAvatars[accountId]) return;
    if (avatar && !peerAvatars[accountId] && Object.keys(peerAvatars).length >= 256) return;
    const next = { ...peerAvatars };
    if (avatar) next[accountId] = avatar; else delete next[accountId];
    peerAvatars = next; void persistLocalChats();
  });
  nextChat.onFileOffer(async (peer, offer) => {
    if (chat !== nextChat || sessionChats.byPeer[peer]?.contact !== 'accepted') return;
    if (sessionChats.byPeer[peer].deletedIds?.includes(offer.id)) { await nextChat.sendFileControl('reject', offer.id, peer); return; }
    const existing = sessionChats.byPeer[peer].messages.find((message) => message.id === offer.id);
    if (existing?.file) {
      if (existing.direction !== 'incoming' || JSON.stringify(existing.file) !== JSON.stringify(offer)) return;
      if (existing.fileStatus === 'ready') {
        await nextChat.sendFileControl('received', offer.id, peer);
      } else if (existing.fileStatus === 'rejected' || existing.fileStatus === 'canceled') {
        await nextChat.sendFileControl('reject', offer.id, peer);
      } else if (existing.fileAccepted) {
        await acceptFile(peer, offer.id);
      }
      return;
    }
    if (sessionChats.byPeer[peer].messages.filter((message) => message.direction === 'incoming' && message.file &&
      (message.fileStatus === 'offered' || message.fileStatus === 'receiving' || message.fileStatus === 'failed')).length >= 32) {
      await nextChat.sendFileControl('reject', offer.id, peer);
      return;
    }
    const previousChats = sessionChats;
    sessionChats = receiveFileMessage(sessionChats, {
      id: offer.id, text: '', from: peer, timestamp: Date.now(), direction: 'incoming',
      file: offer, fileStatus: 'offered', fileProgress: 0,
      ...(offer.details ? { details: offer.details } : {}),
    });
    if (!await persistLocalChats()) {
      if (chat === nextChat) sessionChats = previousChats;
      throw new Error('incoming_file_offer_not_saved');
    }
  });
  nextChat.onFileControl(async (peer, id, action) => {
    if (chat !== nextChat || sessionChats.byPeer[peer]?.contact !== 'accepted') return;
    const entry = sessionChats.byPeer[peer].messages.find((message) => message.id === id && message.file);
    if (!entry) return;
    if (action === 'accept' && entry.direction === 'outgoing') {
      void sendFileData(peer, id, nextChat);
    } else if (action === 'received' && entry.direction === 'outgoing') {
      clearFileRetry(peer, id);
      updateFileEntry(peer, id, { fileStatus: 'ready', fileProgress: entry.file!.size });
      sessionChats = setDeliveryStatus(sessionChats, peer, id, 'delivered');
      void persistLocalChats();
    } else if (action === 'reject' || action === 'cancel') {
      clearFileRetry(peer, id);
      incomingFiles.delete(fileTransferKey(peer, id));
      updateFileEntry(peer, id, { fileStatus: action === 'reject' ? 'rejected' : 'failed', fileProgress: 0 });
      void persistLocalChats();
    }
  });
  nextChat.onFileChunk(async (peer, id, index, chunk) => {
    await receiveFileChunk(peer, id, index, chunk, nextChat);
  });
  nextChat.onPeerIdentity((accountId, verifiedPublicKey) => {
    if (chat !== nextChat || peerPublicKeys[accountId] === verifiedPublicKey) return;
    peerPublicKeys = { ...peerPublicKeys, [accountId]: verifiedPublicKey };
    persistLocalChats();
  });
  nextChat.onStatusChange((transportStatus) => {
    if (chat !== nextChat) return;
    signalingStatus = transportStatus;
    if (transportStatus !== 'connected') return;
    for (const peer of sessionChats.order) {
      if (peer === address) continue;
      if (sessionChats.byPeer[peer].contact === 'accepted' || sessionChats.byPeer[peer].contact === 'outgoing' ||
        sessionChats.byPeer[peer].messages.some((message) =>
        message.direction === 'outgoing' && (message.delivery === 'queued' || message.delivery === 'sent' ||
          (message.file && (message.fileStatus === 'queued' || message.fileStatus === 'offered' || message.fileStatus === 'failed'))))) {
        void nextChat.connect(peer).catch(() => {});
      }
    }
  });
  nextChat.onPeerChange((peer, event) => {
    if (chat !== nextChat) return;
    if (event === 'left') nextCalls.peerUnavailable(peer.address);
    // An unsolicited secure connection is not yet a chat or a request.
    if (!sessionChats.byPeer[peer.address]) return;
    sessionChats = updateConversation(sessionChats, peer.address, (current) => ({
      ...current,
      connection: event === 'joined' ? 'connected' : 'offline',
      error: '',
      messages: event === 'left' ? current.messages.map(peerDisconnectedMessage) : current.messages,
    }));
    if (event === 'joined') {
      if (sessionChats.byPeer[peer.address]?.contact !== 'blocked') {
        void nextChat.sendProfile(selfNickname, peer.address).catch(() => {});
      }
      if (sessionChats.byPeer[peer.address]?.contact === 'accepted') {
        publishAvatar(nextChat, peer.address);
        void nextChat.sendProfileLinks(selfLinks, peer.address).catch(() => {});
        publishDeliveryKeys(peer.address);
        void nextChat.sendContactAccepted(peer.address).catch(() => {});
        void nextChat.sendReadPreference(readReceiptsEnabled, peer.address).catch(() => {});
        void flushReadReceipts(peer.address, nextChat);
      }
      void outbox.reconnect(peer.address, nextChat);
      if (sessionChats.byPeer[peer.address]?.contact === 'accepted') {
        for (const entry of sessionChats.byPeer[peer.address].messages) {
          if (entry.direction === 'outgoing' && entry.file &&
            (entry.fileStatus === 'queued' || entry.fileStatus === 'offered' || entry.fileStatus === 'failed')) {
            void offerFile(peer.address, entry.id, nextChat);
          }
        }
      }
    } else {
      for (const key of incomingFiles.keys()) if (key.startsWith(`${peer.address}:`)) incomingFiles.delete(key);
      peerReadConfirmed.delete(peer.address);
      void persistLocalChats();
      courierDelivery?.wake();
    }
  });

  const chatIdentity = { provider: identity, address };
  chat = nextChat;
  offlineDelivery?.start();
  courierDelivery?.start();
  const startingDevices = initializeDevices(nextChat, generation);

  // Unlocking/local queues must not wait for a signaling server. ChatService
  // binds the identity immediately and independently guards async registration.
  void nextChat.init(chatIdentity).catch(() => {
    if (chat === nextChat && generation === authGeneration) status = 'Аккаунт открыт, сеть временно недоступна ⚠️';
  });
  await startingDevices;
}

function chatSnapshot(): LocalChatData {
  return snapshotLocalChatData({
    meshtastic,
    radioState,
    deviceSettings: normalizeDeviceSettings(deviceSettings),
    mediaLibrary,
    selfNickname,
    selfLinks, peerLinks, seedNoticeDismissed, deviceOffer,
    selfAvatar,
    peerAvatars: { ...peerAvatars },
    seedBackupVerified,
    readReceiptsEnabled,
    autoLockMinutes,
    autoReceiveFilesEnabled,
    autoPlayVideoEnabled,
    cleanImageMetadataEnabled,
    allowForwardAttribution,
    networkSettings: normalizeNetworkSettings(networkSettings),
    offlineState: offlineDeliveryState,
    courierState,
    peerReadPreferences: { ...peerReadPreferences },
    aliases: { ...aliases },
    declaredNames: { ...declaredNames },
    peerPublicKeys: { ...peerPublicKeys },
    chats: saveChats(sessionChats),
  });
}

function requestExit(mode: 'lock' | 'logout'): void {
  if (switchingTrust) return;
  pendingExit = mode;
  deleteHistoryChoice = defaultDeleteHistory(mode, trustedSession);
  status = '';
}

async function refreshStorage(): Promise<void> {
  if (screen !== 'account' || memoryBusy) return;
  const account = address; const request = ++storageRequest;
  storageReading = true; storageError = '';
  try {
    await historyWrites.settled(); await Promise.allSettled([...pendingFileWrites]);
    const disk = await inspectChatStorage(account);
    const estimate = navigator.storage?.estimate ? await navigator.storage.estimate().catch(() => ({} as StorageEstimate)) : {};
    let cacheBytes = 0;
    if ('caches' in window) for (const name of await caches.keys()) {
      if (!name.startsWith('mesh-autonomy-shell-')) continue;
      const cache = await caches.open(name);
      for (const url of await cache.keys()) {
        const response = await cache.match(url); if (response) cacheBytes += (await response.blob()).size;
      }
    }
    if (request !== storageRequest || address !== account || screen !== 'account') return;
    storageFiles = managedFiles(sessionChats, disk, sessionFiles);
    storageHistoryBytes = disk.historyBytes; storageOtherBytes = disk.otherAccountBytes;
    storageCacheBytes = cacheBytes; storageOriginUsage = estimate.usage; storageQuota = estimate.quota;
  } catch { if (request === storageRequest) storageError = 'Не удалось измерить хранилище. Данные не удалены.'; }
  finally { if (request === storageRequest) storageReading = false; }
}

function pauseFileTransfers(): void {
  audioTrack = null;
  offlineDelivery?.stop(); offlineDelivery = null;
  courierDelivery?.stop(); courierDelivery = null; queueOverviewOpen=false;
  for (const timer of fileRetryTimers.values()) clearTimeout(timer);
  fileRetryTimers.clear(); fileRetryAttempts.clear();
  for (const receiver of incomingFiles.values()) receiver.bytes.fill(0);
  incomingFiles.clear(); sendingFiles.clear(); outbox.reset(); clearMediaPreview();
  for (const peer of sessionChats.order) sessionChats = updateConversation(sessionChats, peer, conversation => ({
    ...conversation, connection: 'offline', sending: false,
    messages: conversation.messages.map(message => ({ ...message,
      delivery: message.delivery === 'sending' ? 'queued' : message.delivery,
      fileStatus: message.fileStatus === 'receiving' ? 'offered' : message.fileStatus === 'sending' ? 'queued' : message.fileStatus,
    })),
  }));
}

async function cleanMemory(): Promise<void> {
  const choice = memoryConfirmation;
  if (!choice || memoryBusy || endingSession || switchingTrust || authBusy || mediaBusy || screen !== 'account') return;
  if (voiceBusy || attachingFiles) { status = 'Завершите запись или добавление файлов перед очисткой.'; return; }
  memoryBusy = true; storageError = ''; memoryConfirmation = null;
  const generation = authGeneration;
  const oldChat = chat; chat = null;
  const previous = sessionChats;
  const previousOffline = offlineDeliveryState; const previousCourier = courierState; const stoppingOffline = stopOfflineDelivery();
  try {
    await oldChat?.disconnect();
    await stoppingOffline;
    if (generation !== authGeneration) return;
    pauseFileTransfers();
    await historyWrites.settled(); await Promise.allSettled([...pendingFileWrites]);
    if (generation !== authGeneration) return;
    const ids = new Set(choice.ids.filter(id=>!isLibraryFileId(id)));
    const deleteIds = choice.kind === 'history'
      ? (await inspectChatStorage(address)).files.map(f=>f.id).filter(id=>!isLibraryFileId(id))
      : [...ids];
    if (choice.kind === 'history') offlineDeliveryState = { ...offlineDeliveryState, pending: [] };
    const courierPartIds: string[] = [];
    for (const r of courierState.incomingFiles) if (choice.kind === 'history' || ids.has(fileTransferKey(r.job.body.from, r.job.body.id))) {
      for (let i = 0; i < r.manifest.attachment.chunks; i++) courierPartIds.push(fileTransferKey(r.job.body.from, `${r.job.body.id}:courier:${i}`));
    }
    courierState = pruneCourierFiles(courierState, (peer, id) => choice.kind === 'history' || ids.has(fileTransferKey(peer, id)));
    for (const peer of sessionChats.order) sessionChats = updateConversation(sessionChats, peer, conversation => ({
      ...conversation, unread: choice.kind === 'history' ? 0 : conversation.unread,
      messages: choice.kind === 'history' ? [] : conversation.messages.map(message =>
        message.file && ids.has(fileTransferKey(peer, message.id))
          ? { ...message, fileDeleted: true, fileStatus: 'canceled', fileAccepted: false, fileProgress: 0 } : message),
    }));
    if (trustedSession) {
      if (!chatStoreKey) throw new Error('storage_unavailable');
      await saveChatDataWithFileDeletion(chatStoreKey, address, chatSnapshot(), [...deleteIds, ...courierPartIds]);
    } else {
      if (!chatStoreKey) throw new Error('storage_unavailable');
      const baseline = await loadLocalChatData(chatStoreKey, address);
      if (generation !== authGeneration) return;
      if (baseline) await saveChatDataWithFileDeletion(chatStoreKey, address,
        cleanedHistory(baseline, choice.kind === 'history' ? undefined : choice.ids),
        deleteIds);
      else await deleteLocalFiles(address, deleteIds);
    }
    for (const [id, bytes] of sessionFiles) if (!isLibraryFileId(id) && (choice.kind === 'history' || ids.has(id))) { bytes.fill(0); sessionFiles.delete(id); }
    if (generation === authGeneration) status = 'Удалено с этого устройства. Копии у собеседников не изменены.';
  } catch {
    if (generation === authGeneration) {
      sessionChats = previous; offlineDeliveryState = previousOffline; pauseFileTransfers();
      courierState = previousCourier;
      storageError = 'Очистка не завершена. Обновите размеры и повторите.';
    }
  } finally {
    memoryBusy = false;
    if (generation === authGeneration) {
      if (screen === 'account' && identity && !chat) await initializeChat();
      await refreshStorage();
    }
  }
}

function memoryDialog(node: HTMLDialogElement) {
  const previous = document.activeElement as HTMLElement | null;
  node.showModal();
  return { destroy() { node.close(); previous?.focus(); } };
}

function discardAllOpenData(): void {
  const oldChat = chat; chat = null;
  void oldChat?.disconnect().catch(() => {});
  pauseFileTransfers();
  for (const bytes of sessionFiles.values()) bytes.fill(0);
  if (lockedSession) for (const bytes of lockedSession.files.values()) bytes.fill(0);
  lockedSession = null;
  forgetOpenAccount('logout');
  appUpdater?.dispose(); appUpdater = null;
}

async function emergencyReset(): Promise<void> {
  if (panicBusy || memoryBusy || switchingTrust || endingSession) return;
  panicBusy = true; panicError = '';
  try {
    const failures = await eraseApplicationData({
      announce: beginStorageReset, stop: discardAllOpenData,
      drain: async () => { await historyWrites.settled(); await Promise.allSettled([...pendingFileWrites]); },
      clearHistory: clearAllChatStorage,
      clearCoreState: clearAllCoreStorage,
      clearProfiles: async () => {
        const results = await Promise.allSettled([clearAllProfileStorage(), clearOwnerDeviceStorage(), clearPendingDeviceStorage(), clearDeviceJournals(), clearDeviceHistory()]);
        localStorage.removeItem('automesh-device-lab-id-v1');
        if (results.some(result => result.status === 'rejected')) throw new Error('device_storage_not_cleared');
      },
      clearVault: () => { clearVault(); localStorage.removeItem('debugLogs'); },
      clearCache: async () => {
        let failed = false;
        if ('serviceWorker' in navigator) {
          const registrations = await navigator.serviceWorker.getRegistrations();
          for (const registration of registrations) {
            if (new URL(registration.scope).origin === location.origin)
              await registration.unregister().catch(() => { failed = true; return false; });
          }
        }
        if ('caches' in window) for (const name of await caches.keys()) {
          if (name.startsWith('mesh-autonomy-shell-')) await caches.delete(name).catch(() => { failed = true; return false; });
        }
        if (failed) throw new Error('cache_cleanup_failed');
      },
    });
    if (failures.length) throw new Error(`Не всё удалось удалить: ${failures.join(', ')}. Сеанс завершён; повторите стирание.`);
    panicOpen = false;
    status = 'Сеанс завершён. Локальные данные Automesh удалены. На диске могут остаться следы, недоступные очистке браузером.';
  } catch (error) {
    panicError = error instanceof Error ? error.message : 'Не удалось завершить стирание. Повторите.';
  } finally { panicBusy = false; }
}

async function switchTrustMode(): Promise<void> {
  if (profileRegistry?.profiles.find(p => p.id === activeProfileId)?.index !== null && activeProfileId) {
    status = 'Для перехода во временный режим сначала выберите прежний личный аккаунт.'; return;
  }
  if (memoryBusy || panicBusy || mediaBusy) return;
  if (switchingTrust || endingSession || authBusy || pendingExit || screen !== 'account') return;
  if (voiceBusy || attachingFiles || sendingFiles.size || incomingFiles.size || pendingFileWrites.size ||
      sessionChats.order.some((peer) => sessionChats.byPeer[peer].messages.some((message) =>
        message.fileStatus === 'sending' || message.fileStatus === 'receiving'))) {
    status = 'Дождитесь завершения передачи файлов перед сменой режима.';
    return;
  }
  const nextTrusted = !trustedSession;
  const nextReadReceipts = readReceiptsForMode(nextTrusted, trustedReadReceiptsPreference);
  switchingTrust = true;
  const activeChat = chat;
  const stoppingOffline = stopOfflineDelivery();
  try {
    await activeChat?.disconnect();
    await stoppingOffline;
    if (chat === activeChat) chat = null;
    await historyWrites.settled();
    if (!chatStoreKey || !address) throw new Error('chat_store_unavailable');
    if (nextTrusted) {
      setVaultPersistence(true);
      try {
        await saveLocalSessionData(chatStoreKey, address, { ...chatSnapshot(), readReceiptsEnabled: nextReadReceipts }, sessionFiles);
      } catch (e) {
        setVaultPersistence(false);
        throw e;
      }
      sessionFiles.clear();
    } else {
      await saveLocalChatData(chatStoreKey, address, chatSnapshot());
      setVaultPersistence(false);
    }
    trustedSession = nextTrusted;
    trustedDeviceChoice = nextTrusted;
    readReceiptsEnabled = nextReadReceipts;
    if (!nextReadReceipts) {
      for (const peer of sessionChats.order) clearPendingReads(peer);
    }
    status = nextTrusted
      ? 'Доверенный режим включён. Переписка сохраняется в браузере.'
      : 'Недоверенный режим включён. Новая переписка хранится только до закрытия вкладки; при выходе удаление включено по умолчанию.';
  } catch (e) {

    status = 'Не удалось сменить режим. Проверьте хранилище браузера и повторите.';
  } finally {
    if (chat === activeChat) chat = null;
    if (identity && screen === 'account' && !chat) await initializeChat();
    switchingTrust = false;
  }
}

function forgetOpenAccount(mode: 'lock' | 'logout'): void {
  mediaLibrary = emptyMediaLibrary(); mediaOpen = false; receivedPack = null;
  lockedProfileId = mode === 'lock' ? activeProfileId : '';
  offlineDelivery?.stop(); offlineDelivery = null;
  courierDelivery?.stop(); courierDelivery = null; queueOverviewOpen=false;
  offlineDeliveryState = emptyOfflineState(); offlineDeliveryError = '';
  courierState = emptyCourierState(); courierError = '';
  courierStatus = idleCourierStatus();
    deliveryDiagnostics = emptyDeliveryDiagnostics(); receiveRoutingStamp = '';
  storageRequest++; storageReading = false;
  storageFiles = []; storageError = ''; memoryConfirmation = null;
  authNickname = '';
  backupOpen = false;
  chatSearch = '';
  mobilePane = 'list';
  stopNodeTools();
  routedTransport = null;
  nodeStates = [];
  peerRoutes = {};
  networkSettings = emptyNetworkSettings();
  nodeChecks = {};
  clearMediaPreview();
  for (const timer of fileRetryTimers.values()) clearTimeout(timer);
  fileRetryTimers.clear();
  fileRetryAttempts.clear();
  sessionFiles.clear();
  automaticFileBytes = 0;
  incomingFiles.clear();
  sendingFiles.clear();
  outbox.reset();
  clearSensitiveData();
  if (mode === 'logout') { clearVault(); releaseAccountLease(); }
  publicKey = '';
  address = '';
  qrPublic = '';
  accountView = 'chats';
  sharingContact = false; shareFallbackLink = '';
  pageNavigation?.clear(); navigationAccount = ''; copiedContactId = '';
  peerCardAddress = '';
  peerQr = '';
  pendingExit = null;
  oldPassword = '';
  newPassword = '';
  confirmPassword = '';
  identity = null;
  chatStoreKey = null;
  sessionChats = emptySessionChats();
  signalingStatus = 'idle';
  selfNickname = ''; selfLinks = []; peerLinks = {}; seedNoticeDismissed = false; deviceOffer = false;
  selfAvatar = ''; peerAvatars = {}; avatarBusy = false; avatarError = '';
  seedBackupVerified = false;
  readReceiptsEnabled = false;
  autoLockMinutes = DEFAULT_AUTO_LOCK_MINUTES;
  peerReadPreferences = {};
  peerReadConfirmed.clear();
  readReceiptSending.clear();
  visibleReadNodes.clear();
  nicknameDraft = '';
  aliases = {};
  declaredNames = {};
  peerPublicKeys = {};
  aliasDraft = '';
  if (mode === 'logout') {
    lockedSession = null;
    trustedReadReceiptsPreference = true;
  }
  trustedDeviceChoice = mode === 'lock' ? trustedSession : false;
  trustedSession = false;
  screen = mode === 'lock' ? 'unlock' : 'entry';
}

async function endSession(mode: 'lock' | 'logout', deleteHistory: boolean): Promise<void> {
  // Locking waits for the queued atomic media write below, rather than dropping
  // an automatic lock request merely because a library import is saving.
  if (endingSession || switchingTrust || memoryBusy || screen !== 'account') return;
  endingSession = true;
  audioTrack = null;
  const activeChat = chat;
  chat = null;
  const stoppingOffline = stopOfflineDelivery();

  try {
    await activeChat?.disconnect();
    await stoppingOffline;
  } catch (e) {

  }

  try {
    await historyWrites.settled();
    await Promise.allSettled([...pendingFileWrites]);
    const action = historyAction(mode, trustedSession, deleteHistory);
    if (mode === 'lock') {
      lockedSession = { accountId: address, data: chatSnapshot(), files: new Map(sessionFiles), trusted: trustedSession };
      if (action === 'save') {
        if (!chatStoreKey) throw new Error('chat_store_unavailable');
        await saveLocalChatData(chatStoreKey, address, lockedSession.data);
      }
    } else if (action === 'delete') {
      await deleteLocalChatData(address);
    } else {
      if (!chatStoreKey) throw new Error('chat_store_unavailable');
      await saveLocalSessionData(chatStoreKey, address, chatSnapshot(), sessionFiles);
    }

    forgetOpenAccount(mode);
  } catch (e) {

    if (mode === 'lock' && lockedSession) {
      forgetOpenAccount('lock');
      status = 'Сеанс заблокирован, но не удалось завершить операцию с историей браузера.';
    } else {
      status = 'Не удалось завершить сеанс: проверьте хранилище браузера и повторите.';
      if (identity) await initializeChat();
    }
  } finally {
    endingSession = false;
  }
}

async function changePassword(): Promise<void> {
  if (authBusy || endingSession || switchingTrust || screen !== 'account') return;
  const passwordError = passwordPolicyError(newPassword);
  if (passwordError) { status = passwordError; return; }
  if (newPassword !== confirmPassword) {
    status = 'Новые пароли не совпадают.';
    return;
  }
  const generation = authGeneration;
  authBusy = true;
  try {
    const changed = await changeVaultPassword(oldPassword, newPassword, trustedSession);
    if (generation !== authGeneration) return;
    if (!changed) {
      status = 'Неверный текущий пароль.';
      return;
    }
    oldPassword = '';
    newPassword = '';
    confirmPassword = '';
    status = 'Пароль изменён.';
  } catch (e) {
    if (generation !== authGeneration) return;
    status = 'Не удалось изменить пароль. Старый пароль сохранён.';
  } finally { authBusy = false; }
}

</script>

<svelte:window onkeydown={handleAppKey} />
{#if dev}<span hidden data-navigation-ready={routerReady} data-navigation-position={(page.state as { automeshPage?: { index: number } }).automeshPage?.index ?? 'unset'}></span>{/if}

{#if panicOpen}
  <EmergencyReset busy={panicBusy} error={panicError} close={() => panicOpen = false} reset={() => void emergencyReset()} />
{/if}

<div class="page-shell" class:auth-shell={screen !== 'account' && !newDeviceOpen}>
{#if screen !== 'account' && !newDeviceChatting}<div class="entry-language"><LanguageSelector /></div>{/if}
{#if screen !== 'account' && status}
  <p role="alert" class="auth-error">{$i18n.text(status)}</p>
{/if}


{#if newDeviceOpen && screen !== 'account'}
  {#if !newDeviceChatting && (!savedLinkedDevice || deviceInvitation)}<button type="button" onclick={() => newDeviceOpen = false}>{$i18n.text("Назад к входу")}</button>{/if}
  <NewDevice initialInvitation={deviceInvitation} onSaved={() => { savedLinkedDevice = true; deviceInvitation = null; }} onWorkspace={value => newDeviceChatting = value} />
  {#if !newDeviceChatting && screen === 'unlock'}<button type="button" onclick={() => newDeviceOpen = false}>{$i18n.text("Вернуться к прежнему входу")}</button>{/if}
{/if}
{#if screen === 'entry' && !newDeviceOpen}
  <span class="app-wordmark">Automesh</span>
  <h2>{$i18n.text("Ваши разговоры.")}<br />{$i18n.text("Ваше пространство.")}</h2>
  <p class="auth-description">{$i18n.text("Общайтесь напрямую, через интернет или домашнюю сеть.")}</p>

  <button class="primary" onclick={createAccount} disabled={authBusy}>
    {authBusy ? $i18n.text("Создаём…") : $i18n.text("Создать аккаунт")}
  </button>

  <button disabled={authBusy} onclick={() => { trustedDeviceChoice = true; newAccountFlow = false; authNickname = ''; restoreMethod = 'words'; screen = 'import'; }}>
    {$i18n.text("Восстановить аккаунт")}
  </button>
  <EntryAbout />
  <button type="button" disabled={authBusy} onclick={() => newDeviceOpen = true}>{$i18n.text("Войти без сида")}</button>
{/if}

{#if screen === 'import'}
  <h3>{$i18n.text("Восстановление аккаунта")}</h3>

  <nav class="settings-menu" aria-label={$i18n.text("Способ восстановления")}>
    <button type="button" disabled={authBusy} aria-pressed={restoreMethod === 'words'} onclick={() => { restoreMethod = 'words'; status = ''; authNickname = ''; }}>{$i18n.text("Seed-фраза")}</button>
    <button type="button" disabled={authBusy} aria-pressed={restoreMethod === 'file'} onclick={() => { restoreMethod = 'file'; status = ''; authNickname = ''; }}>{$i18n.text("Зашифрованный файл")}</button>
  </nav>
  {#if restoreMethod === 'words'}
    <SeedEntry disabled={authBusy} onComplete={(phrase) => { importMnemonic = phrase; status = ''; void importAccount(); }} />
  {:else}
    <BackupReader onOpened={restoreBackup} label={$i18n.text("Восстановить аккаунт из файла")} />
  {/if}

  <button disabled={authBusy} onclick={backWithinApp}>
    {$i18n.text("Назад")}
  </button>
{/if}

{#if screen === 'unlock' && !newDeviceOpen}
  <UnlockForm bind:password={unlockPin} busy={authBusy} editableWhileBusy={autoUnlockBusy} onUnlock={() => void unlockAccount()} onInput={() => status = ''} onKeydown={handleAuthKey} />
{/if}

{#if screen === 'setPin'}
  <h3>{newAccountFlow ? $i18n.text("Создать аккаунт") : $i18n.text("Пароль для этого устройства")}</h3>
  <form class="auth-setup" autocomplete="on" onsubmit={(event) => { event.preventDefault(); void saveWithPin(); }}>
  <div class="section-title">
    <label for="auth-nickname">{$i18n.text("Ник")}</label>
    <HelpInfo label={$i18n.text("Справка: ник")} text={appHelp.authNickname} open={openHelp === 'authNickname'} onToggle={() => toggleHelp('authNickname')} />
  </div>
  <input id="auth-nickname" type="text" name="username" autocomplete="username" bind:value={authNickname} maxlength="32" placeholder={$i18n.text("Необязательно")} disabled={authBusy} />
  <PasswordField id="auth-password" label={$i18n.text("Пароль")} bind:value={pin} nickname={authNickname} required disabled={authBusy} onChange={() => status = ''} />
  {#if newAccountFlow}
    <details class="auth-advanced">
      <summary>{$i18n.text("Дополнительные параметры")}</summary>
    <div class="section-title">
      <label for="seed-length">{$i18n.text("Seed-фраза")}</label>
      <HelpInfo label={$i18n.text("Справка: длина seed-фразы")} text={$i18n.text("Резервная фраза создаётся только после заполнения формы. 24 слова — больше случайности; меньше слов удобнее записать вручную. Фраза восстанавливает аккаунт, это не пароль для входа. При повторной попытке сохранения уже созданная фраза не заменяется.")} />
    </div>
    <select id="seed-length" bind:value={registrationWordCount} disabled={authBusy || !!mnemonic}>
      {#each SEED_WORD_COUNTS as count}<option value={count}>{count} {count === 21 ? $i18n.text("слово") : count === 24 ? $i18n.text("слова") : $i18n.text("слов")}</option>{/each}
    </select>
    </details>
  {/if}

  <label style="display:inline-block; margin:10px 4px 10px 0;">
    <input type="checkbox" bind:checked={trustedDeviceChoice} disabled={authBusy} /> {$i18n.text("Доверенное устройство")}
  </label>
  <HelpInfo label={$i18n.text("Справка: доверенное устройство")} text={appHelp.authTrust} open={openHelp === 'authTrust'} onToggle={() => toggleHelp('authTrust')} />

  <button type="submit" disabled={authBusy}>
    {authBusy ? $i18n.text("Сохраняем…") : newAccountFlow ? $i18n.text("Создать и продолжить") : $i18n.text("Сохранить")}
  </button>

  <button type="button" disabled={authBusy} onclick={backWithinApp}>
    {$i18n.text("Назад")}
  </button>
  </form>
{/if}

{#if screen === 'account'}
{#if pendingNodeAdmin && identity && !endingSession}
  <NodeAdminConsent request={pendingNodeAdmin} {address} signer={() => endingSession ? null : identity}
    internetEnabled={networkSettings.internetEnabled !== false} onApproved={rememberAdminNode} onClose={() => pendingNodeAdmin = null} />
{/if}
  <div class="account-shell" class:chats={accountView === 'chats'} inert={memoryBusy || panicBusy || profileSwitchBusy}>
  <AccountHeader contactUrl={profileNetwork?contactLink(address):''} contactEnabled={!!profileNetwork} accountId={address} avatar={selfAvatar || identiconFor(address)} photo={!!selfAvatar} nickname={selfNickname || 'Мой аккаунт'}
      queueState={queueIndicatorStates(headerQueue)[0]} networkAvailable={radioConnection==='connected'||courierStatus.connection==='connected'||connectedPeerCount>0||nodeStates.some(n=>n.status==='connected')}
      profile={profileRegistry?.profiles.find(p => p.id === activeProfileId && p.role !== 'main')?.name || (profileNetwork ? 'Личный' : 'Выберите профиль')}
      expanded={accountView === 'own'} onProfile={() => accountView === 'own' ? backWithinApp() : changeAccountView('own')}
      settings={accountView === 'profile'} warning={!seedBackupVerified} update={updateState.phase === 'available'}
      disabled={endingSession || switchingTrust || memoryBusy || authBusy} lockDisabled={endingSession || switchingTrust}
      onPanic={() => { panicError = ''; panicOpen = true; }} onLock={() => void endSession('lock', false)}
      onSettings={() => accountView === 'profile' ? backWithinApp() : changeAccountView('profile')}>
    {#snippet network()}


      <ConnectionIndicators compact responsive expanded={networkSummaryOpen} onToggle={() => networkSummaryOpen = true}
        radioState={radioState.connection?radioConnection:undefined}
        nodes={nodeStates} directCount={connectedPeerCount} serversEnabled={networkSettings.signalingEnabled !== false} internetEnabled={networkSettings.internetEnabled !== false}
        courierEnabled={courierState.enabled} {courierStatus} courierPending={courierState.pending.length} trusted={trustedSession}
        receiveKeys={courierState.keys.filter(k => k.expiresAt > Date.now()).length} onOpen={openConnectionSection} />
        <QueueIndicator {...headerQueue} onOpen={()=>queueOverviewOpen=true} expanded={queueOverviewOpen} />
        {#if radioState.connection}<RadioIndicator chats={sessionChats} connecting={radioConnection==='connecting'} board={radioBoardLabel} expanded={radioOverviewOpen} onOpen={()=>radioOverviewOpen=true}/>{/if}
    {/snippet}
  </AccountHeader>

  {#if radioOverviewOpen}<RadioQueuePanel chats={sessionChats} connected={radioConnection==='connected'} connecting={radioConnection==='connecting'} error={radioErrorText} name={contactName} board={radioBoardLabel}
    onRetry={(peer,id)=>void retryRadio(peer,id)} onConnect={reconnectRadioBoard} onSettings={()=>openConnectionSection('radio')}
    onOpen={(peer,id)=>void openContactMessage(peer,id)} onClose={()=>radioOverviewOpen=false}/>{/if}

  {#if queueOverviewOpen}
    <CompactDialog title={$i18n.text("Очередь ноды")} onClose={()=>queueOverviewOpen=false}>
      <NodeQueueOverview nodeUrl={courierState.node?.url} chats={queueChats} cleanup={courierStatus.cleanup} snapshot={courierStatus.queue} connected={courierStatus.connection==='connected'} onOpen={(peer,id)=>void openQueueMessage(peer,id)} onClear={peer=>void clearQueueCounters(peer)} />
    </CompactDialog>
  {/if}
  {#if accountView === 'chats'}<AccountNotices backup={!seedBackupVerified && !seedNoticeDismissed} devices={deviceOffer}
    openBackup={openAccountBackup} openDevices={showDevices} dismiss={dismissAccountNotice} />{/if}

  {#if callView.phase !== 'idle'}
    {#key callView.id}<CallPanel view={callView} name={contactName(callView.peer)} photo={contactPhoto(callView.peer)} stream={callStream}
      onAccept={() => void calls?.accept()} onEnd={() => calls?.end()} onMismatch={() => calls?.verificationFailed()} onMute={() => calls?.mute()} onDismiss={() => calls?.dismiss()}
      onChat={() => void openDirectChat(callView.peer)} />{/key}
  {/if}

  {#if audioTrack}
    {#key audioTrack.key}
      <PersistentAudio bind:this={audioControls} id={audioTrack.id} tracks={audioQueue} load={audioTrack.load} loadShareFile={audioTrack.loadShareFile}
        onSelect={id => { if (audioTrack) playAudio(audioTrack.peer,id); }} onAction={(id,action) => void audioQueueAction(id,action)} onClose={() => audioTrack = null}
        disabled={navigationBusy() || attachingFiles || voiceBusy}
        pauseForVideo={callBusy || voiceBusy || (galleryIndex >= 0 && !!galleryItems[galleryIndex]?.file && inlineMediaFor(galleryItems[galleryIndex].file!)?.kind === 'video')} />
    {/key}
  {/if}

  {#if accountView==='own'}<div class="own-profile-title"><button type="button" onclick={backWithinApp}>{$i18n.text("← Назад")}</button><h3>{$i18n.text("Мой профиль")}</h3></div>{/if}
  <div class="profile-picker-host" class:profile-picker-inline={accountView === 'own'}>
    <ProfileSwitcher inline={accountView === 'own'} profiles={profileRegistry?.profiles ?? []} activeId={activeProfileId} activePhoto={selfAvatar} trusted={trustedSession} allChats={allProfileChats}
      busy={navigationBusy()} requestedId={requestedProfileId} onDismiss={() => { requestedProfileId = ''; requestedProfilePeer = ''; requestedInboxPage = 0; requestedInboxFocus = undefined; }}
      onSwitch={switchActiveProfile} onManage={() => { changeAccountView('profile'); selectSettings('account'); }} />
  </div>

  {#if status || voiceNotice}<div class="notice-stack" aria-label={$i18n.text("Уведомления приложения")}>
    {#if status}{#key status}<NotificationToast notice={accountNotice(status)} onClose={() => status = ''} />{/key}{/if}
    {#if voiceNotice}{#key voiceNotice}<NotificationToast notice={voiceNotice} onClose={() => voiceNotice = null} />{/key}{/if}
  </div>{/if}
  {#if shareFallbackLink}<input readonly value={shareFallbackLink} aria-label={$i18n.text("Ссылка на контакт")} style="width:100%;box-sizing:border-box;" />{/if}

  {#if pendingContactRoute}
    <CompactDialog title={$i18n.text("Сеть из ссылки контакта")} onClose={() => pendingContactRoute = null}>
      <p>{$i18n.text("Чтобы найти собеседника, можно подключиться к серверу, указанному в его ссылке:")}</p>
      <code style="overflow-wrap:anywhere">{pendingContactRoute.url}</code>
      <p>{$i18n.text("Разрешение добавит сервер в настройки этого профиля. Это не подключение ноды для хранения и не выдача прав на аккаунт.")}</p>
      <p class="help-text">{$i18n.text("Сервер должен разрешать подключения из этого приложения. Личность собеседника проверяется отдельно по Mesh ID.")}</p>
      <button disabled={networkBusy} onclick={() => void acceptContactRoute()}>{$i18n.text("Разрешить и открыть чат")}</button>
      <button disabled={networkBusy} onclick={() => { const peer = pendingContactRoute!.peer; pendingContactRoute = null; void addConversation(peer); }}>{$i18n.text("Открыть без добавления сервера")}</button>
    </CompactDialog>
  {/if}

  {#if mediaOpen}
    {#key address}
      {@const ownerGeneration = untrack(()=>authGeneration)}
      <MediaLibraryPanel library={mediaLibrary} initialTab={mediaTab} persistent={trustedSession}
        canSend={accountView === 'chats' && sessionChats.byPeer[sessionChats.activePeer]?.contact === 'accepted'}
        load={loadLibraryAsset} commit={(next,files)=>commitMediaLibrary(next,files,ownerGeneration)} send={sendLibraryAsset}
        share={shareLibraryPack} exportPack={downloadLibraryPack} onClose={backWithinApp} />
    {/key}
  {/if}
  {#if receivedPack}
    <CompactDialog title={$i18n.text("Добавить стикерпак")} onClose={backWithinApp}>
      <strong>{receivedPack.pack.name}</strong>
      <p>{$i18n("m_878c37f8407d", {v0: (receivedPack.pack.assets.length), v1: ((receivedPack.files.reduce((s,f)=>s+f.bytes.length,0)/1024/1024).toFixed(1))})}</p>
      <p>{$i18n.text("Сохранить в библиотеку этого профиля?")}</p>
      <button disabled={mediaBusy} onclick={()=>void acceptReceivedPack()}>{$i18n.text("Добавить набор")}</button>
      <button disabled={mediaBusy} onclick={backWithinApp}>{$i18n.text("Отмена")}</button>
    </CompactDialog>
  {/if}
  {#if networkSummaryOpen}
    <CompactDialog title={$i18n.text("Состояние сети")} onClose={backWithinApp}>
      <ConnectionIndicators nodes={nodeStates} directCount={connectedPeerCount} serversEnabled={networkSettings.signalingEnabled !== false} internetEnabled={networkSettings.internetEnabled !== false}
        radioState={radioState.connection?radioConnection:undefined}
        courierEnabled={courierState.enabled} {courierStatus} courierPending={courierState.pending.length} trusted={trustedSession}
        receiveKeys={courierState.keys.filter(k => k.expiresAt > Date.now()).length} onOpen={openConnectionSection} />
      <p class="help-text">{$i18n.text("Зелёная точка в шапке означает хотя бы одно соединение, не доставку сообщений. Нажмите нужный индикатор для настроек.")}</p>
    </CompactDialog>
  {/if}
  {#if nodeBudgetOpen}
    <CompactDialog title={$i18n.text('Доставка: нода и LoRa')} onClose={()=>nodeBudgetOpen=false}>
      <ChatDeliveryOptions budget={activeKeyBudget} nodeUrl={courierState.node?.url??offlineDeliveryState.node?.url??''} onNode={()=>{nodeBudgetOpen=false;openConnectionSection('outgoing');}}
        radioKnown={!!radioState.connection} connected={radioConnection==='connected'} connecting={radioConnection==='connecting'}
        board={radioBoardLabel} preferred={preferRadio} hasRoute={activeRadioRoute} connectionError={radioErrorText}
        eligible={radioAvailable&&sessionChats.byPeer[sessionChats.activePeer]?.contact==='accepted'} busy={composerSending||attachingFiles||actionBusy||radioBusy}
        reception={activeRadioReception} heard={activeRadioNode?radioHeard[activeRadioNode]:undefined} now={keyBudgetNow}
        onRadio={()=>{nodeBudgetOpen=false;openConnectionSection('radio');}} onReconnect={reconnectRadioBoard} onPreferred={setPreferRadio} onShare={()=>shareRadioContact(sessionChats.activePeer)}/>
    </CompactDialog>
  {/if}

  {#if pendingExit}
    <section class="exit-confirm" aria-label={pendingExit === 'logout' ? $i18n.text("Подтверждение выхода") : $i18n.text("Подтверждение блокировки")}>
      {#if pendingExit === 'logout'}
        <p>{$i18n.text("Выйти из аккаунта?")}</p>
        <label><input type="checkbox" bind:checked={deleteHistoryChoice} /> {$i18n.text("Удалить переписку и контакты этого аккаунта из браузера")}</label>
        <HelpInfo label={$i18n.text("Справка: удаление истории")} text={appHelp.deleteHistory} open={openHelp === 'deleteHistory'} onToggle={() => toggleHelp('deleteHistory')} />
      {:else}<p>{$i18n.text("История останется доступной после разблокировки.")}</p>{/if}
      <div>
        <button onclick={() => endSession(pendingExit!, deleteHistoryChoice)} disabled={endingSession}>{endingSession ? $i18n.text("Подождите…") : pendingExit === 'lock' ? $i18n.text("Заблокировать") : $i18n.text("Выйти")}</button>
        <button onclick={() => pendingExit = null} disabled={endingSession}>{$i18n.text("Отмена")}</button>
      </div>
    </section>
  {/if}

  {#if memoryConfirmation}
    <dialog class="exit-confirm" use:memoryDialog oncancel={() => memoryConfirmation = null} aria-label={$i18n.text("Подтверждение очистки")}>
      <p>{memoryConfirmation.kind === 'history' ? $i18n.text("Удалить всю переписку и вложения этого аккаунта? Контакты и настройки останутся.") : $i18n("m_5db0b52cd808", {v0: (memoryConfirmation.kind)})}</p>
      <p>{$i18n.text("Это нельзя отменить. Сначала скачайте нужные файлы.")}</p>
      <button onclick={() => void cleanMemory()}>{$i18n.text("Удалить")}</button>
      <button onclick={() => memoryConfirmation = null}>{$i18n.text("Отмена")}</button>
    </dialog>
  {/if}

  {#if accountView === 'own'}
    {#if !profileNetwork}<p>{$i18n.text("Выберите профиль выше. Технический адрес не публикуется.")}</p><button type="button" onclick={()=>requestExit('logout')} disabled={endingSession||switchingTrust}>{$i18n.text("Выйти из аккаунта")}</button>
    {:else}
    <ContactCard self links={selfLinks} saveLinks={saveProfileLinks} accountId={address} nickname={selfNickname} alias="" qr={qrPublic} contactUrl={contactLink(address)}
      photo={selfAvatar} photoBusy={avatarBusy} photoError={avatarError} changePhoto={(file,crop) => void changeOwnAvatar(file,crop)}
      copied={copiedContactId === address} blocked={false} hasChat={true} messages={sessionChats.byPeer[address]?.messages ?? []}
      urls={imageUrls} errors={imageErrors} copy={() => void copyContactAddress(address)} rename={() => false} toggleBlock={() => {}}
      share={() => void shareContact(address)} sharing={sharingContact}
      editOwn={() => { changeAccountView('profile'); selectSettings('account'); }}
      openChat={() => openDirectChat(address)} openMessage={id => void openContactMessage(address, id)}
      preview={observeContactPreview} canOpen={mediaCanOpen} openLibrary={()=>openMediaLibrary('stickers')}>
      {#snippet radioActions()}{#if radioContact}<RadioContactShare contact={radioContact}/>{/if}{/snippet}
      {#snippet accountActions()}
        <button type="button" onclick={()=>requestExit('logout')} disabled={endingSession||switchingTrust}>{$i18n.text("Выйти из аккаунта")}</button>
        <HelpInfo label={$i18n.text("Справка: выход")} text={appHelp.logout} open={openHelp==='logout'} onToggle={()=>toggleHelp('logout')} />
      {/snippet}
    </ContactCard>
    {/if}

  {:else if accountView === 'peer'}
    <button onclick={backWithinApp}>{$i18n.text("← Назад")}</button>
    {#key peerCardAddress}
      <ContactCard links={peerLinks[peerCardAddress] ?? []} accountId={peerCardAddress} nickname={declaredNames[peerCardAddress] ?? ''} alias={aliases[peerCardAddress] ?? ''}
        photo={contactPhoto(peerCardAddress)}
        qr={peerQr} copied={copiedContactId === peerCardAddress} blocked={sessionChats.byPeer[peerCardAddress]?.contact === 'blocked'}
        hasChat={!!sessionChats.byPeer[peerCardAddress]} messages={sessionChats.byPeer[peerCardAddress]?.messages ?? []}
        urls={imageUrls} errors={imageErrors} copy={() => void copyContactAddress(peerCardAddress)}
        share={() => void shareContact(peerCardAddress)} sharing={sharingContact}
        rename={name => { aliasDraft = name; return saveContactAlias(); }}
        toggleBlock={() => sessionChats.byPeer[peerCardAddress]?.contact === 'blocked' ? unblockContact(peerCardAddress) : void blockContact(peerCardAddress)}
        openChat={() => openDirectChat(peerCardAddress)} openMessage={id => void openContactMessage(peerCardAddress, id)}
        preview={observeContactPreview} canOpen={mediaCanOpen} />
    {/key}

  {:else if accountView === 'profile'}

  <div class="settings-surface settings-content">
  <div class="settings-title"><h3>{$i18n.text(settingsSection === 'overview' ? $i18n.text("Настройки") : settingsMenu.find(item => item.id === settingsSection)?.label)}</h3>
    <HelpInfo label={$i18n.text("Справка: раздел настроек")} text={settingsDescriptions[settingsSection]} />
  </div>
  <SettingsMenu section={settingsSection} items={settingsMenu} descriptions={settingsDescriptions}
    backupWarning={!seedBackupVerified} onSelect={id => selectSettings(id as SettingsSection)} />

  {#if settingsSection !== 'overview' && settingsSection !== 'application' && settingsSection !== 'security' && settingsSection !== 'about'}
    <p class="help-text">{$i18n.text("Для этого профиля на этом устройстве")}</p>
  {/if}
  {#if settingsSection === 'files'}
    {#if mediaSettingsSection === 'overview'}
      <SettingsLinks items={mediaSettingsMenu.map(item => ({...item,disabled:item.id === 'library' && !profileNetwork}))} label={$i18n.text("Медиа и хранилище")} onSelect={selectMediaSettings} />
      <HelpInfo label={$i18n.text("Справка: библиотека GIF и стикеров")} text={$i18n.text("Библиотека текущего профиля хранится локально: зашифрованно в доверенном режиме, иначе до выхода. Импорт, экспорт, избранное и удаление — внутри библиотеки. Экспортированный ZIP не зашифрован; удаление из библиотеки не удаляет копии в чатах и у собеседников.")} />
    {:else}
      <button type="button" onclick={() => mediaSettingsSection = 'overview'}>{$i18n.text("‹ Медиа и хранилище")}</button>
    {/if}
  {/if}
  {#if settingsSection === 'privacy'}
    <div class="settings-section">
      <div class="setting-label">
        <label><input type="checkbox" checked={readReceiptsEnabled} disabled={switchingTrust || endingSession} onchange={(event) => void changeReadReceipts(event.currentTarget.checked)} /> {$i18n.text("Делиться отметками о прочтении")}</label>
        <HelpInfo label={$i18n.text("Справка: отметки о прочтении")} text={appHelp.receipts} open={openHelp === 'receipts'} onToggle={() => toggleHelp('receipts')} />
      </div>
    </div>
    <div class="settings-section">
      <label><input type="checkbox" checked={cleanImageMetadataEnabled} disabled={endingSession || switchingTrust || actionBusy}
        onchange={event => void changeImagePrivacy(event.currentTarget.checked)} /> {$i18n.text("Удалять личные метаданные изображений")}</label>
      <HelpInfo label={$i18n.text("Справка: метаданные изображений")} text={$i18n.text("Включено по умолчанию перед отправкой. JPEG, PNG и WebP очищаются без перекодирования: убираются GPS, даты, сведения об устройстве, комментарии, EXIF/XMP и миниатюры; цвет, прозрачность, анимация PNG/WebP и необходимый поворот сохраняются. HEIC/AVIF/BMP/TIFF при наличии декодера в браузере преобразуются локально в PNG (до 16 Мп и 20 МБ), без внешнего сервиса. Неподдерживаемые изображения не отправляются молча с метаданными. GIF, видео, архивы и документы не очищаются. Оригинал не меняется. Имя файла и надписи/лица внутри картинки не скрываются.")} />
    </div>
  <div class="settings-section">
    <label><input type="checkbox" checked={allowForwardAttribution} disabled={endingSession || switchingTrust || actionBusy}
      onchange={(event) => void saveForwardPrivacy(event.currentTarget.checked)} /> {$i18n.text("Показывать моё имя при пересылке сообщений")}</label>
    <HelpInfo label={$i18n.text("Справка: имя при пересылке")} text={$i18n.text("Для новых сообщений. При выключении обновлённый клиент не передаст ваше имя и Mesh ID в подписи пересланного сообщения. Пересылка остаётся доступной. Ранее отправленные сообщения и копии не изменятся; чужой изменённый клиент или ручное копирование не подчиняются этой настройке. Локальные имена контактов не передаются.")} />
  </div>
  {/if}
  {#if settingsSection === 'files' && mediaSettingsSection === 'files'}
    <h4>{$i18n.text("Получение и воспроизведение")}</h4>
    <div class="settings-section">
      <label><input type="checkbox" checked={autoReceiveFilesEnabled} onchange={event => void changeFilePreference('receive', event.currentTarget.checked)} /> {$i18n.text("Автоматически получать файлы")}</label>
      <HelpInfo label={$i18n.text("Справка: автоматическое получение файлов")} text={$i18n.text("Включено по умолчанию, только для принятых контактов. До 20 МБ на файл, два получения одновременно и до 100 МБ автоматически за разблокированный сеанс. Далее — ручное принятие. Сбой или нехватка места не запускают бесконечные повторные загрузки. Это сохраняет вложения в приложении, не в папке «Загрузки».")} />
    </div>
    <div class="settings-section">
      <label><input type="checkbox" checked={autoPlayVideoEnabled} onchange={event => void changeFilePreference('video', event.currentTarget.checked)} /> {$i18n.text("Запускать видео без звука")}</label>
      <HelpInfo label={$i18n.text("Справка: воспроизведение видео")} text={$i18n.text("Только видимые видео в активной вкладке. Звук включается вручную; браузер может потребовать нажатие ▶ даже для запуска без звука.")} />
    </div>
  {/if}

  {#if settingsSection === 'files' && mediaSettingsSection === 'storage'}
    <StoragePanel files={storageFiles} historyBytes={storageHistoryBytes} otherBytes={storageOtherBytes}
      cacheBytes={storageCacheBytes} originUsage={storageOriginUsage} quota={storageQuota}
      volatile={!trustedSession} busy={memoryBusy || storageReading} error={storageError}
      refresh={() => void refreshStorage()} clean={(kind, ids) => memoryConfirmation = { kind, ids }}
      download={(peer, id) => void downloadFile(peer, id)}
      chats={chatStorageUsage(sessionChats,storageFiles)} name={contactName} openChat={peer=>void openDirectChat(peer)}
      loadPreview={loadStoragePreview} />
  {/if}

  {#if settingsSection === 'about'}<AboutProject />{/if}
  {#if settingsSection === 'application'}
  <section class="settings-section"><LanguageSettings /></section>
  <section class="settings-section"><h4>{$i18n.text("Внешний вид")}</h4><ThemeSelector /></section>
  <div class="settings-section">
    <h4>{$i18n.text("Запуск без сайта")}</h4>
    <div class="setting-label">
      <span>{$i18n.text("Офлайн-копия приложения:")} <strong>{offlineState === 'ready' ? $i18n.text("сохранена") : offlineState === 'missing' ? $i18n.text("пока не сохранена") : offlineState === 'outdated' ? $i18n.text("сохранена предыдущая версия") : offlineState === 'checking' ? $i18n.text("проверяем…") : $i18n.text("не удалось проверить")}</strong></span>
      <HelpInfo label={$i18n.text("Справка: готовность офлайн")} text={appHelp.offline} open={openHelp === 'offline'} onToggle={() => toggleHelp('offline')} />
    </div>
    <button type="button" onclick={checkOfflineReady} disabled={offlineState === 'checking'}>{$i18n.text("Проверить сохранение приложения")}</button>
    <AppUpdatePanel state={updateState} {version} discardTemporary={!trustedSession}
      onCheck={() => { void appUpdater?.updater.check(); }} onApply={() => { void applyAppUpdate(); }} />
  </div>
  {/if}

  {#if settingsSection === 'connection' && !profileNetwork}
    <p>{$i18n.text("Общий ящик не подключается к сети. Выберите отдельный профиль, чтобы настроить его связь и ноду.")}</p>
  {/if}
  {#if settingsSection === 'connection' && profileNetwork}
    {#if connectionSection === 'overview'}
      <ConnectionDashboard state={connectionDashboard} onOpen={id => selectConnection(id as ConnectionSection)} />
      <SettingsLinks items={connectionMenu} label={$i18n.text("Связь и ноды")} onSelect={id => selectConnection(id as ConnectionSection)} />
    {:else}
      <div class="settings-subnav">
        <button type="button" onclick={() => selectConnection(['connect','outgoing','incoming'].includes(connectionSection) ? 'nodes' : 'overview')}>‹ {['connect','outgoing','incoming'].includes(connectionSection) ? $i18n.text("Мои ноды") : $i18n.text("Связь и ноды")}</button>
      </div>
    {/if}
  {/if}
  {#if settingsSection === 'connection' && connectionSection === 'nodes' && profileNetwork}
    <NodesPanel managed={networkSettings.managedNodes ?? []} outgoing={courierState.node} inbox={offlineDeliveryState.node} directory={deviceSettings.authority}
      enabled={courierState.enabled} status={courierStatus} pending={courierState.pending.length} busy={networkBusy || endingSession}
      onConnect={() => selectConnection('connect')} onOutgoing={() => selectConnection('outgoing')} onIncoming={() => selectConnection('incoming')} onUse={node => void useDeliveryNode(node)}
      onForget={url => { void saveNetworkSettings({ ...networkSettings, managedNodes: (networkSettings.managedNodes ?? []).filter(node => node.url !== url) }); }} />
    {#if !trustedSession}<p>{$i18n.text("Список сохранится после входа в доверенном режиме. Без сохранения он доступен только в текущем сеансе.")}</p>{/if}
  {/if}
  {#if settingsSection === 'connection' && connectionSection === 'radio' && profileNetwork}
    <RadioSettings state={radioState} queue={radioQueue} snapshot={radioSnapshot} selected={radioSelected} contact={radioContact} connection={radioConnection} busy={radioBusy} error={radioErrorText}
      diagnostics={radioDiagnostics} supported={browser && SerialRadio.supported()} bluetoothSupported={browser && BluetoothRadioPort.supported()} available={radioAvailable} onConnect={()=>selectRadioBoard('usb')} onBluetooth={()=>selectRadioBoard('bluetooth')}
      onDisconnect={()=>void stopRadio()} onChannel={index=>void changeRadioChannel(index)} onAutomatic={value=>void setRadioAutomatic(value)}
      onImport={importRadioRoute} onRetry={(peer,id)=>void retryRadio(peer,id)} onRelease={(peer,id)=>void releaseRadio(peer,id)} name={contactName}
      onChooseBoard={node=>void chooseRadioBoard(node)} onCheckBoard={node=>void checkRadioBoard(node)} onDeleteBoard={node=>void deleteRadioBoard(node)}
      channelsEnabled={meshtastic.enabled} showAllChannels={meshtastic.showAll??false} historyLimit={nativeHistoryLimit(meshtastic.historyLimit)}
      onChannelsEnabled={setNativeEnabled} onShowAllChannels={value=>setNativePreferences({showAll:value})} onHistoryLimit={value=>setNativePreferences({historyLimit:value})}
      onDefaultBoard={node=>void defaultRadioBoard(node)} onNameBoard={(node,name)=>void saveRadioBoard(node,name)}/>
  {/if}
  {#if settingsSection === 'connection' && connectionSection === 'connect' && profileNetwork}
    <nav class="settings-menu" aria-label={$i18n.text("Роль подключения ноды")}>
      <button aria-pressed={connectKind === 'profile'} onclick={() => connectKind = 'profile'}>{$i18n.text("Подключить профиль")}</button>
      <button aria-pressed={connectKind === 'admin'} onclick={() => connectKind = 'admin'}>{$i18n.text("Управлять своей нодой")}</button>
    </nav>
    {#if connectKind === 'admin'}
      <NodeAdminConnect internetEnabled={networkSettings.internetEnabled !== false} onRequest={request => pendingNodeAdmin = request} />
    {:else}
      <p class="help-text">{$i18n.text("Приглашение от владельца ноды: вставьте его или отсканируйте QR.")}</p>
      <HomeNodePanel {address} signer={() => endingSession ? null : identity} trusted={trustedSession} setupOnly={true}
        internetEnabled={networkSettings.internetEnabled !== false} mode="outgoing" {courierState} {courierError} {configureCourier} {courierStatus}
        waitingCount={courierWaiting} receivingReady={trustedSession && networkSettings.signalingEnabled !== false && nodeStates.some(n => n.status === 'connected')}
        receiveKeys={courierState.keys.filter(k => k.expiresAt > Date.now()).length} offlineNode={offlineDeliveryState.node}
        offlineEnabled={offlineDeliveryState.enabled} offlineError={offlineDeliveryError} pendingCount={offlineDeliveryState.pending.length}
        configureOffline={configureOfflineDelivery} addSignaling={addNodeSignaling} />
    {/if}
  {/if}
  {#if settingsSection === 'connection' && profileNetwork}
  {#if connectionSection === 'diagnostics'}
    <h4>{$i18n.text("Диагностика доставки")}</h4>
    <DeliveryDiagnostics channel={receivingChannel} channelFailure={receivingChannelFailure} queueReachable={courierStatus.connection === 'connected'}
      keys={courierState.keys.filter(k => k.expiresAt > Date.now()).length} diagnostics={deliveryDiagnostics}
      expanded={true} busy={receiveRecoveryBusy || endingSession} onRetry={() => void resumeDelivery()} />
  {/if}
  {#if connectionSection === 'recovery'}
    <section class="settings-section" aria-label={$i18n.text("Восстановление связи")}>
      <h4>{$i18n.text("Проверить связь, не меняя личность")}</h4>
      <p>{$i18n.text("Проверка восстанавливает существующие каналы и повторяет сохранённую очередь. Она не удаляет данные, не меняет ключи нод и не выдаёт новые права.")}</p>
      <button disabled={receiveRecoveryBusy || deviceBusy || navigationBusy()} onclick={async () => { await resumeDelivery(); await retryDevices(true); }}>{$i18n.text("Проверить существующие подключения")}</button>
      <h4>{$i18n.text("После восстановления из копии")}</h4>
      <p>{$i18n.text("Проверьте ноду и разрешения сети. Копия не переносит задания доставки и ключи ожидающих конвертов; такие конверты могут остаться недоступны. Старые сообщения повторно не отправляются.")}</p>
      <button onclick={() => selectConnection('nodes')}>{$i18n.text("Выбрать ноду доставки")}</button><button onclick={() => selectConnection('parameters')}>{$i18n.text("Проверить разрешения сети")}</button>
      {#if !deviceSettings.enabled}
        <p>{$i18n.text("Проверка прав устройств после восстановления выключена. Явное включение проверит сохранённую ноду и её ключ; другая нода не подставляется автоматически.")}</p>
        <button disabled={deviceBusy || navigationBusy() || !trustedSession} onclick={() => void prepareDeviceLink().catch(error => { deviceStatus = deviceDeliveryExplanation(error); })}>{$i18n.text("Включить проверку прав устройств")}</button>
        <p class="help-text" role="status">{$i18n.text(deviceStatus)}</p>
      {/if}
      <h4>{$i18n.text("Конфликт сессий")}</h4><p>{$i18n.text("Если один и тот же вход с сидом открыт в другом браузере, сигналинг может отклонить вторую сессию. Закройте прежнюю или подключите второе устройство через «Безопасность», без копирования сида.")}</p>
      <h4>{$i18n.text("Смена ноды")}</h4><p>{$i18n.text("Новая очередь проверяется до её выбора. Неподтверждённые задания старого пересыльщика блокируют замену: сначала завершите их. Закреплённая нода проверки прав не заменяется автоматически. Автоматический перенос между такими нодами пока не поддерживается.")}</p>
      <button onclick={() => selectConnection('diagnostics')}>{$i18n.text("Открыть диагностику")}</button>
    </section>
  {/if}
  {#if connectionSection === 'parameters'}
    <section class="settings-section" aria-label={$i18n.text("Параметры сети")}>
      <h4>{$i18n.text("Разрешённые сети")}</h4>
      <div class="settings-field"><span>{$i18n.text("Режим связи")}</span><ChoiceMenu value={networkSettings.internetEnabled === false ? 'lan' : 'combined'} label={$i18n.text("Режим связи")} disabled={networkBusy || endingSession}
        options={[{value:'combined',label:$i18n.text("Интернет + LAN")},{value:'lan',label:$i18n.text("Только LAN · без интернета")}]}
        onChange={value=>void saveNetworkSettings({...networkSettings,internetEnabled:value==='lan'?false:undefined})} /></div>
      <HelpInfo label={$i18n.text("Справка: режим Только LAN")} text={$i18n.text("Запрещает новые интернет-маршруты и внешний STUN. Уже сохранённые нодой конверты не отзываются. Загрузка сайта и проверка обновлений — отдельные действия.")} />
      <label><input type="checkbox" checked={networkSettings.signalingEnabled !== false} disabled={networkBusy || endingSession}
        onchange={event => void saveNetworkSettings({...networkSettings,signalingEnabled:event.currentTarget.checked ? undefined : false})} /> {$i18n.text("Подключаться через серверы сигналинга")}</label>
      <HelpInfo label={$i18n.text("Справка: сигналинг")} text={appHelp.signaling} />
      <label><input type="checkbox" checked={networkSettings.quickReserve} disabled={networkBusy || endingSession || networkSettings.signalingEnabled === false}
        onchange={event => void saveNetworkSettings({...networkSettings,quickReserve:event.currentTarget.checked})} /> {$i18n.text("Держать резервный сигналинг подключённым")}</label>
      <HelpInfo label={$i18n.text("Справка: резерв сигналинга")} text={appHelp.reserve} />
      <button onclick={() => selectConnection('servers')}>{$i18n.text("Адреса сигналингов")}</button>
    </section>
  {/if}
  {#if connectionSection === 'direct'}
  <div class="settings-section">
    <h4>{$i18n.text("Прямой зашифрованный канал")}</h4>
    <p>{$i18n("m_5a5b5bbf0f8e", {v0: (connectionDashboard.direct)})} <HelpInfo label={$i18n.text("Справка: прямое соединение")} text={$i18n.text("Работающий прямой канал используется первым. Для нового соединения нужен общий сигналинг или обмен QR. NAT и VPN могут мешать прямой связи даже при доступном сигналинге. Заблокированный телефон не обязан поддерживать соединение в фоне.")} /></p>
    <button type="button" onclick={() => selectConnection('servers')}>{$i18n.text("Сигналинги")}</button><button onclick={() => selectConnection('parameters')}>{$i18n.text("Параметры сети")}</button>
  </div>
  <details class="settings-section"><summary>{$i18n.text("Напрямую через QR")}</summary>
    <DirectPairing transport={routedTransport} ownAddress={address} connections={directConnections} preparePeer={prepareDirectPeer} openChat={openDirectChat} />
  </details>
  {:else if connectionSection === 'outgoing' || connectionSection === 'incoming'}
  {#key connectionSection}
  <HomeNodePanel {address} signer={() => endingSession ? null : identity} trusted={trustedSession}
    internetEnabled={networkSettings.internetEnabled !== false}
    mode={connectionSection} {courierState} {courierError} {configureCourier} {courierStatus} waitingCount={courierWaiting}
    receivingReady={trustedSession && networkSettings.signalingEnabled !== false && (requiredReceiveUrls.length ? receivingChannel === 'Подключён' : nodeStates.some(n => n.status === 'connected'))}
    receiveKeys={courierState.keys.filter(k => k.expiresAt > Date.now()).length}
    offlineNode={offlineDeliveryState.node} offlineEnabled={offlineDeliveryState.enabled}
    offlineError={offlineDeliveryError} pendingCount={offlineDeliveryState.pending.length} configureOffline={configureOfflineDelivery} addSignaling={addNodeSignaling} />
  {/key}
  {:else if connectionSection === 'servers'}
  <div class="settings-section">
    <div class="setting-label">
      <h4 style="margin:0;">{$i18n.text("Сигналинги")}</h4>
      <HelpInfo label={$i18n.text("Справка: серверы подключения")} text={appHelp.network} open={openHelp === 'network'} onToggle={() => toggleHelp('network')} />
    </div>
    <p>{$i18n.text("Поиск собеседников и установление соединений. Очереди — в «Ноды доставки».")}</p>
    <HelpInfo label={$i18n.text("Справка: несколько сигналингов")} text={$i18n.text("Домашняя и серверная ноды могут быть подключены одновременно. Адреса одного сигналинга используют одну регистрацию; независимые серверы — отдельные. При включённом резерве сохраняются подключения к резервным сигналингам. Очередь при этом не дублируется: для новых отправок выбирается одна нода доставки.")} />
    <button onclick={() => selectConnection('parameters')}>{$i18n.text("Параметры сети и резерв")}</button>

    <h4>{$i18n.text("Мои сигналинги")}</h4>
    {#each nodeRows as node (node.url)}
      <div class="settings-card">
        <strong>{node.name}</strong> · {isLocalHost(new URL(node.url).hostname) ? 'LAN' : $i18n.text("Интернет")}<br /><code>{node.url}</code><br />
        <small>{networkSettings.signalingEnabled === false ? $i18n.text("Автоподключение выключено") : node.enabled ? $i18n.text(localNodeStatus(node.url)) : $i18n.text("Отключён")}{$i18n.text(nodeChecks[node.url]) ? ` · ${$i18n.text(nodeChecks[node.url])}` : ''}</small>
        <div style="margin-top:6px; display:flex; flex-wrap:wrap; gap:6px;">
          <button type="button" onclick={() => toggleLocalNode(node)} disabled={networkBusy || endingSession}>{node.enabled ? $i18n.text("Отключить") : $i18n.text("Включить")}</button>
          <button type="button" onclick={() => checkLocalNode(node.url)} disabled={nodeProbes.has(node.url) || !node.enabled}>{$i18n.text("Проверить сервер")}</button>
          <button type="button" onclick={() => shareLocalNode(node)}
            disabled={['localhost', '127.0.0.1', '[::1]'].includes(new URL(node.url).hostname)} title={$i18n.text("Адрес работающего сервера, не прямое соединение")}>{$i18n.text("QR сервера")}</button>
          {#if !configuredNodes.some((item) => item.url === node.url)}<button type="button" onclick={() => removeLocalNode(node)} disabled={networkBusy || endingSession}>{$i18n.text("Удалить")}</button>{/if}
        </div>
      </div>
    {/each}
    {#if !nodeRows.length}<p>{$i18n.text("Сигналинги не добавлены. Можно подключиться напрямую через QR.")}</p>{/if}

    <div class="setting-label" style="margin-top:12px;">
      <span>{$i18n.text("Добавить сервер")}</span>
      <HelpInfo label={$i18n.text("Справка: QR подключения")} text={appHelp.nodeQR} open={openHelp === 'nodeQR'} onToggle={() => toggleHelp('nodeQR')} />
    </div>
    <QrInput bind:value={nodeInput} label={$i18n.text("Адрес сервера или содержимое QR")} disabled={networkBusy}
      onInput={()=>{nodeCandidate=null;candidateName='';nodeError='';}} onScan={()=>{nodeScannerOpen=!nodeScannerOpen;nodeError='';}} onImage={importNodeImage} />
    <div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:6px;">
      <button type="button" onclick={() => previewLocalNode()} disabled={networkBusy || !nodeInput.trim()}>{$i18n.text("Добавить сервер")}</button>
    </div>
    {#if nodeScannerOpen}<NodeScanner onResult={previewLocalNode} onClose={() => nodeScannerOpen = false} />{/if}
    {#if nodeCandidate}
      <div class="settings-card">
        <p>{$i18n("m_04ac92348c1d", {v0: (isLocalHost(new URL(nodeCandidate.url).hostname) ? 'LAN' : $i18n.text("интернет"))})} <code>{nodeCandidate.url}</code>?</p>
        <input bind:value={candidateName} maxlength="48" placeholder={$i18n.text("Название узла")} aria-label={$i18n.text("Название локального узла")} />
        <button type="button" onclick={addLocalNode} disabled={networkBusy}>{networkBusy ? $i18n.text("Сохраняем…") : $i18n.text("Добавить и разрешить")}</button>
        <button type="button" onclick={() => nodeCandidate = null} disabled={networkBusy}>{$i18n.text("Отмена")}</button>
      </div>
    {/if}
    {#if nodeError}<p role="alert">{$i18n.text(nodeError)}</p>{/if}
    {#if nodeQr}
      <div style="margin-top:12px; overflow-wrap:anywhere;">
        <img src={nodeQr} alt={$i18n.text("QR адреса домашнего сервера")} width="256" height="256" style="max-width:100%; height:auto;" />
        <p><code>{nodeQrUrl}</code></p>
        <button type="button" onclick={async()=>{try {await navigator.clipboard.writeText(nodeQrContent);status='Содержимое QR скопировано.';}catch {nodeError='Не удалось скопировать содержимое QR.';}}}>{$i18n.text("Копировать содержимое QR")}</button>
        <button type="button" onclick={() => { nodeQr = ''; nodeQrUrl = ''; }}>{$i18n.text("Скрыть QR")}</button>
      </div>
    {/if}
    <h4>{$i18n.text("Серверы в интернете")}</h4>
    {#if !configuredNodes.some((node) => node.kind === 'internet')}<p>{$i18n.text("Публичный сервер пока не настроен. Эти LAN-адреса не являются интернет-серверами.")}</p>{/if}
      {#each nodeStates.filter((node) => node.kind === 'internet') as node}<p><code>{node.url}</code> · {$i18n.text(node.status)}</p>{/each}
    <details style="margin-top:12px;">
      <summary>{$i18n.text("Маршруты текущих соединений")}</summary>
      {#each Object.entries(peerRoutes) as [peer, url]}<p style="overflow-wrap:anywhere;"><strong>{contactName(peer)}</strong> → <code>{url}</code></p>{/each}
    </details>
  </div>
  {/if}
  {#if connectionSection === 'parameters'}
  <details class="settings-section"><summary>{$i18n.text("Дополнительный входящий ящик в LAN")}</summary>
    <HomeNodePanel {address} signer={() => endingSession ? null : identity} trusted={trustedSession}
      internetEnabled={networkSettings.internetEnabled !== false} mode="incoming" legacyOnly={true}
      {courierState} {courierError} {configureCourier} {courierStatus} waitingCount={courierWaiting}
      receivingReady={trustedSession && nodeStates.some(n => n.status === 'connected')}
      receiveKeys={courierState.keys.filter(k => k.expiresAt > Date.now()).length}
      offlineNode={offlineDeliveryState.node} offlineEnabled={offlineDeliveryState.enabled} offlineError={offlineDeliveryError}
      pendingCount={offlineDeliveryState.pending.length} configureOffline={configureOfflineDelivery} addSignaling={addNodeSignaling} />
  </details>
  {/if}
  {/if}

  {#if settingsSection === 'security'}
  <div class="settings-section">
    {#if savedLinkedDevice}<details><summary>{$i18n.text("Другие сохранённые входы в этом браузере")}</summary>
      <p class="help-text">{$i18n.text("Можно переключиться на отдельное ранее подключённое устройство. Текущий аккаунт останется сохранённым и будет заблокирован.")}</p>
      <button type="button" disabled={navigationBusy()} onclick={async () => { await endSession('lock', false); if (screen === 'unlock') newDeviceOpen = true; }}>{$i18n.text("Переключиться на сохранённое устройство")}</button></details>{/if}
    {#key address}<DeviceManager store={deviceStore ?? undefined}
      publish={async () => { if (!deviceRuntime) throw new Error('device_connection_required'); return deviceRuntime.publish(); }}
      invitation={deviceRuntime ? channel => deviceRuntime!.invitation(selfNickname, channel) : undefined} mode={deviceRuntime?.mode ?? 'direct'}
      transferContacts={deviceRuntime ? transferDeviceContacts : undefined} transferHistory={(device, label) => historyTarget = { device, label }} prepare={prepareDeviceLink} setupNode={setupDeviceNode}
      nodeUrl={deviceNodeCandidate(deviceSettings.authority, courierState.node, offlineDeliveryState.node)?.url ?? ''}
      connection={deviceStatus + (deviceErrorCode ? ` Код: ${deviceErrorCode}` : '')} connecting={deviceBusy} internetAllowed={networkSettings.internetEnabled !== false} />{/key}
    {#if historyTarget && chat && deviceStore}
      <CompactDialog title={$i18n.text("Перенос истории и вложений")} onClose={() => historyTarget = null}>
        {#key chat}{#key address + historyTarget.device}<HistorySend {chat} owner={address} device={historyTarget.device} label={historyTarget.label}
          conversations={sessionChats.order.map(peer => ({ peer, name: peer === address ? 'Сохранённые' : aliases[peer] || declaredNames[peer] || peer, count: sessionChats.byPeer[peer].messages.length }))}
          authorize={() => authorizeHistoryTarget(historyTarget!.device)} capture={captureHistory} onClose={() => historyTarget = null} />{/key}{/key}
      </CompactDialog>
    {/if}
    <details><summary>{$i18n.text("Дополнительный режим доступности")}</summary>
      <label><input type="checkbox" checked={deviceSettings.allowCached} onchange={async event => {
        deviceSettings = { ...deviceSettings, allowCached: event.currentTarget.checked }; await persistLocalChats();
      }} /> {$i18n.text("Использовать ранее проверенный список, если свежая проверка недоступна")}</label>
      <p class="help-text">{$i18n.text("Менее безопасно: отзыв устройства может стать известен позже. По умолчанию выключено.")}</p>
    </details>
  </div>
  <div class="settings-section">
    <h4>{$i18n.text("Резервные копии")}</h4>
    <p>{$i18n.text("Полная копия, только доступ к аккаунту или данные без сида. Бумажный сид остаётся доступен ниже.")}</p>
    {#if fullBackupOpen}
      {#key address}<FullBackup accountId={rootAccountId || address} dataAccountId={address} nickname={selfNickname}
        capture={exportFullData} readProfiles={exportProfiles} onIdentityVerified={confirmSeedBackup}
        restoreData={restoreDataArchive} onClose={() => fullBackupOpen = false} />{/key}
    {:else}
      <button type="button" disabled={!trustedSession || navigationBusy() || attachingFiles} onclick={() => fullBackupOpen = true}>{$i18n.text("Открыть резервные копии")}</button>
      {#if !trustedSession}<p class="help-text">{$i18n.text("Для полного экспорта включите доверенный режим, чтобы сохранить текущие данные.")}</p>{/if}
      <HelpInfo label={$i18n.text("Справка: восстановление резервной копии")} text={$i18n.text("Полная копия и копия доступа открываются на экране входа: «Восстановить аккаунт → Зашифрованный файл». Копия данных импортируется в уже открытый профиль через раздел резервных копий, только в пустую историю. Существующие чаты не перезаписываются.")} />
    {/if}
  </div>
  <div class="settings-section">
    {#if tabCoordinationUnsupported}<p role="alert" class="help-text">{$i18n.text("Браузер не поддерживает защиту от повторного входа во вкладках. Не открывайте этот аккаунт одновременно в нескольких вкладках.")}</p>{/if}
    <div class="setting-label">
      <span>{$i18n.text("Режим устройства:")} <strong>{trustedSession ? $i18n.text("доверенный") : $i18n.text("недоверенный")}</strong></span>
      <HelpInfo label={$i18n.text("Справка: режим устройства")} text={appHelp.trust} open={openHelp === 'trust'} onToggle={() => toggleHelp('trust')} />
    </div>
    <button onclick={switchTrustMode} disabled={authBusy || switchingTrust || endingSession || Boolean(pendingExit)}>
      {switchingTrust ? $i18n.text("Переключаем…") : trustedSession ? $i18n.text("Перейти в недоверенный режим") : $i18n.text("Сделать устройство доверенным")}
    </button>
  </div>
  {/if}

  {#if settingsSection === 'account'}
  {#if profileNetwork}<div class="settings-section">
    <AvatarEditor accountId={address} photo={selfAvatar} busy={avatarBusy || endingSession || switchingTrust || profileSwitchBusy || memoryBusy}
      error={avatarError} onChange={(file,crop) => void changeOwnAvatar(file,crop)} />
  </div>{/if}

  <div class="settings-section">
    <div class="setting-label">
      <label for="own-nickname">{$i18n.text("Ник")}</label>
      <HelpInfo label={$i18n.text("Справка: ник")} text={appHelp.nickname} open={openHelp === 'nickname'} onToggle={() => toggleHelp('nickname')} />
    </div>
    <div>
      <input id="own-nickname" bind:value={nicknameDraft} maxlength="32" placeholder={$i18n.text("Ваш ник")} aria-label={$i18n.text("Ваш ник")} />
      <button onclick={saveOwnNickname}>{$i18n.text("Сохранить ник")}</button>
    </div>
  </div>

  <details class="settings-section" bind:open={profileManagementOpen}><summary>{$i18n.text("Мои профили")}</summary>
    {#if profileManagementOpen}
    <ProfilesPanel accountId={rootAccountId || address} nickname={selfNickname} trusted={trustedSession} {activeProfileId} chatSwitching mode="manage"
      onChange={profileChanged} blocked={authBusy || endingSession || switchingTrust || memoryBusy || panicBusy || profileSwitchBusy} />
    {/if}
  </details>
  <details class="settings-section"><summary>{$i18n.text("Открытый ключ профиля")}</summary>
    <div class="setting-label">
      <button type="button" aria-expanded={publicKeyOpen} onclick={() => publicKeyOpen = !publicKeyOpen}>{publicKeyOpen ? $i18n.text("Скрыть открытый ключ") : $i18n.text("Показать открытый ключ")}</button>
      <HelpInfo label={$i18n.text("Справка: Public key")} text={appHelp.publicKey} open={openHelp === 'publicKey'} onToggle={() => toggleHelp('publicKey')} />
    </div>
    {#if publicKeyOpen}<code class="public-key">{publicKey}</code>{/if}
  </details>
  {/if}

  {#if settingsSection === 'security'}
  <div class="settings-section">
    <div class="setting-label">
      <h4>{$i18n.text("Пароль")}</h4>
      <HelpInfo label={$i18n.text("Справка: смена пароля")} text={appHelp.password} open={openHelp === 'password'} onToggle={() => toggleHelp('password')} />
    </div>
    <label class="settings-field">{$i18n.text("Текущий пароль")}<input type="password" name="current-password" autocomplete="current-password" bind:value={oldPassword} placeholder={$i18n.text("Текущий пароль")} aria-label={$i18n.text("Текущий пароль")} disabled={authBusy || switchingTrust || endingSession} /></label>
    <PasswordField id="change-password" label={$i18n.text("Новый пароль")} bind:value={newPassword} nickname={selfNickname} disabled={authBusy || switchingTrust || endingSession} />
    <label class="settings-field">{$i18n.text("Повторите новый пароль")}<input type="password" name="confirm-password" autocomplete="new-password" bind:value={confirmPassword} placeholder={$i18n.text("Повторите новый пароль")} aria-label={$i18n.text("Повторите новый пароль")} disabled={authBusy || switchingTrust || endingSession} /></label>
    <button class="primary" onclick={changePassword} disabled={authBusy || switchingTrust || endingSession}>{$i18n.text("Сменить пароль")}</button>
  </div>

  <div class="settings-section" id="seed-backup-section">
    <h4>{$i18n.text("Бумажная копия сида")}</h4>

    <div class="setting-label">
      <span>{$i18n.text("Seed-фраза")}</span>
      <HelpInfo label={$i18n.text("Справка: seed-фраза")} text={appHelp.seed} open={openHelp === 'seed'} onToggle={() => toggleHelp('seed')} />
    </div>

    {#if !seedBackupVerified}
      <p><span class="backup-warning" aria-hidden="true">!</span> {$i18n.text("Сделайте резервную копию seed-фразы.")}</p>
    {:else}
      <p><small>{$i18n.text("Запись seed-фразы проверена.")}</small></p>
    {/if}
    {#if backupOpen}
      {#if !trustedSession}<p class="help-text">{$i18n.text("В недоверенном режиме файл содержит только seed и ник. Чтобы сохранить ранее созданную связку профилей, включите доверенный режим и создайте файл заново.")}</p>{/if}
      <SeedBackup accountId={rootAccountId || address} nickname={selfNickname} readProfiles={exportProfiles} onSeedConsumed={() => {}} onVerified={confirmSeedBackup} onSkip={() => backupOpen = false} />
    {:else}
      <button type="button" onclick={() => { hideDisplayedSecrets(); status = ''; backupOpen = true; }}>{$i18n.text("Показать seed и проверить запись")}</button>
    {/if}
  </div>

  <details class="settings-section" bind:open={profileBackupOpen}><summary>{$i18n.text("Перенос и восстановление списка профилей")}</summary>
    {#if profileBackupOpen}
      <ProfilesPanel accountId={rootAccountId || address} nickname={selfNickname} trusted={trustedSession} {activeProfileId} mode="backup"
        onChange={profileChanged} blocked={authBusy || endingSession || switchingTrust || memoryBusy || panicBusy || profileSwitchBusy} />
    {/if}
  </details>
  <div class="settings-section">
    <div class="setting-label">
      <label for="auto-lock">{$i18n.text("Автоблокировка")}</label>
      <HelpInfo label={$i18n.text("Справка: автоблокировка")} text={appHelp.autoLock} open={openHelp === 'autoLock'} onToggle={() => toggleHelp('autoLock')} />
    </div>
    <ChoiceMenu id="auto-lock" value={autoLockMinutes} label={$i18n.text("Автоблокировка")} disabled={switchingTrust || endingSession}
      options={[{value:1,label:$i18n.text("Через 1 минуту")},{value:5,label:$i18n.text("Через 5 минут")},{value:15,label:$i18n.text("Через 15 минут")},{value:30,label:$i18n.text("Через 30 минут")},{value:60,label:$i18n.text("Через 1 час")},{value:0,label:$i18n.text("Не блокировать автоматически")}]}
      onChange={value=>void changeAutoLock(Number(value))} />
  </div>

  <div class="settings-section">
    <div class="setting-label">
      <span>{$i18n.text("Блокировка")}</span>
      <HelpInfo label={$i18n.text("Справка: блокировка")} text={appHelp.lock} open={openHelp === 'lock'} onToggle={() => toggleHelp('lock')} />
    </div>
    <button onclick={() => requestExit('lock')} disabled={endingSession || switchingTrust}>{$i18n.text("Заблокировать")}</button>

    <div class="setting-label" style="margin-top:12px;">
      <span>{$i18n.text("Выход")}</span>
      <HelpInfo label={$i18n.text("Справка: выход")} text={appHelp.logout} open={openHelp === 'logout'} onToggle={() => toggleHelp('logout')} />
    </div>
    <button onclick={() => requestExit('logout')} disabled={endingSession || switchingTrust}>{$i18n.text("Выйти из аккаунта")}</button>
  </div>

  {/if}

  </div>
  {:else}

  {#if !PROFILE_FEATURES.advancedInbox && !profileNetwork}
    <p>{$i18n.text("Выберите профиль в шапке или добавьте новый в настройках аккаунта. Сохранённые чаты не удалены.")}</p>
  {:else if PROFILE_FEATURES.advancedInbox && (allProfileChats || !profileNetwork) && profileRegistry && profileInboxViewer}
    <InboxSnapshot snapshot={profileInboxSnapshot} registry={profileRegistry} viewer={profileInboxViewer} onPage={requestInboxPage}
      onOpen={(id,peer) => { requestedProfilePeer = peer; requestedProfileId = id; }} />
    <button onclick={() => requestedProfileId = ALL_CHATS_VIEW}>{$i18n.text("Обновить все чаты")}</button>
    {#if profileNetwork}<button onclick={() => allProfileChats = false}>{$i18n("m_6617f28071a0", {v0: (profileRegistry.profiles.find(p => p.id === activeProfileId)?.name)})}</button>{/if}
  {:else}
  {#if PROFILE_FEATURES.advancedInbox && profileRegistry && activeProfileId && profileRegistry.connections.some(c => c.subId === activeProfileId && c.permission === 'read-all' && c.status === 'active' && c.validUntil > Math.max(Date.now(),profileRegistry!.lastNow))}
    <details><summary>{$i18n.text("Чаты других профилей · разрешённый просмотр")}</summary>
      <InboxSnapshot snapshot={profileInboxSnapshot} registry={profileRegistry} viewer={activeProfileId} onPage={requestInboxPage}
        onOpen={(id,peer) => { requestedProfilePeer = peer; requestedProfileId = id; }} />
    </details>
  {/if}
  <div class="chat-layout" class:show-chat={mobilePane === 'chat'} class:show-list={mobilePane === 'list'}>
    <nav class="conversation-list" aria-label={$i18n.text("Личные чаты")}>
      <ContactSearch bind:query={chatSearch} ownId={address} onOpen={(peer, route) => void addConversation(peer, route)} />
      <div class="conversation-items">
      {#each conversationItems as item (`${item.kind}:${item.id}`)}
        {#if item.kind==='radio'}{@const c=item.channel}{@const last=c.messages.at(-1)}
          <ConversationRow accountId={item.id} name={c.name||$i18n.text('По умолчанию')} conversation={nativeListConversation(c)} active={nativeOpen&&nativeSelected===item.id} onOpen={()=>openNativeChannels(item.id)}
            radio={{encryption:c.encryption,preview:last?.text||$i18n.text('Пока нет сообщений.'),status:last?.outgoing&&['queued','failed','unknown'].includes(last.status)?nativeMessageStatus(last).label:undefined}}/>
        {:else}
          <ConversationRow accountId={item.id} name={contactName(item.id)} photo={contactPhoto(item.id)} conversation={sessionChats.byPeer[item.id]}
            self={item.id===address} active={!nativeOpen&&sessionChats.activePeer===item.id} onOpen={()=>openConversation(item.id)} />
        {/if}
      {/each}
      {#if meshtastic.enabled&&meshtastic.channels.some(c=>!nativeLive.includes(nativeToken(c))&&c.messages.length)}<label class="native-saved-toggle"><input type="checkbox" checked={meshtastic.showAll} onchange={e=>void setNativePreferences({showAll:e.currentTarget.checked}).catch(error=>status=error.message)}/>{$i18n.text('Все сохранённые радиоканалы')}</label>{/if}
      {#if !conversationItems.length}<p>{$i18n.text(chatSearch?'Ничего не найдено.':'Пока нет собеседников.')}</p>{/if}
      </div>
    </nav>

    <section class="conversation-pane" class:drop-active={fileDragActive} use:fileDrop aria-label={$i18n.text("Выбранный чат")}>
      {#if fileDragActive}<div class="file-drop-hint" role="status">{$i18n.text("Отпустите файлы — они отправятся в этот чат")}</div>{/if}
      {#if nativeOpen}
        {#key nativeSelected}<MeshtasticChannels data={meshtastic} selected={nativeSelected} live={nativeLive} connected={radioConnection==='connected'} busy={nativeSending||radioBusy} board={radioBoardLabel} link={contactLink(address)} initialUnread={nativeInitialUnread} forwardDone={nativeForwardDone}
          onSignature={setNativeSignature} onSend={sendNativeText} onDelete={deleteNativeMessages} onDraft={setNativeDraft} onForward={openNativeForward} onBottom={nativeBottom}
          onSettings={()=>openConnectionSection('radio')} onBack={()=>{nativeOpen=false;showChatList();}}/>{/key}
      {:else if activeConversation}
        {#key activeConversation.peerAddress}
        <div class="chat-heading">
        <button class="chat-back" onclick={() => selecting ? backWithinApp() : showChatList()}
          aria-label={selecting ? $i18n.text("Отменить выбор сообщений") : $i18n("m_8b68da943cc0", {v0: (otherUnread ? $i18n("m_8600adcaf830", {v0: (otherUnread)}) : '')})}
          title={selecting ? $i18n.text("Отменить выбор") : $i18n.text("Все чаты")}>←
          {#if otherUnread}<span class="unread-badge" aria-hidden="true">{otherUnread > 99 ? '99+' : otherUnread}</span>{/if}
        </button>
        {#if selecting}
          <MessageSelectionBar messages={activeMessages} selected={selectedMessages} busy={actionBusy} onCopy={()=>void copySelection()}
            onToggleAll={toggleAllMessages} onForward={() => openChatAction('forward')}
            onDownload={() => void downloadSelection()} onDelete={() => openChatAction('delete')} />
        {:else}
        <button class="peer-heading" onclick={() => activeConversation.peerAddress === address ? changeAccountView('own') : openPeerCard(activeConversation.peerAddress)} title={$i18n.text("Открыть карточку")}>
          <Avatar accountId={activeConversation.peerAddress} photo={contactPhoto(activeConversation.peerAddress)} size={32} />
          <span>{contactName(activeConversation.peerAddress)}<br /><small class="peer-status">{activeConversation.peerAddress === address ? $i18n.text("Только на этом устройстве") : activeConversation.connection === 'connected' ? $i18n.text("● На связи") : activeConversation.connection === 'connecting' ? $i18n.text("Подключаемся…") : $i18n.text("○ Не в сети")}</small>{#if activeRadioNode}<RadioPresence heard={radioHeard[activeRadioNode]} now={keyBudgetNow} connected={radioConnection==='connected'}/>{/if}</span>
        </button>
        {#if isRoutineConnectionNotice(activeConversation.error)}
          <ConnectionNotice text={activeConversation.error} onRetry={() => void openDirectChat(activeConversation.peerAddress)} />
        {/if}
        {#if activeConversation.peerAddress !== address && activeConversation.contact === 'accepted'}
          <button class="select-messages-button" type="button" onclick={() => void startCall(activeConversation.peerAddress)}
            disabled={callBusy || voiceBusy || navigationBusy() || activeConversation.connection !== 'connected'}
            aria-label={$i18n.text("Позвонить")} title={activeConversation.connection === 'connected' ? $i18n.text("Голосовой звонок") : $i18n.text("Для звонка собеседник должен быть на связи")}><ChatIcon name="phone" /></button>
        {/if}
        <button class="select-messages-button" type="button" onclick={toggleChatSearch} aria-label={$i18n.text("Поиск в чате")} title={$i18n.text("Поиск по тексту или дате")}><ChatIcon name="search" /></button>
        <button class="select-messages-button" type="button" onclick={() => { selecting = true; selectedMessages = []; }} disabled={actionBusy}
          aria-label={$i18n.text("Выбрать сообщения")} title={$i18n.text("Выбрать сообщения")}><ChatIcon name="select" /></button>
        {/if}
        </div>
        {#if chatSearchOpen}<ChatSearch messages={activeMessages} onJump={jumpToMessage} onClose={toggleChatSearch} />{/if}
        {#key activeConversation.peerAddress}<ChatActivity messages={activeConversation.messages} onJump={jumpToMessage} onClear={()=>void clearQueueCounters(activeConversation.peerAddress)} />{/key}
        {#if activeConversation.error && !isRoutineConnectionNotice(activeConversation.error)}
          <p role="alert">{$i18n.text(activeConversation.error)}</p>
        {/if}
        {#if activeConversation.contact === 'pending'}
          <p>{$i18n("m_9fae4896de31", {v0: (contactName(activeConversation.peerAddress))})}</p>
          {#each activeConversation.messages as requestMessage (requestMessage.id)}
            {#if requestMessage.direction === 'incoming'}
              <div use:observeIncoming={{ peer: activeConversation.peerAddress, messageId: requestMessage.id }} style="border:1px solid var(--line); padding:10px; overflow-wrap:anywhere;">
                <small>{new Date(requestMessage.timestamp).toLocaleTimeString($uiLocale)}</small><br />
                <MessageText text={requestMessage.text} />
              </div>
            {/if}
          {/each}
          <button onclick={() => acceptRequest(activeConversation.peerAddress)}>{$i18n.text("Принять")}</button>
          <button onclick={() => blockRequest(activeConversation.peerAddress)}>{$i18n.text("Отклонить и заблокировать")}</button>
        {:else if activeConversation.contact === 'blocked'}
          <p>{$i18n.text("Этот адрес заблокирован. Новые сообщения не принимаются.")}</p>
          <button onclick={() => unblockContact(activeConversation.peerAddress)}>{$i18n.text("Разблокировать")}</button>
        {:else}
        {#if activeConversation.contact === 'new'}<p><small>{$i18n.text("Первое сообщение отправит запрос на переписку.")}</small></p>{/if}
        {#if activeConversation.contact === 'outgoing'}<p><small>{$i18n.text("Ждём, пока собеседник примет запрос.")}</small></p>{/if}
        {#if activePins.some(pin => pin.targetId)}
          <div class="pinned-messages" aria-label={$i18n.text("Закреплённые сообщения")}>
            {#each activePins.filter(pin => pin.targetId) as pin (pin.actor)}
              {@const original = activeMessages.find(message => message.id === pin.targetId)}
              <div class="pin-row">
                <button class="pin-link" onclick={() => jumpToMessage(pin.targetId!)} title={$i18n.text("Перейти к закреплённому сообщению")}>
                  <small>⌖ {pin.actor === address ? $i18n.text("Ваш закреп") : $i18n("m_b8b2240669c9", {v0: (contactName(pin.actor))})} {pin.control.direction === 'outgoing' && !['delivered', 'read'].includes(pin.control.delivery ?? '') && activeConversation.peerAddress !== address ? $i18n.text("· синхронизируется") : ''}</small>
                  <span>{original ? messagePreview(original) : activeConversation.deletedIds?.includes(pin.targetId!) ? $i18n.text("Сообщение удалено у вас") : $i18n.text("Сообщение пока отсутствует на этом устройстве")}</span>
                </button>
                {#if pin.actor === address}<button disabled={pinBusy} onclick={() => void pinMessage(null)} aria-label={$i18n.text("Снять мой закреп")} title={$i18n.text("Снять мой закреп")}>✕</button>{/if}
              </div>
            {/each}
          </div>
        {/if}
        <div class="message-history">
        <div class="message-scroll" data-chat-scroll use:manageChatScroll={{ peer: activeConversation.peerAddress, lastId: activeMessages.at(-1)?.id ?? '', openToken: chatOpenToken }}>
          {#each activeMessages as message,i (message.id)}
            {#if i===0||new Date(message.timestamp).toDateString()!==new Date(activeMessages[i-1].timestamp).toDateString()}<HistoryDivider timestamp={message.timestamp}/>{/if}
            {#if ordinaryUnreadBoundary===message.id}<HistoryDivider unread/>{/if}
            <div data-chat-message-id={message.id} use:observeIncoming={{ peer: activeConversation.peerAddress, messageId: message.id }}>
              {#if message.localCall}
                <CallHistoryCard record={message.localCall} disabled={callBusy || voiceBusy || navigationBusy() || activeConversation.connection !== 'connected' || activeConversation.contact !== 'accepted'}
                  onCall={() => void startCall(activeConversation.peerAddress)} onDelete={() => messageAction(message, 'delete')} />
              {:else}
              <MessageCard outgoing={message.direction === 'outgoing'} sticker={message.details?.media?.kind === 'sticker' && mediaCanOpen(message)} selecting={selecting} highlighted={highlightedMessage === message.id} selected={selectedMessages.includes(message.id)} busy={actionBusy || ephemeralOpening} preview={messagePreview(message)} onSelect={() => toggleMessage(message.id)} onBeginSelect={() => messageAction(message, 'select')}>
              {@const deliveryView = messageStatus(message, activeConversation.peerAddress === address, readReceiptsEnabled && peerReadPreferences[activeConversation.peerAddress] === true && activeConversation.contact === 'accepted')}
              {#if message.details?.ephemeral}
                {@const viewed = activeEphemeralStates.get(message.id)}
                {@const expired = ephemeralExpired(message, viewed, keyBudgetNow)}
                <small>{message.direction === 'outgoing' ? $i18n.text("Вы") : contactName(activeConversation.peerAddress)} · {new Date(message.timestamp).toLocaleTimeString($uiLocale, { hour:'2-digit', minute:'2-digit' })}</small>
                <p>{expired ? $i18n.text("◷ Сообщение исчезло") : message.file ? $i18n.text("◷ Исчезающее вложение") : $i18n.text("◷ Исчезающее сообщение")}</p>
                <small>{$i18n.text(ephemeralLabel(message))}</small>
                {#if !expired}
                  {#if message.direction === 'incoming'}<p><small>{$i18n.text("При открытии автор получит уведомление.")}</small></p>{/if}
                  <p><button onclick={() => void openEphemeral(activeConversation.peerAddress,message.id)} disabled={ephemeralOpening || activeConversation.contact !== 'accepted' || !!message.file && message.direction === 'incoming' && message.fileStatus !== 'ready'}>{message.direction === 'outgoing' && activeConversation.peerAddress !== address ? $i18n.text("Посмотреть свою копию") : $i18n("m_8eb8e1b1630c", {v0: (viewed && message.details.ephemeral.views ? $i18n("m_c27da7caa54a", {v0: (viewed.views)}) : '')})}</button></p>
                  {#if message.file && message.direction === 'incoming' && ['offered','failed'].includes(message.fileStatus ?? '')}<button onclick={() => acceptFile(activeConversation.peerAddress,message.id)}>{$i18n.text("Получить файл")}</button>{/if}
                {/if}
                <button onclick={() => messageAction(message,'delete')} disabled={ephemeralOpening || actionBusy} aria-label={$i18n.text("Удалить исчезающее сообщение у меня")}>{$i18n.text("Удалить у меня")}</button>
              {:else}
              <div class="message-header">
                <Avatar accountId={message.direction === 'outgoing' ? address : activeConversation.peerAddress}
                  photo={contactPhoto(message.direction === 'outgoing' ? address : activeConversation.peerAddress)} size={18} />
                <span class="message-author">{message.direction === 'outgoing' ? $i18n.text("Вы") : contactName(activeConversation.peerAddress)}</span>
                <time datetime={new Date(message.timestamp).toISOString()} title={new Date(message.timestamp).toLocaleString($uiLocale)}>{new Date(message.timestamp).toLocaleTimeString($uiLocale, { hour: '2-digit', minute: '2-digit' })}</time>
                <button class="quick-reply" type="button" onclick={() => startReply(message)} disabled={actionBusy || activeConversation.contact !== 'accepted'} aria-label={$i18n.text("Ответить на сообщение")} title={$i18n.text("Ответить")}>↩</button>
                <button class="quick-copy" type="button" onclick={() => void copyMessage(message)} aria-label={message.file ? $i18n.text("Скопировать название файла") : $i18n.text("Скопировать содержимое сообщения")} title={message.file ? $i18n.text("Скопировать название файла") : $i18n.text("Скопировать содержимое")}>{copiedMessageId === message.id ? '✓' : '⧉'}</button>
                {#if copiedMessageId === message.id}<span class="copy-feedback" role="status">{message.file ? $i18n.text("Название скопировано") : $i18n.text("Скопировано")}</span>{/if}
                <MessageTools {message} status={deliveryView} recipient={message.direction === 'outgoing' ? activeConversation.peerAddress : address}
                  courier={message.courierVia || (message.delivery === 'stored' ? courierState.pending.find(job => job.body.id === message.id && job.body.to === activeConversation.peerAddress)?.body.courier : undefined)}
                  shareText={message.details?.contactCard ? contactLink(message.details.contactCard.accountId) : message.text}
                  openView={messageTools?.id === message.id ? messageTools.view : null} disabled={actionBusy || memoryBusy || endingSession || switchingTrust || pinBusy}
                  canReply={activeConversation.contact === 'accepted'}
                  onCopy={()=>void copyMessage(message)} onOpen={(view) => messageTools = { id: message.id, view }} onClose={() => messageTools = null}
                  onReply={() => startReply(message)} onForward={() => messageAction(message, 'forward')} onSelect={() => messageAction(message, 'select')}
                  onCancelNode={!message.nodeQueue && courierState.pending.some(j=>j.body.id===message.id) ? ()=>void cancelNodeMessage(activeConversation.peerAddress,message.id) : undefined}
                  onRetryNode={message.nodeQueue && message.nodeQueue!=='canceling' ? ()=>void retryNodeMessage(activeConversation.peerAddress,message.id) : undefined}
                  onRetryRadio={radioContact&&radioEligible(message)&&activeConversation.contact==='accepted'?()=>void retryRadio(activeConversation.peerAddress,message.id):undefined}
                  onStop={() => void cancelFile(activeConversation.peerAddress, message.id).catch(() => status = 'Не удалось остановить передачу.')}
                  onDownload={() => downloadMessage(activeConversation.peerAddress, message)} onDelete={() => messageAction(message, 'delete')}
                  pinned={activePins.some(pin => pin.actor === address && pin.targetId === message.id)}
                  onPin={() => void pinMessage(activePins.some(pin => pin.actor === address && pin.targetId === message.id) ? null : message.id)}
                  loadShareFile={() => prepareMessageFile(activeConversation.peerAddress, message.id)} />
              </div>
              {#if message.details?.forwarded}
                <small class="forward-label" title={$i18n.text("Сведения об авторе указаны переславшим, не подтверждены подписью исходного автора")}>{$i18n.text("↪ Переслано")}
                  {#if message.details.forwarded.author}
                    {$i18n.text("от")} <button class="text-link" onclick={() => openPeerCard(message.details!.forwarded!.author!.accountId)}>{message.details.forwarded.author.nickname || message.details.forwarded.author.accountId.slice(0, 12) + '…'}</button>
                  {:else} {$i18n.text("· автор скрыт")}{/if}
                </small>
              {/if}
              {#if message.details?.reply}
                {@const quote = displayedReply(activeConversation.messages, message.details.reply)}
                <button class="reply-preview" onclick={() => jumpToMessage(message.details!.reply!.id)} title={$i18n.text("Перейти к исходному сообщению")}>
                  <small>↩ {quote.from === address ? $i18n.text("Вы") : contactName(quote.from)}</small>
                  <span>{quote.preview || $i18n.text("Сообщение")}</span>
                </button>
              {/if}
              {#if message.file}
                {@const compactMedia = autoReceiveFilesEnabled && mediaCanOpen(message) && inlineMediaFor(message.file) !== null}
                {#if !compactMedia}<strong>📎 {message.file.name}</strong> {$i18n("m_f8c74e7edc56", {v0: ((message.file.size / 1024).toFixed(1))})}{/if}
                {#if message.fileDeleted}
                  <br /><small>{$i18n.text("Файл удалён с этого устройства")}</small>
                {:else if message.direction === 'incoming' && (message.fileStatus === 'offered' || message.fileStatus === 'failed')}
                  <br /><button onclick={() => acceptFile(activeConversation.peerAddress, message.id)}>{message.fileStatus === 'failed' ? $i18n.text("Повторить") : $i18n.text("Принять файл")}</button>
                  <button onclick={() => rejectFile(activeConversation.peerAddress, message.id)}>{$i18n.text("Отклонить")}</button>
                {:else if message.direction === 'outgoing' && message.fileStatus === 'failed' && message.delivery !== 'stored'}
                  <button onclick={() => { courierDelivery?.wake(); void offerFile(activeConversation.peerAddress, message.id, chat!); }}>{$i18n.text("Повторить")}</button>
                {/if}
                {#if mediaCanOpen(message) && inlineMediaFor(message.file)?.kind === 'image'}
                  <button type="button" use:observeImage={{ peer: activeConversation.peerAddress, id: message.id }}
                    onclick={() => openGallery(activeConversation.peerAddress, message.id)}
                    aria-label={$i18n("m_931b83c229d4", {v0: (message.file.name)})}
                    class="message-image" class:message-sticker={message.details?.media?.kind === 'sticker'}>
                    {#if imageUrls[fileTransferKey(activeConversation.peerAddress, message.id)] && !imageErrors[fileTransferKey(activeConversation.peerAddress, message.id)]}
                      <img src={imageUrls[fileTransferKey(activeConversation.peerAddress, message.id)]}
                        alt={message.file.name} loading="lazy"
                        onerror={() => imageErrors = { ...imageErrors, [fileTransferKey(activeConversation.peerAddress, message.id)]: true }}
                        />
                    {:else if imageErrors[fileTransferKey(activeConversation.peerAddress, message.id)]}
                      {$i18n.text("Не удалось показать миниатюру")}
                    {:else}
                      {$i18n.text("🖼️ Открыть изображение")}
                    {/if}
                  </button>
                {:else if mediaCanOpen(message) && inlineMediaFor(message.file)?.kind === 'audio'}
                  {#if isQueueAudio(message)}
                    <button class="audio-track-button" onclick={() => playAudio(activeConversation.peerAddress,message.id)} aria-label={$i18n("m_ce9e80378dec", {v0: (message.file.name)})}>
                      <span aria-hidden="true">{audioTrack?.id === message.id && audioTrack?.peer === activeConversation.peerAddress ? '♫' : '▶'}</span> {message.file.name}
                    </button>
                  {:else}<InlineAudio load={() => verifiedMedia(activeConversation.peerAddress, message.id)} />{/if}
                {:else if mediaCanOpen(message) && inlineMediaFor(message.file)?.kind === 'video'}
                      <InlineVideo load={() => verifiedMedia(activeConversation.peerAddress, message.id)} autoplay={autoPlayVideoEnabled && !galleryId && !audioTrack && !callBusy} />
                  <button onclick={() => openGallery(activeConversation.peerAddress,message.id)}>{$i18n.text("⛶ Открыть видео")}</button>
                {/if}
                {#if mediaCanOpen(message) && !message.fileDeleted}
                  {#if message.details?.media?.kind === 'sticker-pack'}
                    <button disabled={mediaBusy} onclick={()=>void saveMessageMedia(activeConversation.peerAddress,message)}>{$i18n.text("Добавить набор")}</button>
                  {:else if message.details?.media?.kind !== 'sticker' && message.file.mime === 'image/gif'}
                    <button disabled={mediaBusy} onclick={()=>void saveMessageMedia(activeConversation.peerAddress,message)}>{$i18n.text("В GIF")}</button>
                  {/if}
                {/if}
              {:else if message.details?.radioContact}
                <RadioContactCard offer={message.details.radioContact} peer={message.from} outgoing={message.direction==='outgoing'} forwarded={!!message.details.forwarded}
                  network={radioRuntime?.crypto.contact.body.network??''} connected={radioConnection==='connected'}
                  active={message.direction==='incoming'&&activeRadioRoute&&radioState.routes[activeConversation.peerAddress]===message.details.radioContact.invite}
                  onAccept={()=>acceptChatRadioContact(activeConversation.peerAddress,message.id)} onSettings={()=>openConnectionSection('radio')}/>
              {:else if message.details?.contactCard}
                <div class="contact-message">
                  <Avatar accountId={message.details.contactCard.accountId} photo={contactPhoto(message.details.contactCard.accountId)} size={32} />
                  <strong>👤 {message.details.contactCard.nickname || $i18n.text("Контакт")}</strong>
                  <small>{message.details.contactCard.accountId}</small>
                  <button onclick={() => openPeerCard(message.details!.contactCard!.accountId)}>{$i18n.text("Карточка")}</button>
                  <button onclick={() => void addConversation(message.details!.contactCard!.accountId)}>{$i18n.text("Открыть чат")}</button>
                </div>
              {:else}
                <MessageText text={message.text} />
                {#if message.details?.media?.kind === 'pack-request' && message.direction === 'incoming'}
                  {@const requestedPack = mediaLibrary.packs.find(p=>p.id===message.details?.media?.packId)}
                  {#if requestedPack}<button disabled={mediaBusy || attachingFiles} onclick={()=>void answerPackRequest(requestedPack,activeConversation.peerAddress)}>{$i18n.text("Отправить набор")}</button>
                  {:else}<small>{$i18n.text("Этого набора нет в вашей библиотеке")}</small>{/if}
                {/if}
              {/if}
              {/if}
              {#if message.radioReception}<RadioReception reception={message.radioReception}/>{/if}
              <div class="message-actions">
                {#if replyCount(activeConversation.messages, message.id)}<small title={$i18n.text("Ответы в этой переписке")}>↩ {replyCount(activeConversation.messages, message.id)}</small>{/if}
                {#if message.forwardedTo?.length}<small title={$i18n.text("Число чатов, куда вы сами переслали сообщение")}>↪ {message.forwardedTo.length}</small>{/if}
                {#if message.direction === 'outgoing' || message.file}
                  <MessageDelivery status={deliveryView} provenance={messageProvenance(message)} onDetails={() => messageTools = { id: message.id, view: 'status' }} />
                {/if}
              </div>
              </MessageCard>
              {/if}
            </div>
          {/each}
        </div>
        {#if showJumpDown}<button class="jump-down" onclick={jumpToBottom} aria-label={$i18n.text("К последним сообщениям")} title={$i18n.text("К последним сообщениям")}><ChatIcon name="order-down" /></button>{/if}
        </div>
        {#if galleryId && galleryIndex >= 0}
          <MediaViewer id={galleryId} name={galleryItems[galleryIndex].file?.name ?? 'Медиа'}
            sticker={galleryItems[galleryIndex].details?.media?.kind === 'sticker' ? {
              packName: galleryItems[galleryIndex].details?.media?.packName,
              canRequest: galleryItems[galleryIndex].direction === 'incoming' && !!galleryItems[galleryIndex].details?.media?.packId && activeConversation.contact === 'accepted'
            } : undefined} onStickerAction={galleryStickerAction}
            fileInfo={{ size: galleryItems[galleryIndex].file!.size, mime: galleryItems[galleryIndex].file!.mime,
              timestamp: galleryItems[galleryIndex].timestamp,
              sender: galleryItems[galleryIndex].from === address ? 'Вы' : contactName(galleryItems[galleryIndex].from),
              senderAddress: galleryItems[galleryIndex].from }}
            kind={inlineMediaFor(galleryItems[galleryIndex].file!)?.kind === 'video' ? 'video' : 'image'}
            url={imageUrls[fileTransferKey(activeConversation.peerAddress,galleryId)]}
            failed={imageErrors[fileTransferKey(activeConversation.peerAddress,galleryId)]}
            index={galleryIndex} count={galleryItems.length} onMove={moveGallery} onClose={closeGallery}
            onAction={action => void galleryAction(action)} canReply={activeConversation.contact === 'accepted'}
            actionsDisabled={actionBusy || memoryBusy || endingSession || switchingTrust || pinBusy || attachingFiles || voiceBusy || mediaBusy} />
        {/if}
        {#if activeConversation.contact === 'new' || activeConversation.contact === 'accepted'}
        {#if replyDrafts[activeConversation.peerAddress]}
          <div class="composer-reply"><span>↩ {replyDrafts[activeConversation.peerAddress].preview}</span><button onclick={cancelReply} aria-label={$i18n.text("Отменить ответ")}>✕</button></div>
        {/if}
        {#if attachmentMenu}
          <div class="attachment-menu" role="region" aria-label={$i18n.text("Прикрепить")}>
            <button onclick={() => { attachmentMenu = false; attachmentInput?.click(); }}>{$i18n.text("📎 Файлы")}</button>
            <button onclick={()=>openMediaLibrary('gifs')}><span aria-hidden="true">🖼️</span> GIF</button>
            <button onclick={()=>openMediaLibrary('stickers')}><span aria-hidden="true">❤️</span> {$i18n.text("Стикеры")}</button>
            <button onclick={() => openChatAction('contact')}>{$i18n.text("👤 Контакт")}</button>
            {#if radioContact&&activeConversation.contact==='accepted'&&activeConversation.peerAddress!==address}<button class="radio-contact-action" title={$i18n.text('Отправить свой радиоконтакт')} aria-label={$i18n.text('Отправить свой радиоконтакт')} disabled={radioBusy} onclick={()=>void shareRadioContact(activeConversation.peerAddress).catch(error=>status=error.message)}><ChatIcon name="radio" /> LoRa</button>{/if}
          </div>
        {/if}
        {#snippet textComposer(microphone?: Snippet)}
        {#if sendOptionsOpen}<SendOptions value={sendRule} onSave={value => { sendRule = value; sendOptionsOpen = false; }} onClose={() => sendOptionsOpen = false} />{/if}
        {#if ephemeralView && ephemeralView.account === address && screen === 'account'}<EphemeralViewer message={ephemeralView.message} url={ephemeralView.url} deadline={ephemeralView.deadline} onClose={closeEphemeral} onDownload={downloadEphemeral} />{/if}
        {#if emojiOpen}<EmojiPicker onChoose={insertEmoji} onClose={() => emojiOpen = false} />{/if}
        <PastedImages files={pastedFiles} disabled={composerSending || attachingFiles} onRemove={index=>pastedFiles=pastedFiles.filter((_,i)=>i!==index)} />
        <div class="composer">
        <div class="composer-controls composer-left">
        {#if activeConversation.peerAddress !== address}
          <OfflineKeyBadge budget={activeKeyBudget} configured={offlineNodeConfigured}
            radioSelected={preferRadio} radioConnected={radioConnection==='connected'}
            connected={!!(courierState.enabled && courierState.node && courierStatus.connection === 'connected')}
            expanded={nodeBudgetOpen} onOpen={() => nodeBudgetOpen = true} />
        {/if}
        {#if activeConversation.contact === 'accepted'}
          <input class="attachment-input" bind:this={attachmentInput} type="file" multiple onchange={chooseFile} aria-label={$i18n.text("Выбрать файлы для отправки")} />
          <button type="button" class="icon-button" onclick={() => attachmentMenu = !attachmentMenu} disabled={switchingTrust || endingSession || attachingFiles || voiceBusy || actionBusy} title={$i18n.text("Прикрепить файл или контакт")} aria-label={$i18n.text("Прикрепить")} aria-expanded={attachmentMenu}><ChatIcon name="attachment" /></button>
        {/if}
        </div>
        <div class="composer-field">
        <textarea
          rows="1"
          value={activeConversation.draft}
          use:focusComposer={activeConversation.peerAddress}
          use:autoSizeComposer={activeConversation.draft}
          oninput={(event) => setDraft(activeConversation.peerAddress, event.currentTarget.value)}
          onkeydown={handleComposerKey}
          onpaste={pasteImage}
          onselect={rememberComposerCaret} onkeyup={rememberComposerCaret} onclick={rememberComposerCaret}
          placeholder={$i18n.text("Сообщение...")}
          data-message-composer aria-label={$i18n.text("Сообщение")}
          disabled={actionBusy || composerSending}
        ></textarea>
        <button class="emoji-toggle" type="button" onclick={() => emojiOpen = !emojiOpen} disabled={actionBusy || composerSending} aria-label={$i18n.text("Выбрать эмодзи")} aria-expanded={emojiOpen} title={$i18n.text("Эмодзи")}><ChatIcon name="emoji" /></button>
        </div>
        <div class="composer-controls composer-right">
        {#if activeConversation.contact === 'accepted'}
          {#if microphone}{@render microphone()}{/if}
        {/if}
        <button class="primary send-button" use:sendPress onclick={send} oncontextmenu={event => { event.preventDefault(); sendOptionsOpen = true; }} disabled={switchingTrust || actionBusy || composerSending || attachingFiles || activeConversation.sending || (!activeConversation.draft.trim() && !pastedFiles.length)}
          aria-label={activeConversation.sending ? $i18n.text("Отправляем сообщение") : $i18n.text("Отправить сообщение")} title={$i18n.text("Отправить · удерживайте для настроек")} aria-busy={activeConversation.sending}>
          <ChatIcon name="send" />
        </button>
        </div>
        </div>
        {/snippet}
        {#if activeConversation.contact === 'accepted'}
          {#key activeConversation.peerAddress}<VoiceMessage disabled={callBusy || switchingTrust || endingSession || attachingFiles || actionBusy || memoryBusy || profileSwitchBusy}
            onFile={async file => { const saved = await addAttachments([file],sendRule); if (saved) sendRule = undefined; return saved; }} onBusy={busy => voiceBusy = busy} onNotice={notice => voiceNotice = notice} idle={textComposer} />{/key}
        {:else}{@render textComposer()}{/if}
        {#if attachingFiles}<small role="status">{$i18n.text("Добавляем файлы в очередь…")}</small>{/if}
        {/if}
        {#if !trustedSession && activeConversation.messages.some((message) => message.delivery === 'queued' || message.delivery === 'sent')}
          <p><small>{$i18n.text("На недоверенном устройстве очередь исчезнет при закрытии вкладки.")}</small></p>
        {/if}
        {/if}
        {/key}
      {:else}
        <p>{$i18n.text("Добавьте собеседника или выберите чат.")}</p>
      {/if}
    </section>
  </div>

  {/if}
  {/if}
  </div>
  {#if textForward}<TextForwardDialog messages={textForward.messages} targets={textForwardTargets} onSend={sendForwardText} onClose={()=>textForward=null} onComplete={finishTextForward}/>{/if}
  {#if actionMode}
    <ChatActionDialog mode={actionMode} rows={actionRows} busy={actionBusy} error={actionError}
      onConfirm={(ids) => void confirmChatAction(ids)} onClose={() => { if (!actionBusy) actionMode = null; }} />
  {/if}
{/if}
</div>
