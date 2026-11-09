import { encodeMessage, decodeMessage } from '$lib/message/transport-codec';
import { defaultStunServers } from './client-config';
// ============================================================
// MeshAutonomy — WebRTCTransport
// ============================================================

import {
  type Transport,
  type TransportCapabilities,
  type TransportMessage,
  type TransportStatus,
  type Peer,
  type TransportRegistrationIdentity,
  TRANSPORT_CAPABILITIES,
} from './transport';
import { registrationProofBytes } from './registration-proof.js';
import { bytesToHex } from '$lib/message/encoding';
import { isValidAccountId } from '$lib/addressing/bech32m.js';
import { defaultSignalingEndpoints, isLocalHost, type SignalingEndpoint } from './client-config';
import type { CourierDelivery, CourierReply } from '$lib/node/courier-controller';
import { ATTACHMENT_PROTOCOL, validAttachmentChunk } from '$lib/node/attachment-protocol.js';
import { unbase64 } from '$lib/node/offline-crypto';

type SignalingMessage =
  | { type: 'register';     address: string }
  | { type: 'register_challenge'; address: string; challenge: string }
  | { type: 'register_proof'; address: string; publicKey: string; signature: string }
  | { type: 'watch_peer'; to: string }
  | { type: 'connect_request'; to: string; from: string }
  | { type: 'offer';        to: string; from: string; attemptId: string; sdp: RTCSessionDescriptionInit }
  | { type: 'answer';       to: string; from: string; attemptId: string; sdp: RTCSessionDescriptionInit }
  | { type: 'candidate';    to: string; from: string; attemptId: string; candidate: RTCIceCandidateInit }
  | { type: 'peer_online';  address: string }
  | { type: 'peer_offline'; address: string }
  | { type: 'registered'; address: string; iceMode?: 'lan'; registryId?: string; attachmentProtocol?: string }
  | { type: 'peer_unavailable'; address: string; attemptId: string }
  | ({ type: 'courier_delivery'; to: string } & CourierDelivery)
  | { type: 'courier_receipt'; to: string; id: string; receipt: string }
  | { type: 'courier_file_request'; to: string; request: Parameters<NonNullable<CourierReply['chunk']>>[0] }
  | { type: 'courier_file_chunk'; from: string; to: string; id: string; index: number; requestId: string; cipher: string }
  | { type: 'error'; reason: string };

