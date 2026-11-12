import { SecureSessions } from './secure-session';
import { IntroductionRelay } from '../transport/introduction-relay';
import type { IntroductionPort } from '../transport/introduction-relay';
import type { ChatIdentity, ChatMessage } from './ChatService';
import type { ContactState } from './session-chats';
import type { TransportMessage } from '../transport/transport';
import { verifySignedEnvelope } from '../core/envelopes';
import { webCryptoEnvironment } from '../core/ports';
import { buildPayload, buildSignInput } from '../message/envelope';
import { decodeChatContent } from './message-details';
import { INTRODUCTION_MAX_BYTES, INTRODUCTION_PROTOCOL } from '../../../nodes/packages/protocol/src/introduction.js';

const encoder = new TextEncoder();
// Signed domain separation: an introduction frame cannot be injected into MAE
// on a DataChannel, or a normal chat frame into the introduction session.
const DOMAIN = encoder.encode(`${INTRODUCTION_PROTOCOL}\0`);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type IntroductionStatus = 'connecting' | 'exchanging' | 'request_sent' | 'waiting_acceptance' | 'accepted' | 'unsupported' | 'unavailable' | 'failed';
export type IntroductionRequest = { id: string; content: string; timestamp: number };
type Packet =
  | { kind: 'request'; request: IntroductionRequest }
  | { kind: 'received' | 'accept'; requestId: string }
  | { kind: 'sync' }
  | { kind: 'courier' | 'offline'; bundle: unknown };
export interface IntroductionOptions {
  identity: ChatIdentity;
  port: IntroductionPort;
  current(): boolean;
  contact(peer: string): ContactState | undefined;
  request(peer: string): IntroductionRequest | undefined;
  incomingRequest(peer: string): string | undefined;
  directReady(peer: string): boolean;
  authorize(peer: string): Promise<void>;
  receive(message: ChatMessage): Promise<void>;
  received(peer: string, id: string): Promise<void>;
  accept(peer: string): Promise<void>;
  keys(peer: string, kind: 'courier' | 'offline', bundle: unknown): Promise<void>;
  ready(peer: string): void;
  status(peer: string, status: IntroductionStatus): void;
}

