// ============================================================
// MeshAutonomy — ChatService
// Оркестрирует транспорт, подпись и верификацию сообщений.
// Верхний слой не знает про транспорт вообще.
// ============================================================

import { exportPublicKeyFromProvider, buildPayload, buildSignInput, generateId, isValidTransportMessage } from '$lib/message/envelope';
import type { Transport, TransportMessage, Peer, TransportStatus, TransportCapabilities } from '$lib/transport/transport';
import type { IdentityProvider } from '$lib/identity/identity';
import { bytesToHex } from '$lib/message/encoding';
import { verifySignedEnvelope } from '../core/envelopes';
import { webCryptoEnvironment } from '../core/ports';
import { SecureSessions } from './secure-session';
import { decodeFileChunk, encodeFileChunk, normalizeFileOffer, type FileOffer } from './file-transfer';
import { encodeChatContent, decodeChatContent, type MessageDetails } from './message-details';
import { normalizeAvatar } from './avatar';
import { CALL_PREFIX, decodeCallSignal, encodeCallSignal, type CallSignal } from '$lib/calls/protocol';

// ------------------------------------------------------------
// ChatMessage — то что видит UI
// ------------------------------------------------------------

export interface ChatMessage {
  id:        string;
  text:      string;
  from:      string;   // crypto address отправителя
  timestamp: number;
  verified:  boolean;  // подпись проверена
  via:       string;   // через какой транспорт пришло
  details?: MessageDetails;
  courierVia?: string;
}

// ------------------------------------------------------------
// Identity — минимальный контракт с identity модулем
// Не импортируем identity напрямую — передаём через init
// ------------------------------------------------------------

export interface ChatIdentity {
  address:  string;
  provider: IdentityProvider;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PENDING_INCOMING = 128;
const MAX_PENDING_INCOMING_BYTES = 2 * 1024 * 1024;
export type DeviceControlKind = 'roster' | 'packet' | 'policy-request' | 'policy-reply' | 'history';

// ------------------------------------------------------------
// ChatService
// ------------------------------------------------------------

export class ChatService {
  private transport: Transport;
  private identity: ChatIdentity | null = null;
  private generation = 0;
  private secureSessions: SecureSessions | null = null;
  private sendQueues = new Map<string, Promise<void>>();
  private receiveQueues = new Map<string, Promise<void>>();
  private incomingCount = 0;
  private incomingBytes = 0;
  private securePeers = new Set<string>();
  private peerEpochs = new Map<string, number>();
  private connectionWaiters = new Set<() => void>();

  private messageHandlers:      Array<(msg: ChatMessage) => unknown> = [];
  private receiptHandlers:      Array<(peer: string, messageId: string) => void> = [];
  private offlineBundleHandlers: Array<(peer: string, value: unknown) => unknown> = [];
  private courierBundleHandlers: Array<(peer: string, value: unknown) => unknown> = [];
  private deviceHandlers: Array<(peer: string, kind: DeviceControlKind, value: unknown) => unknown> = [];
  private contactAcceptedHandlers: Array<(peer: string) => void> = [];
  private readPreferenceHandlers: Array<(peer: string, enabled: boolean) => void> = [];
  private readReceiptHandlers: Array<(peer: string, messageId: string) => void> = [];
  private fileOfferHandlers: Array<(peer: string, offer: FileOffer) => unknown> = [];
  private fileControlHandlers: Array<(peer: string, id: string, action: 'accept' | 'reject' | 'received' | 'cancel') => unknown> = [];
  private fileChunkHandlers: Array<(peer: string, id: string, index: number, chunk: Uint8Array) => unknown> = [];
  private profileHandlers:      Array<(accountId: string, nickname: string) => void> = [];
  private avatarHandlers: Array<(accountId: string, avatar: string) => void> = [];
  private callHandlers: Array<(peer: string, signal: CallSignal) => unknown> = [];
  private disconnectHandlers: Array<() => void> = [];
  private peerIdentityHandlers: Array<(accountId: string, publicKey: string) => void> = [];
  private statusHandlers:       Array<(status: TransportStatus) => void> = [];
  private peerChangeHandlers:   Array<(peer: Peer, event: 'joined' | 'left') => void> = [];
  private capabilityHandlers:   Array<(caps: TransportCapabilities) => void> = [];

  constructor(transport: Transport) {
    // Composition root chooses the implementation; core only knows the contract.
    this.transport = transport;
  }