type QueuedSend = {
  encoded: ArrayBuffer;
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const CHANNEL_TIMEOUT_MS = 15_000;
const LAN_ICE_GATHER_TIMEOUT_MS = 3_000;
const MAX_QUEUED_MESSAGES = 32;
const MAX_QUEUED_BYTES = 256 * 1024;
const MAX_PENDING_CANDIDATES = 64;
const MAX_PEER_RECONNECT_ATTEMPTS = 3;
const CHANNEL_BUFFER_HIGH = 512 * 1024;
const CHANNEL_BUFFER_LOW = 128 * 1024;

export class WebRTCTransport implements Transport {
  readonly capabilities: TransportCapabilities = TRANSPORT_CAPABILITIES.webrtc;

  private signalingUrl: string;
  private endpoints: SignalingEndpoint[];
  private endpointIndex = 0;
  private signalingAttempt: Promise<void> | null = null;
  private preferredTimer: ReturnType<typeof setTimeout> | null = null;
  private preferredProbe: WebSocket | null = null;
  private cancelSignalingAttempt: (() => void) | null = null;
  private readonly onNetworkOnline = () => {
    if (!this.shouldReconnect) return;
    if (!this.ws) { this.cancelReconnect(); this.scheduleReconnect(); }
    // navigator.onLine is a hint, not proof that either node is reachable.
  };
  private lanIceMode = import.meta.env.VITE_MESH_ICE_MODE === 'lan';
  private ws: WebSocket | null = null;
  private signalingReady = false;
  private myAddress: string = '';
  private registrationIdentity: TransportRegistrationIdentity | null = null;

  private connections = new Map<string, RTCPeerConnection>();
  private channels    = new Map<string, RTCDataChannel>();
  private attemptIds = new Map<string, string>();
  private connectedPeers = new Set<string>();
  private desiredPeers = new Set<string>();
  private queuedSends = new Map<string, QueuedSend[]>();
  private connectionTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private peerReconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private peerReconnectAttempts = new Map<string, number>();

  // входящие ICE от пира — до setRemoteDescription
  private pendingCandidates      = new Map<string, Array<{ attemptId: string; candidate: RTCIceCandidateInit }>>();
  // локальные ICE — до получения answer
  private pendingLocalCandidates = new Map<string, RTCIceCandidateInit[]>();

  private status: TransportStatus = 'idle';

  private messageHandlers:    Array<(msg: TransportMessage) => void> = [];
  private statusHandlers:     Array<(status: TransportStatus) => void> = [];
  private peerChangeHandlers: Array<(peer: Peer, event: 'joined' | 'left') => void> = [];
  private failureHandlers: Array<(peer: string) => void> = [];
  private registryId: string | undefined;
  private courierHandlers: Array<(data: CourierDelivery, reply: CourierReply) => void> = [];
  private attachmentRelay = false;
  private attachmentRequests = new Map<string, { socket: WebSocket | null; from: string; id: string; index: number; resolve(bytes?: Uint8Array): void }>();
  private clearAttachmentRequests(socket?: WebSocket | null) {
    for (const pending of this.attachmentRequests.values()) if (!socket || pending.socket === socket) pending.resolve();
  }
  onCourier(handler: (data: CourierDelivery, reply: CourierReply) => void) { this.courierHandlers.push(handler); }

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private lastFailoverAt = 0;
  private shouldReconnect = false;
  private recoveryUntil = 0;
  private readonly RECONNECT_BASE_DELAY_MS = 2000;
  private readonly MAX_RECONNECT_DELAY_MS = 30_000;

  constructor(config: string | SignalingEndpoint[] = defaultSignalingEndpoints(), private readonly routing?: {
    admitPeer: (peer: string) => boolean;
  }) {
    this.endpoints = typeof config === 'string'
      ? [{ url: config, kind: isLocalHost(new URL(config).hostname) ? 'lan' : 'internet' }]
      : [...config].sort((a, b) => Number(a.kind === 'lan') - Number(b.kind === 'lan'));
    if (!this.endpoints.length) throw new Error('no_signaling_endpoints');
    this.signalingUrl = this.endpoints[0].url;
  }

  // ----------------------------------------------------------
  // Публичный API
  // ----------------------------------------------------------

  getStatus(): TransportStatus { return this.status; }
  getConnectionInfo(): SignalingEndpoint { return { ...this.endpoints[this.endpointIndex] }; }
  getRegistryId(): string | undefined { return this.registryId; }
  async resume(): Promise<void> {
    if (!this.shouldReconnect || this.signalingAttempt) return;
    this.recoveryUntil = Date.now() + 65_000;
    this.cancelReconnect(); this.cancelPreferredProbe();
    await this.returnToPreferredNode();
  }
  onPeerFailure(cb: (peer: string) => void): void { this.failureHandlers.push(cb); }
  releasePeer(peer: string): void {
    this.desiredPeers.delete(peer);
    this.cancelPeerReconnect(peer);
    this.cleanupPeer(peer);
    this.rejectQueued(peer, 'route_released');
  }

  async isAvailable(): Promise<boolean> {
    return typeof RTCPeerConnection !== 'undefined';
  }

  async init(myAddress: string, identity?: TransportRegistrationIdentity): Promise<void> {
    if (!this.shouldReconnect || this.myAddress !== myAddress) this.recoveryUntil = Date.now() + 65_000;
    this.myAddress = myAddress;
    this.registrationIdentity = identity ?? null;
    this.shouldReconnect = true;
    // A fresh unlock also races the old socket's server-side deregistration.
    this.cancelReconnect();
    if (typeof window !== 'undefined') window.addEventListener('online', this.onNetworkOnline);
    await this.connectSignaling();
  }

  async connect(peer: Peer): Promise<void> {
    const address = peer.address;
    if (!address || address === this.myAddress) throw new Error('invalid_peer_address');
    this.desiredPeers.add(address);
    if (this.connections.has(address)) return;
    if (!this.signalingReady || this.ws?.readyState !== WebSocket.OPEN) throw new Error('signaling_unavailable');
    // The lower address creates the offer. The higher address can still start
    // a conversation by asking that peer to create it.
    if (this.myAddress > address) {
      this.wsSend({ type: 'connect_request', to: address, from: this.myAddress });
      return;
    }
    this.cancelPeerReconnect(address);
    await this.createOffer(address);
  }

  async disconnect(): Promise<void> {
    this.clearAttachmentRequests(); this.attachmentRelay = false;
    this.shouldReconnect = false;
    this.signalingReady = false;
    this.cancelReconnect();
    this.cancelPreferredProbe();
    this.cancelSignalingAttempt?.();
    if (typeof window !== 'undefined') window.removeEventListener('online', this.onNetworkOnline);
    for (const address of [...this.peerReconnectTimers.keys()]) this.cancelPeerReconnect(address);
    for (const address of [...this.connections.keys()]) this.cleanupPeer(address);
    for (const address of [...this.queuedSends.keys()]) this.rejectQueued(address, 'transport_disconnected');
    this.desiredPeers.clear();
    this.peerReconnectAttempts.clear();
    this.pendingCandidates.clear();
    this.pendingLocalCandidates.clear();
    const ws = this.ws;
    this.ws = null;
    this.registrationIdentity = null;
    ws?.close();
    this.setStatus('idle');
  }

  async send(message: TransportMessage): Promise<void> {
    const encoded = encodeMessage(message);
    if (encoded.byteLength > this.capabilities.maxMessageBytes) throw new Error('message_too_large');
    const channel = this.channels.get(message.to);
    if (channel?.readyState === 'open') {
      await this.waitForChannelRoom(channel);
      if (channel.readyState !== 'open' || this.channels.get(message.to) !== channel) throw new Error('channel_closed');
      channel.send(encoded);
      return;
    }

    const queued = this.queuedSends.get(message.to) ?? [];
    const queuedBytes = queued.reduce((total, item) => total + item.encoded.byteLength, 0);
    if (queued.length >= MAX_QUEUED_MESSAGES || queuedBytes + encoded.byteLength > MAX_QUEUED_BYTES) {
      throw new Error('send_queue_full');
    }

    return new Promise<void>((resolve, reject) => {
      const item: QueuedSend = {
        encoded,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.removeQueued(message.to, item);
          reject(new Error(`channel_open_timeout:${message.to}`));
        }, CHANNEL_TIMEOUT_MS),
      };
      queued.push(item);
      this.queuedSends.set(message.to, queued);

      if (!this.connections.has(message.to) && this.signalingReady && this.ws?.readyState === WebSocket.OPEN) {
        void this.connect({ address: message.to, transport: 'webrtc', lastSeen: Date.now() })
          .catch(() => {});
      }
    });
  }

  private async waitForChannelRoom(channel: RTCDataChannel): Promise<void> {
    if (typeof channel.bufferedAmount !== 'number' || channel.bufferedAmount < CHANNEL_BUFFER_HIGH) return;
    channel.bufferedAmountLowThreshold = CHANNEL_BUFFER_LOW;
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        channel.removeEventListener('bufferedamountlow', onLow);
        channel.removeEventListener('close', onClose);
      };
      const onLow = () => { cleanup(); resolve(); };
      const onClose = () => { cleanup(); reject(new Error('channel_closed')); };
      const timer = setTimeout(() => { cleanup(); reject(new Error('channel_buffer_timeout')); }, 30_000);
      channel.addEventListener('bufferedamountlow', onLow);
      channel.addEventListener('close', onClose);
      if (channel.bufferedAmount <= CHANNEL_BUFFER_LOW) onLow();
    });
  }

  onMessage(cb: (msg: TransportMessage) => void):                          void { this.messageHandlers.push(cb); }
  onStatusChange(cb: (status: TransportStatus) => void):                   void { this.statusHandlers.push(cb); }
  onPeerChange(cb: (peer: Peer, event: 'joined' | 'left') => void):       void { this.peerChangeHandlers.push(cb); }

  async discover(): Promise<Peer[]> {
    return Array.from(this.channels.keys()).map(address => ({
      address, transport: 'webrtc' as const, lastSeen: Date.now(),
    }));
  }

  // ----------------------------------------------------------
  // Signaling
  // ----------------------------------------------------------

  private connectSignaling(startIndex = 0): Promise<void> {
    if (this.signalingAttempt) return this.signalingAttempt;
    this.signalingAttempt = this.tryEndpoints(startIndex).finally(() => { this.signalingAttempt = null; });
    return this.signalingAttempt;
  }

  private async tryEndpoints(startIndex: number): Promise<void> {
    let lastError: unknown = new Error('signaling_unavailable');
    for (let offset = 0; offset < this.endpoints.length && this.shouldReconnect; offset++) {
      const index = (startIndex + offset) % this.endpoints.length;
      if (index !== this.endpointIndex) {
        // Stale offers/ICE cannot cross unrelated signaling registries. Only
        // unfinished negotiations are discarded; live channels survive.
        for (const address of [...this.connections.keys()]) {
          if (!this.connectedPeers.has(address)) this.cleanupPeer(address);
        }
      }
      this.endpointIndex = index;
      this.signalingUrl = this.endpoints[index].url;
      try {
        await this.connectEndpoint();
        this.schedulePreferredProbe();
        return;
      } catch (error) { lastError = error; }
    }
    if (this.shouldReconnect) this.scheduleReconnect();
    throw lastError;
  }

  private async connectEndpoint(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.setStatus('connecting');
      this.signalingReady = false;
      this.attachmentRelay = false;
      let ws: WebSocket;
      try { ws = new WebSocket(this.signalingUrl); } catch (error) { reject(error); return; }
      this.ws = ws;
      let registered = false;
      let challenged = false;
      const cancel = () => {
        clearTimeout(registrationTimer);
        if (this.ws === ws) { this.ws = null; this.signalingReady = false; }
        if (this.cancelSignalingAttempt === cancel) this.cancelSignalingAttempt = null;
        ws.close();
        reject(new Error('transport_disconnected'));
      };
      this.cancelSignalingAttempt = cancel;
      const fail = (error: unknown) => {
        clearTimeout(registrationTimer);
        if (this.ws === ws) { this.ws = null; this.signalingReady = false; }
        if (this.cancelSignalingAttempt === cancel) this.cancelSignalingAttempt = null;
        ws.close();
        reject(error);
      };
      const registrationTimer = setTimeout(() => {
        if (registered || this.ws !== ws) return;
        fail(new Error('signaling_registration_timeout'));
      }, 5_000);

      ws.onopen = () => {
        if (!this.shouldReconnect || this.ws !== ws) {
          ws.close();
          reject(new Error('transport_disconnected'));
          return;
        }
        this.wsSend({ type: 'register', address: this.myAddress });
      };

      ws.onmessage = (event) => {
        if (this.ws !== ws) return;
        try {
          if (typeof event.data !== 'string' || event.data.length > 256 * 1024) return;
          const msg: SignalingMessage = JSON.parse(event.data);
          if (!registered) {
            if (msg.type === 'register_challenge' && msg.address === this.myAddress) {
              if (challenged) return;
              challenged = true;
              void this.answerRegistrationChallenge(ws, msg.challenge).catch((error) => {
                if (this.ws !== ws || !this.shouldReconnect) { fail(error); return; }
                this.shouldReconnect = false;
                this.setStatus('error');
                fail(error);
              });
              return;
            }
            if (msg.type === 'registered' && msg.address === this.myAddress &&
                isValidAccountId(this.myAddress) && !challenged) {
              this.shouldReconnect = false;
              this.setStatus('error');
              fail(new Error('signaling_protocol_outdated'));
              return;
            }
            if (msg.type === 'registered' && msg.address === this.myAddress &&
                (challenged || !isValidAccountId(this.myAddress))) {
              registered = true;
              this.signalingReady = true;
              this.attachmentRelay = msg.attachmentProtocol === ATTACHMENT_PROTOCOL;
              this.registryId = typeof msg.registryId === 'string' && /^[a-f0-9]{32}$/.test(msg.registryId) ? msg.registryId : undefined;
              this.lanIceMode = this.endpoints[this.endpointIndex].kind === 'lan' ||
                msg.iceMode === 'lan' || import.meta.env.VITE_MESH_ICE_MODE === 'lan';
              clearTimeout(registrationTimer);
              if (this.cancelSignalingAttempt === cancel) this.cancelSignalingAttempt = null;
              this.reconnectAttempts = 0;
              this.setStatus('connected');
              for (const peerAddress of new Set([...this.desiredPeers, ...this.queuedSends.keys()])) {
                if (!this.connections.has(peerAddress)) {
                  void this.connect({ address: peerAddress, transport: 'webrtc', lastSeen: Date.now() })
                    .catch(() => {});
                } else {
                  // Keep presence notifications after signaling reconnects
                  // without interrupting a DataChannel that survived offline.
                  this.wsSend({ type: 'watch_peer', to: peerAddress });
                }
              }
              resolve();
            }
            return;
          }
          void this.handleSignaling(msg).catch(() => {});
        } catch { /* Reject malformed signaling without retaining its contents. */ }
      };

      ws.onclose = (event) => {
        this.clearAttachmentRequests(ws);
        clearTimeout(registrationTimer);
        if (this.ws !== ws) return;
        this.signalingReady = false;
        if (this.ws === ws) this.ws = null;
        if (this.cancelSignalingAttempt === cancel) this.cancelSignalingAttempt = null;

        // A sleeping browser's old socket may take a heartbeat to deregister.
        // Only this exact transient refusal is retryable during recovery;
        // invalid proofs and all other policy refusals still fail closed.
        if (event?.code === 1008 && event.reason === 'address in use' && Date.now() < this.recoveryUntil) {
          this.setStatus('offline');
          if (!registered) reject(new Error('signaling_address_busy'));
          if (!this.routing) this.scheduleReconnect();
          return;
        }
        if (event?.code === 1008) {
          this.shouldReconnect = false;
          this.setStatus('error');
          if (!registered) reject(new Error(event.reason === 'address in use' ? 'signaling_address_busy' : 'signaling_registration_rejected'));
          return;
        }
        if (!this.shouldReconnect) {
          if (this.status !== 'error') this.setStatus('idle');
          if (!registered) reject(new Error('transport_disconnected'));
          return;
        }

        this.setStatus('offline');
        if (!registered) { reject(new Error('signaling_closed')); return; }
        if (this.routing) return;
        this.cancelPreferredProbe();
        // Try the next configured node immediately; exhausted lists use backoff.
        this.cancelReconnect();
        const now = Date.now();
        if (this.signalingAttempt || now - this.lastFailoverAt < this.RECONNECT_BASE_DELAY_MS) this.scheduleReconnect();
        else {
          this.lastFailoverAt = now;
          void this.connectSignaling((this.endpointIndex + 1) % this.endpoints.length)
            .catch(() => { /* tryEndpoints schedules bounded retry. */ });
        }
      };
      ws.onerror = (e)  => {
        if (!this.shouldReconnect || this.ws !== ws) return;
        if (!registered) fail(e);
      };
    });
  }

  private cancelPreferredProbe(): void {
    if (this.preferredTimer) clearTimeout(this.preferredTimer);
    this.preferredTimer = null;
    const probe = this.preferredProbe;
    this.preferredProbe = null;
    probe?.close();
  }

  private schedulePreferredProbe(): void {
    if (!this.shouldReconnect || this.endpointIndex === 0 || this.preferredTimer || this.preferredProbe ||
        this.endpoints[0].kind !== 'internet') return;
    this.preferredTimer = setTimeout(() => {
      this.preferredTimer = null;
      if (!this.shouldReconnect) return;
      // Do not disturb ongoing chats just to restore the preferred network.
      if (this.connectedPeers.size > 0) { this.schedulePreferredProbe(); return; }
      let probe: WebSocket;
      try { probe = new WebSocket(this.endpoints[0].url); }
      catch { this.schedulePreferredProbe(); return; }
      this.preferredProbe = probe;
      const timer = setTimeout(() => finish(false), 5_000);
      const finish = (available: boolean) => {
        clearTimeout(timer);
        if (this.preferredProbe !== probe) return;
        this.preferredProbe = null;
        probe.close();
        if (!this.shouldReconnect) return;
        if (!available || this.connectedPeers.size > 0) { this.schedulePreferredProbe(); return; }
        // Anonymous reachability check: no Account ID, key or peer list is sent.
        void this.returnToPreferredNode();
      };
      probe.onopen = () => probe.send(JSON.stringify({ type: 'probe' }));
      probe.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          finish(message.type === 'probe_result' && message.protocol === 'mesh-signaling-v1');
        } catch { finish(false); }
      };
      probe.onerror = () => finish(false);
      probe.onclose = () => finish(false);
    }, 60_000);
  }

  private async returnToPreferredNode(): Promise<void> {
    const old = this.ws;
    this.clearAttachmentRequests(old);
    this.ws = null;
    this.signalingReady = false;
    if (old && old.readyState !== WebSocket.CLOSED) {
      // Wait for deregistration before entering another listener of the same
      // registry, avoiding an "address in use" race during a switch.
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 1_000);
        old.onclose = () => { clearTimeout(timer); resolve(); };
        old.close();
      });
    }
    if (this.shouldReconnect) await this.connectSignaling(0).catch(() => {});
  }

  private wsSend(msg: SignalingMessage): void {

    if (this.ws?.readyState === WebSocket.OPEN &&
        (this.signalingReady || msg.type === 'register' || msg.type === 'register_proof')) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private async answerRegistrationChallenge(ws: WebSocket, challenge: string): Promise<void> {
    const identity = this.registrationIdentity;
    if (!identity || !/^[0-9a-f]{64}$/.test(challenge)) throw new Error('invalid_registration_challenge');
    const signature = await identity.sign(registrationProofBytes(this.myAddress, challenge));
    if (this.ws !== ws || ws.readyState !== WebSocket.OPEN) return;
    this.wsSend({
      type: 'register_proof', address: this.myAddress,
      publicKey: bytesToHex(identity.publicKey), signature: bytesToHex(signature),
    });
  }

  private async handleSignaling(msg: SignalingMessage): Promise<void> {
    if (msg.type === 'registered') this.attachmentRelay = msg.attachmentProtocol === ATTACHMENT_PROTOCOL;
    switch (msg.type) {
      case 'courier_file_chunk': {
        const pending = this.attachmentRequests.get(msg.requestId);
        if (this.signalingReady && pending && pending.socket === this.ws && msg.to === this.myAddress && msg.from === pending.from && msg.id === pending.id && msg.index === pending.index && validAttachmentChunk(msg)) pending.resolve(unbase64(msg.cipher));
        break;
      }
      case 'courier_delivery': {
        if (!this.signalingReady || msg.to !== this.myAddress || !isValidAccountId(msg.from) ||
            msg.job?.body?.courier !== msg.from || msg.job.body.to !== this.myAddress || !msg.hop || JSON.stringify(msg.hop).length > 2048) break;
        const socket = this.ws;
        const reply: CourierReply = (id, receipt) => {
          if (this.ws === socket && this.signalingReady && socket?.readyState === WebSocket.OPEN &&
              /^[a-f0-9]{32}$/.test(id) && receipt.length <= 2048 && socket.bufferedAmount <= 256 * 1024)
            this.wsSend({ type: 'courier_receipt', to: msg.from, id, receipt });
        };
        if (this.attachmentRelay) reply.chunk = (request, signal) => new Promise((resolve, reject) => {
          const b = request.body;
          if (signal.aborted || this.ws !== socket || !this.signalingReady || socket?.readyState !== WebSocket.OPEN || this.attachmentRequests.size >= 8 || b.to !== msg.from || b.from !== this.myAddress) { reject(new Error('attachment_transport_closed')); return; }
          const finish = (bytes?: Uint8Array) => { clearTimeout(timer); signal.removeEventListener('abort', abort); this.attachmentRequests.delete(b.requestId); if (bytes) resolve(bytes); else reject(new Error('attachment_transport_closed')); };
          const abort = () => finish(); const timer = setTimeout(abort, 15000);
          signal.addEventListener('abort', abort, { once: true });
          this.attachmentRequests.set(b.requestId, { socket, from: msg.from, id: b.id, index: b.index, resolve: bytes => finish(bytes) });
          this.wsSend({ type: 'courier_file_request', to: msg.from, request });
        });
        for (const handler of this.courierHandlers) handler(msg, reply);
        break;
      }
      case 'connect_request':
        if (this.routing && !this.routing.admitPeer(msg.from)) break;
        if (this.myAddress < msg.from && !this.connections.has(msg.from)) {
          this.desiredPeers.add(msg.from);
          await this.connect({ address: msg.from, transport: 'webrtc', lastSeen: Date.now() });
        }
        break;
      case 'offer':        await this.handleOffer(msg.from, msg.attemptId, msg.sdp);       break;
      case 'answer':       await this.handleAnswer(msg.from, msg.attemptId, msg.sdp);      break;
      case 'candidate':    await this.handleCandidate(msg.from, msg.attemptId, msg.candidate); break;
      case 'peer_online':
        // Availability at signaling does not imply an open DataChannel.
        if (this.desiredPeers.has(msg.address) && !this.connections.has(msg.address)) {
          this.peerReconnectAttempts.delete(msg.address);
          await this.connect({ address: msg.address, transport: 'webrtc', lastSeen: Date.now() });
        }
        break;
      case 'peer_offline':
        // Registration on another node is not proof that a direct peer left.
        if (this.connectedPeers.has(msg.address)) break;
        this.cancelPeerReconnect(msg.address);
        this.peerReconnectAttempts.delete(msg.address);
        this.cleanupPeer(msg.address);
        this.rejectQueued(msg.address, 'peer_offline');
        for (const handler of this.failureHandlers) handler(msg.address);
        break;
      case 'peer_unavailable':
        if (this.connectedPeers.has(msg.address)) break;
        if (msg.attemptId && this.attemptIds.get(msg.address) !== msg.attemptId) break;
        if (!msg.attemptId && this.connections.has(msg.address)) break;
        this.cancelPeerReconnect(msg.address);
        this.peerReconnectAttempts.delete(msg.address);
        this.cleanupPeer(msg.address);
        this.rejectQueued(msg.address, 'peer_unavailable');
        for (const handler of this.failureHandlers) handler(msg.address);
        break;
      case 'error':
        break;
    }
  }

  // ----------------------------------------------------------
  // PeerConnection
  // ----------------------------------------------------------

  private createPeerConnection(peerAddress: string, attemptId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection({
      iceServers: this.lanIceMode ? [] : defaultStunServers(),
    });

    this.attemptIds.set(peerAddress, attemptId);
    this.pendingLocalCandidates.set(peerAddress, []);
    this.armConnectionTimeout(peerAddress, pc);

    pc.onicecandidate = (e) => {
      if (this.connections.get(peerAddress) !== pc) {
        if (this.lanIceMode && e.candidate) {

        }
        return;
      }
      if (!e.candidate) {

        return;
      }
      if (!pc.remoteDescription) {
        // держим локально до получения answer
        const pending = this.pendingLocalCandidates.get(peerAddress) ?? [];
        pending.push(e.candidate.toJSON());
        this.pendingLocalCandidates.set(peerAddress, pending);

        return;
      }

      this.wsSend({ type: 'candidate', to: peerAddress, from: this.myAddress, attemptId, candidate: e.candidate.toJSON() });
    };

    pc.onconnectionstatechange = () => {
      if (this.connections.get(peerAddress) !== pc) return;

      if (pc.connectionState === 'failed') {
        this.failPeer(peerAddress, pc);
      } else if (pc.connectionState === 'disconnected') {
        // A brief ICE interruption can recover without a new offer.
        this.clearConnectionTimer(peerAddress);
        this.connectionTimers.set(peerAddress, setTimeout(() => {
          if (this.connections.get(peerAddress) === pc && pc.connectionState === 'disconnected') {
            this.failPeer(peerAddress, pc);
          }
        }, 5_000));
      } else if (pc.connectionState === 'connected') {
        if (this.channels.has(peerAddress)) this.clearConnectionTimer(peerAddress);
        else this.armConnectionTimeout(peerAddress, pc);
      }
    };

    pc.oniceconnectionstatechange = () => {

    };

    pc.ondatachannel = (e) => { this.setupChannel(peerAddress, pc, e.channel); };

    this.connections.set(peerAddress, pc);
    return pc;
  }

  private async waitForLanIceGathering(pc: RTCPeerConnection): Promise<void> {
    if (!this.lanIceMode || pc.iceGatheringState === 'complete') return;
    // LAN peers can exchange host candidates in SDP even when trickled
    // candidate events are delayed or suppressed by a browser/VPN.
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        pc.removeEventListener('icegatheringstatechange', onStateChange);
        resolve();
      };
      const onStateChange = () => {
        if (pc.iceGatheringState === 'complete' || pc.connectionState === 'closed') finish();
      };
      const timer = setTimeout(finish, LAN_ICE_GATHER_TIMEOUT_MS);
      pc.addEventListener('icegatheringstatechange', onStateChange);
      onStateChange();
    });
  }

  // ----------------------------------------------------------
  // Инициатор
  // ----------------------------------------------------------

  private async createOffer(peerAddress: string): Promise<void> {

    const attemptId = crypto.randomUUID();
    const pc = this.createPeerConnection(peerAddress, attemptId);

    const channel = pc.createDataChannel('mesh', { ordered: true });
    this.setupChannel(peerAddress, pc, channel);

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await this.waitForLanIceGathering(pc);
      if (this.connections.get(peerAddress) !== pc) return;

      this.wsSend({ type: 'offer', to: peerAddress, from: this.myAddress, attemptId, sdp: pc.localDescription! });
    } catch (error) {
      this.failPeer(peerAddress, pc);
      throw error;
    }
  }

  // ----------------------------------------------------------
  // Принимающая сторона
  // ----------------------------------------------------------

  private async handleOffer(fromAddress: string, attemptId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    if (!attemptId || !sdp || fromAddress >= this.myAddress) return;
    if (this.routing && !this.routing.admitPeer(fromAddress)) return;
    if (this.attemptIds.get(fromAddress) === attemptId) return;
    this.desiredPeers.add(fromAddress);

    const earlyCandidates = this.pendingCandidates.get(fromAddress) ?? [];
    this.cleanupPeer(fromAddress);
    // Cleanup emits 'left' for an existing live channel. Routed transport then
    // releases that route; re-admit the fresh attempt AFTER that synchronous
    // release, otherwise its new channel/messages are silently ignored there.
    // Admission may now be denied (policy/another live route); never bypass it.
    if (this.routing && !this.routing.admitPeer(fromAddress)) return;
    this.pendingCandidates.set(fromAddress, earlyCandidates.filter((item) => item.attemptId === attemptId));
    const pc = this.createPeerConnection(fromAddress, attemptId);

    try {
      await pc.setRemoteDescription(sdp);
      await this.flushPendingCandidates(fromAddress, attemptId, pc);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await this.waitForLanIceGathering(pc);
      if (this.connections.get(fromAddress) !== pc) return;

      this.wsSend({ type: 'answer', to: fromAddress, from: this.myAddress, attemptId, sdp: pc.localDescription! });
    } catch (error) {
      this.failPeer(fromAddress, pc);
      throw error;
    }
  }

  private async handleAnswer(fromAddress: string, attemptId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    const pc = this.connections.get(fromAddress);

    if (!pc || this.attemptIds.get(fromAddress) !== attemptId || !sdp) return;
    if (pc.signalingState === 'stable') return;

    try {
      await pc.setRemoteDescription(sdp);

      // отправляем локальные кандидаты которые накопились до answer
      const localPending = this.pendingLocalCandidates.get(fromAddress) ?? [];
      for (const c of localPending) {
        this.wsSend({ type: 'candidate', to: fromAddress, from: this.myAddress, attemptId, candidate: c });
      }
      this.pendingLocalCandidates.set(fromAddress, []);

      await this.flushPendingCandidates(fromAddress, attemptId, pc);

    } catch (error) {
      this.failPeer(fromAddress, pc);
      throw error;
    }
  }

  private async handleCandidate(fromAddress: string, attemptId: string, candidate: RTCIceCandidateInit): Promise<void> {
    if (!attemptId || !candidate) return;

    const pc = this.connections.get(fromAddress);

    if (pc && this.attemptIds.get(fromAddress) !== attemptId) {
      if (this.lanIceMode) {

      }
      return;
    }
    if (!pc?.remoteDescription) {
      const pending = this.pendingCandidates.get(fromAddress) ?? [];
      if (pending.length >= MAX_PENDING_CANDIDATES) return;
      pending.push({ attemptId, candidate });
      this.pendingCandidates.set(fromAddress, pending);

      return;
    }

    await pc.addIceCandidate(new RTCIceCandidate(candidate));

  }

  private async flushPendingCandidates(peerAddress: string, attemptId: string, pc: RTCPeerConnection): Promise<void> {
    const pending = this.pendingCandidates.get(peerAddress) ?? [];
    for (const item of pending) {
      if (item.attemptId === attemptId) {
        await pc.addIceCandidate(new RTCIceCandidate(item.candidate));
      }
    }
    this.pendingCandidates.set(peerAddress, []);
  }

  // ----------------------------------------------------------
  // DataChannel
  // ----------------------------------------------------------

  private setupChannel(peerAddress: string, pc: RTCPeerConnection, channel: RTCDataChannel): void {
    channel.binaryType = 'arraybuffer';

    channel.onopen = () => {
      if (this.connections.get(peerAddress) !== pc) {
        channel.close();
        return;
      }

      this.clearConnectionTimer(peerAddress);
      this.cancelPeerReconnect(peerAddress);
      this.peerReconnectAttempts.delete(peerAddress);
      this.channels.set(peerAddress, channel);
      if (!this.connectedPeers.has(peerAddress)) {
        this.connectedPeers.add(peerAddress);
        this.emitPeerChange({ address: peerAddress, transport: 'webrtc', lastSeen: Date.now() }, 'joined');
      }
      this.flushQueued(peerAddress, channel);
    };

    channel.onclose = () => {
      if (this.connections.get(peerAddress) !== pc) return;
      this.channels.delete(peerAddress);
      this.failPeer(peerAddress, pc);
    };

    channel.onmessage = (e) => {
      if (this.connections.get(peerAddress) !== pc) return;
      try {
        const bytes = new Uint8Array(e.data as ArrayBuffer);
        if (bytes.byteLength > this.capabilities.maxMessageBytes) throw new Error('message_too_large');
        const msg = decodeMessage(bytes);
        if (msg.from !== peerAddress || msg.to !== this.myAddress) throw new Error('channel_identity_mismatch');
        this.emitMessage(msg);
      } catch (err) {

      }
    };
  }

  // ----------------------------------------------------------
  // Reconnect
  // ----------------------------------------------------------

  private scheduleReconnect(): void {
    if (this.routing) return;
    if (!this.shouldReconnect || this.reconnectTimer) return;
    this.setStatus('reconnecting');
    // A LAN outage can last arbitrarily long. Keep retrying at a capped rate
    // instead of permanently stranding a tab until the user reloads it.
    const delay = Math.min(this.MAX_RECONNECT_DELAY_MS,
      this.RECONNECT_BASE_DELAY_MS * Math.pow(1.5, this.reconnectAttempts));
    this.reconnectAttempts = Math.min(this.reconnectAttempts + 1, 10);
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (!this.shouldReconnect) return;

      try { await this.connectSignaling(); }
      catch {
        if (this.shouldReconnect) this.scheduleReconnect();
      }
    }, delay);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
  }

  private schedulePeerReconnect(peerAddress: string): void {
    if (this.routing) return;
    if (!this.shouldReconnect || this.myAddress > peerAddress || this.peerReconnectTimers.has(peerAddress)) return;
    if (!this.signalingReady || this.ws?.readyState !== WebSocket.OPEN) return;
    const attempts = this.peerReconnectAttempts.get(peerAddress) ?? 0;
    if (attempts >= MAX_PEER_RECONNECT_ATTEMPTS) {
      this.rejectQueued(peerAddress, 'peer_connection_failed');
      return;
    }
    this.peerReconnectAttempts.set(peerAddress, attempts + 1);
    const timer = setTimeout(() => {
      this.peerReconnectTimers.delete(peerAddress);
      if (!this.shouldReconnect) return;
      if (!this.signalingReady || this.ws?.readyState !== WebSocket.OPEN) return;
      void this.connect({ address: peerAddress, transport: 'webrtc', lastSeen: Date.now() })
        .catch(() => {});
    }, 1_000 * 2 ** attempts);
    this.peerReconnectTimers.set(peerAddress, timer);
  }

  private cancelPeerReconnect(peerAddress: string): void {
    const timer = this.peerReconnectTimers.get(peerAddress);
    if (timer) clearTimeout(timer);
    this.peerReconnectTimers.delete(peerAddress);
  }

  private clearConnectionTimer(peerAddress: string): void {
    const timer = this.connectionTimers.get(peerAddress);
    if (timer) clearTimeout(timer);
    this.connectionTimers.delete(peerAddress);
  }

  private armConnectionTimeout(peerAddress: string, pc: RTCPeerConnection): void {
    this.clearConnectionTimer(peerAddress);
    this.connectionTimers.set(peerAddress, setTimeout(() => {
      if (this.connections.get(peerAddress) !== pc || this.channels.has(peerAddress)) return;
      this.failPeer(peerAddress, pc);
    }, CHANNEL_TIMEOUT_MS));
  }

  private failPeer(peerAddress: string, pc: RTCPeerConnection): void {
    if (this.connections.get(peerAddress) !== pc) return;
    this.cleanupPeer(peerAddress);
    this.schedulePeerReconnect(peerAddress);
    for (const handler of this.failureHandlers) handler(peerAddress);
  }

  // ----------------------------------------------------------
  // Cleanup
  // ----------------------------------------------------------

  private cleanupPeer(peerAddress: string): void {
    this.clearConnectionTimer(peerAddress);
    const channel = this.channels.get(peerAddress);
    const pc = this.connections.get(peerAddress);
    this.channels.delete(peerAddress);
    this.connections.delete(peerAddress);
    channel?.close();
    pc?.close();
    this.attemptIds.delete(peerAddress);
    this.pendingCandidates.delete(peerAddress);
    this.pendingLocalCandidates.delete(peerAddress);
    if (this.connectedPeers.delete(peerAddress)) {
      this.emitPeerChange({ address: peerAddress, transport: 'webrtc', lastSeen: Date.now() }, 'left');
    }
  }

  private removeQueued(peerAddress: string, item: QueuedSend): void {
    const queue = this.queuedSends.get(peerAddress);
    if (!queue) return;
    const index = queue.indexOf(item);
    if (index !== -1) queue.splice(index, 1);
    if (queue.length === 0) this.queuedSends.delete(peerAddress);
  }

  private rejectQueued(peerAddress: string, reason: string): void {
    const queue = this.queuedSends.get(peerAddress) ?? [];
    this.queuedSends.delete(peerAddress);
    for (const item of queue) {
      clearTimeout(item.timer);
      item.reject(new Error(reason));
    }
  }

  private flushQueued(peerAddress: string, channel: RTCDataChannel): void {
    const queue = this.queuedSends.get(peerAddress) ?? [];
    this.queuedSends.delete(peerAddress);
    for (const item of queue) {
      clearTimeout(item.timer);
      try {
        channel.send(item.encoded);
        item.resolve();
      } catch (error) {
        item.reject(error instanceof Error ? error : new Error('send_failed'));
      }
    }
  }

  // ----------------------------------------------------------
  // Emit helpers
  // ----------------------------------------------------------

  private setStatus(s: TransportStatus): void { this.status = s; for (const h of this.statusHandlers) h(s); }
  private emitMessage(msg: TransportMessage): void { for (const h of this.messageHandlers) h(msg); }
  private emitPeerChange(peer: Peer, event: 'joined' | 'left'): void { for (const h of this.peerChangeHandlers) h(peer, event); }
}