// Separate short-lived crypto and lifecycle. Never changes direct transport
// presence, never sends ordinary chat traffic, device authority, files or calls.
export class OnlineIntroduction {
  private relay: IntroductionRelay;
  private sessions: SecureSessions;
  private readyPeers = new Set<string>();
  private remoteSync = new Set<string>();
  private incoming = new Map<string, Promise<void>>();
  private outgoing = new Map<string, Promise<void>>();
  private desired = new Map<string, number>();
  private touched = new Map<string, number>();
  private inFlight = 0;
  private stopped = false;
  private generation = 0;
  private epochs = new Map<string, number>();
  private timer: ReturnType<typeof setInterval>;
  constructor(private options: IntroductionOptions) {
    const o = options;
    this.relay = new IntroductionRelay(o.port, o.identity.address, peer => this.current() && o.contact(peer) !== 'blocked');
    this.sessions = new SecureSessions(o.identity.address,
      (peer, frame) => this.sendFrame(peer, frame), peer => {
        if (!this.current() || o.contact(peer) === 'blocked') return;
        this.readyPeers.add(peer); this.touched.set(peer, Date.now());
        const epoch = this.epochs.get(peer);
        void this.exchange(peer).catch(() => this.failed(peer, epoch));
      });
    this.relay.onPeer((peer, joined) => {
      if (!joined) {
        this.epochs.delete(peer);
        this.sessions.drop(peer); this.readyPeers.delete(peer); this.remoteSync.delete(peer);
        this.incoming.delete(peer); this.outgoing.delete(peer); this.touched.delete(peer);
        if (this.current() && this.desired.has(peer)) o.status(peer, 'unavailable');
      } else {
        const epoch = ++this.generation; this.epochs.set(peer, epoch);
        this.touched.set(peer, Date.now()); o.status(peer, 'exchanging');
        void this.sessions.start(peer).catch(() => this.failed(peer, epoch));
      }
    });
    this.relay.onOpen(peer => {
      // A peer can reconnect its signaling while our own socket stays alive.
      // Reopen only an established crypto session, never infer contact consent.
      // As with existing signaling, its server can interrupt availability, but
      // cannot complete the new signed ECDH handshake on a client's behalf.
      if (!this.isReady(peer)) return;
      const epoch = ++this.generation; this.epochs.set(peer, epoch);
      this.sessions.drop(peer); this.readyPeers.delete(peer); this.remoteSync.delete(peer);
      this.outgoing.delete(peer); this.touched.set(peer, Date.now());
      o.status(peer, 'exchanging');
      void this.sessions.start(peer).catch(() => this.failed(peer, epoch));
    });
    this.relay.onMessage(message => this.enqueue(message));
    this.timer = setInterval(() => this.tick(), 1000);
  }
  private current() { return !this.stopped && this.options.current(); }
  private guard(peer: string, epoch?: number) {
    if (!this.current() || this.options.contact(peer) === 'blocked' ||
        epoch !== undefined && this.epochs.get(peer) !== epoch) throw Error('introduction_forbidden');
  }
  isReady(peer: string) { return this.current() && this.readyPeers.has(peer) && this.options.contact(peer) !== 'blocked'; }
  start(peer: string) {
    if (!this.current() || this.options.contact(peer) === 'blocked' || this.options.directReady(peer)) return;
    if (!this.desired.has(peer) && this.desired.size < 32) {
      this.desired.set(peer, Date.now() + 3000); this.options.status(peer, 'connecting');
    }
  }
  private tick() {
    if (!this.current()) return;
    for (const [peer, at] of this.desired) {
      if (this.options.contact(peer) === 'blocked' || this.options.directReady(peer)) {
        this.desired.delete(peer); this.relay.release(peer); continue;
      }
      if (at <= Date.now() && !this.relay.has(peer)) {
        this.desired.set(peer, Date.now() + 30000);
        void this.relay.connect(peer).catch(e => {
          if (this.current()) this.options.status(peer, e instanceof Error && e.message === 'introduction_unsupported' ? 'unsupported' : 'unavailable');
        });
      }
    }
    for (const [peer, at] of this.touched) if (Date.now() - at > (this.readyPeers.has(peer) ? 120000 : 15000)) {
      if (this.options.contact(peer) === 'accepted') this.desired.delete(peer);
      this.relay.release(peer);
    }
  }
  private failed(peer: string, epoch?: number) {
    if (!this.current() || epoch !== this.epochs.get(peer)) return;
    this.relay.release(peer); this.options.status(peer, 'failed');
  }
  private async sendFrame(peer: string, frame: Uint8Array) {
    const epoch = this.epochs.get(peer); this.guard(peer, epoch);
    const o = this.options, timestamp = Date.now(), messageId = crypto.randomUUID();
    const content = new Uint8Array(DOMAIN.length + frame.length); content.set(DOMAIN); content.set(frame, DOMAIN.length);
    const signature = await o.identity.provider.sign(buildSignInput(content, timestamp, messageId, o.identity.address, peer));
    const pub = await o.identity.provider.getPublicKeyBytes(); this.guard(peer, epoch);
    await this.relay.send({ from: o.identity.address, to: peer, timestamp, messageId, ttl: 7,
      signature, payload: buildPayload(pub, content) });
  }
  private enqueue(message: TransportMessage) {
    if (!this.current() || this.inFlight >= 64 || message.payload.length > INTRODUCTION_MAX_BYTES) return;
    this.inFlight++;
    const previous = this.incoming.get(message.from) ?? Promise.resolve();
    const epoch = this.epochs.get(message.from);
    const next = previous.catch(() => {}).then(() => this.receive(message, epoch));
    this.incoming.set(message.from, next);
    void next.catch(() => { /* Invalid or stale packets never produce receipts or consent. */ }).finally(() => {
      this.inFlight--; if (this.incoming.get(message.from) === next) this.incoming.delete(message.from);
    });
  }
  private async receive(message: TransportMessage, epoch?: number) {
    const peer = message.from; this.guard(peer, epoch);
    const verified = await verifySignedEnvelope(message, this.options.identity.address, webCryptoEnvironment(), INTRODUCTION_MAX_BYTES);
    this.guard(peer, epoch);
    if (verified.timestamp < Date.now() - 5 * 60_000) throw Error('introduction_stale');
    const bytes = verified.encryptedFrame;
    if (bytes.length <= DOMAIN.length || !DOMAIN.every((v,i) => bytes[i] === v)) throw Error('introduction_domain');
    const plaintext = await this.sessions.receive(peer, bytes.subarray(DOMAIN.length));
    if (!plaintext) return;
    try {
      this.guard(peer, epoch); this.touched.set(peer, Date.now());
      await this.handle(peer, JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(plaintext)) as Packet, epoch);
    }
    finally { plaintext.fill(0); }
  }
  private async send(peer: string, packet: Packet) {
    const epoch = this.epochs.get(peer); this.guard(peer, epoch);
    const previous = this.outgoing.get(peer) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      this.guard(peer, epoch); await this.options.authorize(peer); this.guard(peer, epoch);
      if (!this.isReady(peer)) throw Error('introduction_unavailable');
      const bytes = encoder.encode(JSON.stringify(packet));
      if (bytes.length > 18000) throw Error('introduction_too_large');
      try {
        const frame = await this.sessions.encrypt(peer, bytes); this.guard(peer, epoch);
        await this.sendFrame(peer, frame);
      } finally { bytes.fill(0); }
    });
    this.outgoing.set(peer, next);
    try { await next; } finally { if (this.outgoing.get(peer) === next) this.outgoing.delete(peer); }
  }
  private async exchange(peer: string) {
    const epoch = this.epochs.get(peer), o = this.options, state = o.contact(peer);
    if (state === 'outgoing') {
      const request = o.request(peer);
      if (request) {
        await this.send(peer, {kind:'request', request}); this.guard(peer, epoch);
        if (o.contact(peer) === 'outgoing') o.status(peer, 'request_sent');
      }
    } else if (state === 'accepted') {
      await this.send(peer, {kind:'sync'}); this.guard(peer, epoch);
      if (o.incomingRequest(peer)) await this.accept(peer);
      o.ready(peer);
    }
  }
  private async handle(peer: string, packet: Packet, epoch?: number) {
    this.guard(peer, epoch); const o = this.options;
    if (!packet || typeof packet !== 'object' || Array.isArray(packet)) return;
    if (packet.kind === 'request') {
      const r = packet.request;
      if (!r || !UUID.test(r.id) || typeof r.content !== 'string' || encoder.encode(r.content).length > 4096 ||
          !Number.isSafeInteger(r.timestamp) || r.timestamp < 0 || r.timestamp > Date.now() + 300000) return;
      // An established contact may replay its original introduction after an
      // interruption, but this service path is not an ordinary message relay.
      if (o.contact(peer) === 'accepted' && o.incomingRequest(peer) !== r.id) return;
      const decoded = decodeChatContent(r.content);
      if (!decoded || decoded.details?.pin || decoded.details?.ephemeral || decoded.details?.ephemeralOpened) return;
      await o.authorize(peer); this.guard(peer, epoch);
      await o.receive({ id:r.id, from:peer, text:decoded.text, timestamp:r.timestamp, details:decoded.details, verified:true, via:'introduction' });
      this.guard(peer, epoch);
      // Receiving handler must durably save before we send this end-to-end ACK.
      await this.send(peer, {kind:'received', requestId:r.id});
      if (o.contact(peer) === 'accepted') { await this.send(peer, {kind:'accept', requestId:r.id}); o.ready(peer); }
      return;
    }
    if (packet.kind === 'received' || packet.kind === 'accept') {
      if (!UUID.test(packet.requestId) || o.request(peer)?.id !== packet.requestId) return;
      if (packet.kind === 'received') {
        await o.received(peer, packet.requestId); this.guard(peer, epoch);
        if (o.contact(peer) === 'outgoing') o.status(peer, 'waiting_acceptance');
      } else if (o.contact(peer) === 'outgoing') {
        await o.accept(peer); this.guard(peer, epoch); o.status(peer, 'accepted'); o.ready(peer);
      }
      return;
    }
    if (o.contact(peer) !== 'accepted') return;
    if (packet.kind === 'sync') {
      if (!this.remoteSync.has(peer)) { this.remoteSync.add(peer); o.ready(peer); }
    } else if ((packet.kind === 'courier' || packet.kind === 'offline') && packet.bundle && typeof packet.bundle === 'object') {
      await o.keys(peer, packet.kind, packet.bundle); this.guard(peer, epoch); o.status(peer, 'accepted');
    }
  }
  async accept(peer: string) {
    this.guard(peer);
    if (this.options.contact(peer) !== 'accepted') throw Error('introduction_not_accepted');
    const requestId = this.options.incomingRequest(peer);
    if (!requestId) return;
    if (!this.isReady(peer)) { this.start(peer); throw Error('introduction_unavailable'); }
    await this.send(peer, {kind:'accept', requestId});
  }
  async sendKeys(peer: string, kind: 'courier' | 'offline', bundle: unknown) {
    if (this.options.contact(peer) !== 'accepted') throw Error('introduction_not_accepted');
    // Consent precedes prekeys even when the UI publishes them concurrently.
    if (this.options.incomingRequest(peer)) await this.accept(peer);
    await this.send(peer, {kind, bundle});
  }
  close() {
    if (this.stopped) return;
    this.stopped = true; clearInterval(this.timer); this.relay.close(); this.sessions.close();
    this.readyPeers.clear(); this.desired.clear(); this.touched.clear(); this.remoteSync.clear();
    this.incoming.clear(); this.outgoing.clear();
  }
}