  // ----------------------------------------------------------
  // Инициализация
  // ----------------------------------------------------------

  async init(identity: ChatIdentity): Promise<void> {
    if (this.identity) throw new Error('already_initialized');
    const generation = ++this.generation;
    const current = () => this.generation === generation && this.identity === identity;
    this.identity = identity;
    this.secureSessions = new SecureSessions(
      identity.address,
      (peer, frame) => this.sendSigned(frame, peer, undefined, generation),
      (peer) => {
        if (!current()) return;
        this.securePeers.add(peer);
        const onlinePeer: Peer = { address: peer, transport: this.transport.capabilities.type, lastSeen: Date.now() };
        for (const h of this.peerChangeHandlers) h(onlinePeer, 'joined');
      },
    );

    // Пробрасываем события транспорта наружу
    this.transport.onStatusChange((status) => {
      if (!current()) return;
      for (const h of this.statusHandlers) h(status);
    });

    this.transport.onPeerChange((peer, event) => {
      if (!current()) return;
      if (event === 'left') {
        this.peerEpochs.set(peer.address,(this.peerEpochs.get(peer.address) ?? 0) + 1);
        // Old asynchronous work remains guarded by its captured epoch. It must
        // not hold the fresh connection's send/verification queues hostage.
        this.sendQueues.delete(peer.address); this.receiveQueues.delete(peer.address);
        this.securePeers.delete(peer.address);
        this.secureSessions?.drop(peer.address);
        for (const h of this.peerChangeHandlers) h(peer, 'left');
      } else {
        // A failed authenticated handshake never exposes a plaintext fallback.
        void this.secureSessions?.start(peer.address).catch(() => {});
      }
    });

    this.transport.onMessage((msg) => {
      if (!current()) return;
      // Authenticate sequentially, but do not let a peer build an unbounded
      // backlog of costly signature checks. Dropped frames receive no receipt.
      if (!isValidTransportMessage(msg) || msg.to !== identity.address ||
          msg.payload.byteLength > this.transport.capabilities.maxMessageBytes) return;
      const size = msg.payload.byteLength + msg.signature.byteLength;
      if (this.incomingCount >= MAX_PENDING_INCOMING || this.incomingBytes + size > MAX_PENDING_INCOMING_BYTES) return;
      const snapshot: TransportMessage = {
        from: msg.from, to: msg.to, timestamp: msg.timestamp, messageId: msg.messageId, ttl: msg.ttl,
        payload: msg.payload.slice(), signature: msg.signature.slice(),
      };
      this.incomingCount++; this.incomingBytes += size;
      const previous = this.receiveQueues.get(snapshot.from) ?? Promise.resolve();
      const peerEpoch = this.peerEpochs.get(snapshot.from) ?? 0;
      const next = previous.then(() => this.handleIncoming(snapshot, generation,peerEpoch));
      this.receiveQueues.set(snapshot.from, next);
      const cleanup = () => {
        if (!current()) return;
        this.incomingCount--; this.incomingBytes -= size;
        if (this.receiveQueues.get(snapshot.from) === next) this.receiveQueues.delete(snapshot.from);
      };
      void next.then(cleanup, cleanup);
    });

    const publicKey = await exportPublicKeyFromProvider(identity.provider);
    this.requireCurrent(generation);
    await this.transport.init(identity.address, {
      publicKey,
      sign: (data) => identity.provider.sign(data),
    });
    this.requireCurrent(generation);
  }

  private requireCurrent(generation: number): void {
    if (generation !== this.generation || !this.identity || !this.secureSessions) throw new Error('chat_session_closed');
  }
  private requirePeerCurrent(peer: string, epoch: number, generation: number): void {
    this.requireCurrent(generation);
    if ((this.peerEpochs.get(peer) ?? 0) !== epoch) throw new Error('secure_session_closed');
  }

  // ----------------------------------------------------------
  // Подключение к пиру
  // ----------------------------------------------------------

  async connect(peerAddress: string): Promise<void> {

    if (!this.identity) throw new Error('not_initialized');
    await this.transport.connect({
      address:   peerAddress,
      transport: this.transport.capabilities.type,
      lastSeen:  Date.now(),
    });
  }

  async disconnect(): Promise<void> {
    for (const cancel of this.connectionWaiters) cancel();
    for (const handler of this.disconnectHandlers) { try { handler(); } catch { /* Optional UI teardown must not retain a secure chat session. */ } }
    this.generation++;
    this.secureSessions?.close();
    this.secureSessions = null;
    this.identity = null;
    this.securePeers.clear();
    this.peerEpochs.clear();
    this.sendQueues.clear();
    this.receiveQueues.clear();
    this.incomingCount = 0; this.incomingBytes = 0;
    await this.transport.disconnect();
  }

  /** Transport connect may return before WebRTC and MAE authentication finish. */
  async connectAndWait(peerAddress: string, timeoutMs = 12000): Promise<void> {
    if (!this.identity) throw new Error('not_initialized');
    if (this.securePeers.has(peerAddress)) return;
    const generation = this.generation;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true; clearTimeout(timer); off(); this.connectionWaiters.delete(cancel);
        error ? reject(error) : resolve();
      };
      const off = this.onPeerChange((peer, event) => {
        if (peer.address === peerAddress && event === 'joined') finish();
      });
      const timer = setTimeout(() => finish(new Error('peer_unreachable')), timeoutMs);
      const cancel = () => finish(new Error('chat_session_closed'));
      this.connectionWaiters.add(cancel);
      void this.connect(peerAddress).catch(finish);
    });
    this.requireCurrent(generation);
  }

  // ----------------------------------------------------------
  // Отправка сообщения
  // ----------------------------------------------------------

  async send(text: string, toPeerAddress: string, messageId: string = generateId(), details?: MessageDetails): Promise<void> {
    if (!UUID_RE.test(messageId)) {
      throw new Error('invalid_message_id');
    }
    await this.sendPayload(encodeChatContent(text, details), toPeerAddress, messageId);
  }

  async sendProfile(nickname: string, toPeerAddress: string): Promise<void> {
    const cleaned = nickname.trim();
    if (cleaned.length > 32 || /[\u0000-\u001f\u007f]/.test(cleaned)) throw new Error('invalid_nickname');
    await this.sendPayload(`\u0000mesh-profile-v1:${cleaned}`, toPeerAddress);
  }

  async sendAvatar(avatar: string, peer: string): Promise<void> {
    if (avatar !== '' && !normalizeAvatar(avatar)) throw new Error('invalid_avatar');
    await this.sendPayload(`\u0000mesh-avatar-v1:${avatar}`, peer);
  }

  onAvatar(cb: (accountId: string, avatar: string) => void): void { this.avatarHandlers.push(cb); }

  async sendCall(signal: CallSignal, peer: string): Promise<void> {
    await this.sendPayload(encodeCallSignal(signal), peer);
  }

  onCall(handler: (peer: string, signal: CallSignal) => unknown): void { this.callHandlers.push(handler); }
  onDisconnect(handler: () => void): void { this.disconnectHandlers.push(handler); }

  async sendOfflineBundle(value: unknown, peer: string): Promise<void> {
    const json = JSON.stringify(value);
    if (json.length > 12000) throw new Error('offline_bundle_limit');
    await this.sendPayload(`\u0000automesh-prekeys-v1:${json}`, peer);
  }

  onOfflineBundle(handler: (peer: string, value: unknown) => unknown): void { this.offlineBundleHandlers.push(handler); }

  async sendCourierBundle(value: unknown, peer: string): Promise<void> {
    const json = JSON.stringify(value);
    if (json.length > 12000) throw new Error('courier_bundle_limit');
    await this.sendPayload(`\u0000automesh-courier-keys-v1:${json}`, peer);
  }
  onCourierBundle(handler: (peer: string, value: unknown) => unknown): void { this.courierBundleHandlers.push(handler); }
  async sendDeviceControl(kind: DeviceControlKind, value: unknown, peer: string): Promise<void> {
    const json = JSON.stringify(value);
    if (new TextEncoder().encode(json).length > 60000) throw new Error('device_control_limit');
    await this.sendPayload(`\u0000automesh-devices-v2:${kind}:${json}`, peer);
  }
  onDeviceControl(handler: (peer: string, kind: DeviceControlKind, value: unknown) => unknown): () => void {
    this.deviceHandlers.push(handler); return () => { this.deviceHandlers = this.deviceHandlers.filter(h => h !== handler); };
  }

  async sendContactAccepted(toPeerAddress: string): Promise<void> {
    await this.sendPayload('\u0000mesh-contact-accepted-v1', toPeerAddress);
  }

  async sendReadPreference(enabled: boolean, toPeerAddress: string): Promise<void> {
    await this.sendPayload(`\u0000mesh-read-preference-v1:${enabled ? '1' : '0'}`, toPeerAddress);
  }

  async sendReadReceipt(messageId: string, toPeerAddress: string): Promise<void> {
    if (!UUID_RE.test(messageId)) throw new Error('invalid_message_id');
    await this.sendPayload(`\u0000mesh-read-receipt-v1:${messageId}`, toPeerAddress);
  }

  async sendFileOffer(offer: FileOffer, toPeerAddress: string): Promise<void> {
    const valid = normalizeFileOffer(offer);
    if (!valid) throw new Error('invalid_file_offer');
    await this.sendPayload(`${valid.details?.ephemeral ? '\u0000mesh-file-offer-v2:' : '\u0000mesh-file-offer-v1:'}${JSON.stringify(valid)}`, toPeerAddress);
  }

  async sendFileControl(action: 'accept' | 'reject' | 'received' | 'cancel', id: string, toPeerAddress: string): Promise<void> {
    if (!UUID_RE.test(id)) throw new Error('invalid_file_id');
    await this.sendPayload(`\u0000mesh-file-${action}-v1:${id}`, toPeerAddress);
  }

  async sendFileChunk(id: string, index: number, bytes: Uint8Array, toPeerAddress: string): Promise<void> {
    await this.sendPayload(encodeFileChunk(id, index, bytes), toPeerAddress);
  }

  private async sendPayload(content: string | Uint8Array, toPeerAddress: string, messageId?: string): Promise<void> {
    if (!this.identity || !this.secureSessions) throw new Error('not_initialized');
    // Saved messages are committed locally. There can be no MAE handshake
    // with ourselves; waiting for one can hold an entire publisher actor.
    if (toPeerAddress === this.identity.address) throw new Error('invalid_peer_address');
    const generation = this.generation;
    const peerEpoch = this.peerEpochs.get(toPeerAddress) ?? 0;
    const sessions = this.secureSessions;
    const previous = this.sendQueues.get(toPeerAddress) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      this.requirePeerCurrent(toPeerAddress,peerEpoch,generation);
      const plaintext = typeof content === 'string' ? new TextEncoder().encode(content) : content;
      try {
        const ciphertext = await sessions.encrypt(toPeerAddress, plaintext);
        this.requirePeerCurrent(toPeerAddress,peerEpoch,generation);
        await this.sendSigned(ciphertext, toPeerAddress, messageId, generation);
      } finally { plaintext.fill(0); }
    });
    this.sendQueues.set(toPeerAddress, next);
    try {
      await next;
    } finally {
      if (this.sendQueues.get(toPeerAddress) === next) this.sendQueues.delete(toPeerAddress);
    }
  }

  private async sendSigned(contentBytes: Uint8Array, toPeerAddress: string, messageId?: string, generation = this.generation): Promise<void> {
    this.requireCurrent(generation);
    const peerEpoch = this.peerEpochs.get(toPeerAddress) ?? 0;
    const identity = this.identity!;

    const id        = messageId ?? generateId();
    const timestamp = Date.now();

    // The existing identity signature authenticates the encrypted frame or handshake.
    const toSign    = buildSignInput(contentBytes, timestamp, id, identity.address, toPeerAddress);
    const signature = await identity.provider.sign(toSign);
    this.requirePeerCurrent(toPeerAddress,peerEpoch,generation);

    // 3. Экспортируем publicKey для верификации на приёмной стороне
    const pubKeyBytes = await exportPublicKeyFromProvider(identity.provider);
    this.requirePeerCurrent(toPeerAddress,peerEpoch,generation);

    const payload = buildPayload(pubKeyBytes, contentBytes);

    // 5. Собираем TransportMessage
    const transportMsg: TransportMessage = {
      to:        toPeerAddress,
      from:      identity.address,
      payload,
      signature,
      timestamp,
      messageId: id,
      ttl:       7,   // reserved wire field; multi-hop mesh is not implemented
    };

    await this.transport.send(transportMsg);
  }

  // ----------------------------------------------------------
  // Входящие сообщения
  // ----------------------------------------------------------

  private async handleIncoming(msg: TransportMessage, generation: number, peerEpoch = this.peerEpochs.get(msg.from) ?? 0): Promise<void> {
    let textBytes: Uint8Array | null | undefined;
    try {
      this.requirePeerCurrent(msg.from,peerEpoch,generation);
      const sessions = this.secureSessions!;
      if (!this.identity || !isValidTransportMessage(msg)) {

        return;
      }

      if (msg.to !== this.identity.address) {

        return;
      }

      if (msg.payload.byteLength > this.transport.capabilities.maxMessageBytes) {

        return;
      }

      const { from, messageId, timestamp, publicKey: pubKeyBytes, encryptedFrame } = await verifySignedEnvelope(
        msg, this.identity.address, webCryptoEnvironment(), this.transport.capabilities.maxMessageBytes);
      this.requirePeerCurrent(from,peerEpoch,generation);

      // No old plaintext frame is accepted: a missing E2EE session fails closed.
      textBytes = await sessions.receive(from, encryptedFrame);
      this.requirePeerCurrent(from,peerEpoch,generation);
      this.requireCurrent(generation);
      for (const handler of this.peerIdentityHandlers) handler(from, bytesToHex(pubKeyBytes));
      if (!textBytes) return;
      const fileChunk = decodeFileChunk(textBytes);
      if (fileChunk) {
        for (const handler of this.fileChunkHandlers) { this.requireCurrent(generation); await handler(from, fileChunk.id, fileChunk.index, fileChunk.bytes); }
        return;
      }
      const content = new TextDecoder().decode(textBytes);
      if (content.startsWith('\u0000automesh-devices-v2:')) {
        if (textBytes.length > 60080) throw new Error('device_control_limit');
        const prefix = '\u0000automesh-devices-v2:', rest = content.slice(prefix.length), colon = rest.indexOf(':');
        const kind = rest.slice(0, colon);
        if (colon < 0 || kind !== 'roster' && kind !== 'packet' && kind !== 'policy-request' && kind !== 'policy-reply' && kind !== 'history') return;
        const value = JSON.parse(rest.slice(colon + 1));
        for (const handler of this.deviceHandlers) { this.requireCurrent(generation); await handler(from, kind, value); }
        return;
      }
      if (content.startsWith(CALL_PREFIX)) {
        const signal = decodeCallSignal(content);
        if (!signal) return;
        for (const handler of this.callHandlers) { this.requireCurrent(generation); await handler(from, signal); }
        return;
      }
      if (content.startsWith('\u0000automesh-prekeys-v1:')) {
        if (content.length > 12040) throw new Error('offline_bundle_limit');
        const value = JSON.parse(content.slice('\u0000automesh-prekeys-v1:'.length));
        for (const handler of this.offlineBundleHandlers) { this.requireCurrent(generation); await handler(from, value); }
        return;
      }
      if (content.startsWith('\u0000automesh-courier-keys-v1:')) {
        if (content.length > 12040) throw new Error('courier_bundle_limit');
        const value = JSON.parse(content.slice('\u0000automesh-courier-keys-v1:'.length));
        for (const handler of this.courierBundleHandlers) { this.requireCurrent(generation); await handler(from, value); }
        return;
      }
      if (content.startsWith('\u0000mesh-file-offer-v1:') || content.startsWith('\u0000mesh-file-offer-v2:')) {
        let raw: unknown;
        try { raw = JSON.parse(content.slice('\u0000mesh-file-offer-v1:'.length)); }
        catch { throw new Error('invalid_file_offer_json'); }
        const offer = normalizeFileOffer(raw);
        if (!offer || content.startsWith('\u0000mesh-file-offer-v2:') !== !!offer.details?.ephemeral) throw new Error('invalid_file_offer');
        for (const handler of this.fileOfferHandlers) { this.requireCurrent(generation); await handler(from, offer); }
        return;
      }
      for (const action of ['accept', 'reject', 'received', 'cancel'] as const) {
        const prefix = `\u0000mesh-file-${action}-v1:`;
        if (!content.startsWith(prefix)) continue;
        const id = content.slice(prefix.length);
        if (!UUID_RE.test(id)) throw new Error('invalid_file_id');
        for (const handler of this.fileControlHandlers) { this.requireCurrent(generation); await handler(from, id, action); }
        return;
      }
      if (content.startsWith('\u0000mesh-receipt-v1:')) {
        const receivedId = content.slice('\u0000mesh-receipt-v1:'.length);
        if (UUID_RE.test(receivedId)) {
          for (const handler of this.receiptHandlers) handler(from, receivedId);
        }
        return;
      }
      if (content === '\u0000mesh-contact-accepted-v1') {
        for (const handler of this.contactAcceptedHandlers) handler(from);
        return;
      }
      if (content === '\u0000mesh-read-preference-v1:1' || content === '\u0000mesh-read-preference-v1:0') {
        for (const handler of this.readPreferenceHandlers) handler(from, content.endsWith(':1'));
        return;
      }
      if (content.startsWith('\u0000mesh-read-receipt-v1:')) {
        const readId = content.slice('\u0000mesh-read-receipt-v1:'.length);
        if (UUID_RE.test(readId)) for (const handler of this.readReceiptHandlers) handler(from, readId);
        return;
      }
      if (content.startsWith('\u0000mesh-profile-v1:')) {
        const nickname = content.slice('\u0000mesh-profile-v1:'.length);
        if (nickname.length <= 32 && !/[\u0000-\u001f\u007f]/.test(nickname)) {
          for (const handler of this.profileHandlers) handler(from, nickname);
        }
        return;
      }
      if (content.startsWith('\u0000mesh-avatar-v1:')) {
        const avatar = content.slice('\u0000mesh-avatar-v1:'.length);
        if (avatar === '' || normalizeAvatar(avatar)) for (const handler of this.avatarHandlers) handler(from, avatar);
        return;
      }
      const decoded = decodeChatContent(content);
      if (!decoded) return;
      const { text, details } = decoded;

      const chatMsg: ChatMessage = {
        id:        messageId,
        text,
        from,
        timestamp,
        verified: true,
        via:       this.transport.capabilities.type,
        ...(details ? { details } : {}),
      };

      // Acknowledge only after the receiving app accepted the message. A retry
      // keeps the same ID but has fresh session ciphertext; the UI deduplicates it.
      for (const h of this.messageHandlers) { this.requireCurrent(generation); await h(chatMsg); }
      this.requireCurrent(generation);
      await this.sendPayload(`\u0000mesh-receipt-v1:${messageId}`, from);

    } catch {
      // Fail closed: invalid frames are neither displayed nor acknowledged.
    } finally { textBytes?.fill(0); }
  }

  // ----------------------------------------------------------
  // Подписки для UI
  // ----------------------------------------------------------

  onMessage(cb: (msg: ChatMessage) => unknown): void {
    this.messageHandlers.push(cb);
  }

  onReceipt(cb: (peer: string, messageId: string) => void): void {
    this.receiptHandlers.push(cb);
  }

  onContactAccepted(cb: (peer: string) => void): void {
    this.contactAcceptedHandlers.push(cb);
  }

  onReadPreference(cb: (peer: string, enabled: boolean) => void): void {
    this.readPreferenceHandlers.push(cb);
  }

  onReadReceipt(cb: (peer: string, messageId: string) => void): void {
    this.readReceiptHandlers.push(cb);
  }

  onFileOffer(cb: (peer: string, offer: FileOffer) => unknown): void {
    this.fileOfferHandlers.push(cb);
  }

  onFileControl(cb: (peer: string, id: string, action: 'accept' | 'reject' | 'received' | 'cancel') => unknown): void {
    this.fileControlHandlers.push(cb);
  }

  onFileChunk(cb: (peer: string, id: string, index: number, chunk: Uint8Array) => unknown): void {
    this.fileChunkHandlers.push(cb);
  }

  onProfile(cb: (accountId: string, nickname: string) => void): void {
    this.profileHandlers.push(cb);
  }

  onPeerIdentity(cb: (accountId: string, publicKey: string) => void): void {
    this.peerIdentityHandlers.push(cb);
  }

  onStatusChange(cb: (status: TransportStatus) => void): void {
    this.statusHandlers.push(cb);
  }

  onPeerChange(cb: (peer: Peer, event: 'joined' | 'left') => void): () => void {
    this.peerChangeHandlers.push(cb); return () => { this.peerChangeHandlers = this.peerChangeHandlers.filter(h => h !== cb); };
  }

  // ----------------------------------------------------------
  // Состояние
  // ----------------------------------------------------------

  getStatus(): TransportStatus {
    return this.transport.getStatus();
  }

  getCapabilities(): TransportCapabilities {
    return this.transport.capabilities;
  }

  async getKnownPeers(): Promise<Peer[]> {
    return this.transport.discover();
  }
}
