import { encodeMessage, decodeMessage } from '$lib/message/transport-codec';
import { DIRECT_LIFETIME_MS, signDirectInvite, verifyDirectInvite, inviteHash, validateDirectSdp,
  type DirectInvite } from './direct-invite';
import { TRANSPORT_CAPABILITIES, type Transport, type TransportStatus, type Peer,
  type TransportRegistrationIdentity, type TransportMessage } from './transport';

type Pair = { pc: RTCPeerConnection; peer: string; packet?: DirectInvite; channel?: RTCDataChannel;
  timer?: ReturnType<typeof setTimeout>; cancelGather?: () => void; applied: boolean };

// Only SDP carried by the user. No WebSocket, STUN, TURN, discovery or server retry.
export class DirectWebRTCTransport implements Transport {
  readonly capabilities = TRANSPORT_CAPABILITIES.lan;
  private self = ''; private identity?: TransportRegistrationIdentity;
  private pairs = new Map<string, Pair>();
  private peers = new Map<string, Pair>();
  private messages: Array<(message: TransportMessage) => void> = [];
  private changes: Array<(peer: Peer, event: 'joined' | 'left') => void> = [];
  private statuses: Array<(status: TransportStatus) => void> = [];
  getStatus(): TransportStatus { return this.peers.size ? 'connected' : 'idle'; }
  onMessage(cb: (message: TransportMessage) => void): void { this.messages.push(cb); }
  onPeerChange(cb: (peer: Peer, event: 'joined' | 'left') => void): void { this.changes.push(cb); }
  onStatusChange(cb: (status: TransportStatus) => void): void { this.statuses.push(cb); }
  async isAvailable(): Promise<boolean> { return typeof RTCPeerConnection !== 'undefined'; }
  async discover(): Promise<Peer[]> { return [...this.peers.keys()].map((address) => this.peer(address)); }
  async init(address: string, identity?: TransportRegistrationIdentity): Promise<void> { this.self = address; this.identity = identity; }
  async connect(peer: Peer): Promise<void> { if (!this.hasPeer(peer.address)) throw new Error('direct_pairing_required'); }
  hasPeer(peer: string): boolean { return this.peers.has(peer); }
  hasPendingPeer(peer: string): boolean { return [...this.pairs.values()].some((pair) => pair.peer === peer); }
  private peer(address: string): Peer { return { address, transport: 'lan', lastSeen: Date.now() }; }

  private createPair(session: string, peer = ''): Pair {
    if (!this.identity || !this.self) throw new Error('not_initialized');
    if (this.peers.size >= 8) throw new Error('direct_peer_limit');
    if (peer && this.hasPeer(peer)) throw new Error('direct_already_connected');
    this.cancelPending();
    const pc = new RTCPeerConnection({ iceServers: [], iceTransportPolicy: 'all' });
    const pair: Pair = { pc, peer, applied: false };
    this.pairs.set(session, pair);
    pair.timer = setTimeout(() => this.closePair(session), DIRECT_LIFETIME_MS);
    pc.ondatachannel = (event) => {
      if (pair.channel || event.channel.label !== 'mesh' || !event.channel.ordered) { event.channel.close(); return; }
      this.attachChannel(session, pair, event.channel);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.closePair(session);
      if (pc.connectionState === 'disconnected') {
        clearTimeout(pair.timer);
        pair.timer = setTimeout(() => { if (pc.connectionState === 'disconnected') this.closePair(session); }, 8_000);
      } else if (pc.connectionState === 'connected' && this.peers.get(pair.peer) === pair) clearTimeout(pair.timer);
    };
    return pair;
  }

  private attachChannel(session: string, pair: Pair, channel: RTCDataChannel): void {
    pair.channel = channel; channel.binaryType = 'arraybuffer';
    channel.onopen = () => {
      if (this.pairs.get(session) !== pair || !pair.peer || !pair.applied) { this.closePair(session); return; }
      clearTimeout(pair.timer);
      this.peers.set(pair.peer, pair);
      for (const cb of this.changes) cb(this.peer(pair.peer), 'joined');
      for (const cb of this.statuses) cb(this.getStatus());
    };
    channel.onclose = () => this.closePair(session);
    channel.onmessage = (event) => {
      if (this.peers.get(pair.peer) !== pair) return;
      try {
        if (!(event.data instanceof ArrayBuffer) || event.data.byteLength > this.capabilities.maxMessageBytes) return;
        const message = decodeMessage(new Uint8Array(event.data));
        if (message.from !== pair.peer || message.to !== this.self) return;
        for (const cb of this.messages) cb(message);
      } catch {  }
    };
  }

  private async gather(session: string, pair: Pair): Promise<string> {
    if (pair.pc.iceGatheringState !== 'complete') await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer); pair.pc.removeEventListener('icegatheringstatechange', changed); pair.cancelGather = undefined;
        if (error) reject(error); else resolve();
      };
      const changed = () => { if (pair.pc.iceGatheringState === 'complete') finish(); };
      const timer = setTimeout(() => finish(new Error('direct_gather_timeout')), 8_000);
      pair.cancelGather = () => finish(new Error('direct_cancelled'));
      pair.pc.addEventListener('icegatheringstatechange', changed); changed();
    });
    if (this.pairs.get(session) !== pair) throw new Error('direct_cancelled');
    const sdp = pair.pc.localDescription?.sdp;
    validateDirectSdp(sdp);
    return sdp;
  }

  async createOffer(): Promise<DirectInvite> {
    const session = crypto.randomUUID(); const pair = this.createPair(session);
    this.attachChannel(session, pair, pair.pc.createDataChannel('mesh', { ordered: true }));
    try {
      await pair.pc.setLocalDescription(await pair.pc.createOffer());
      const sdp = await this.gather(session, pair); const created = Date.now();
      const packet = await signDirectInvite({ type: 'mesh-direct', version: 1, kind: 'offer', session,
        from: this.self, to: '', created, expires: created + DIRECT_LIFETIME_MS, sdp, replyTo: '' }, this.identity!);
      if (this.pairs.get(session) !== pair) throw new Error('direct_cancelled');
      pair.packet = packet;
      // The responder may create a fresh five-minute answer just before this
      // offer expires. Keep the local offer alive long enough to read it.
      clearTimeout(pair.timer); pair.timer = setTimeout(() => this.closePair(session),
        Math.max(1, packet.expires + DIRECT_LIFETIME_MS - Date.now()));
      return packet;
    } catch (error) { this.closePair(session); throw error; }
  }

  async acceptOffer(value: DirectInvite): Promise<DirectInvite> {
    const offer = await verifyDirectInvite(value);
    if (offer.kind !== 'offer' || offer.from === this.self) throw new Error('direct_wrong_offer');
    const pair = this.createPair(offer.session, offer.from);
    try {
      await pair.pc.setRemoteDescription({ type: 'offer', sdp: offer.sdp });
      await pair.pc.setLocalDescription(await pair.pc.createAnswer());
      const sdp = await this.gather(offer.session, pair);
      const created = Date.now();
      if (created >= offer.expires) throw new Error('direct_offer_expired');
      const packet = await signDirectInvite({ type: 'mesh-direct', version: 1, kind: 'answer', session: offer.session,
        from: this.self, to: offer.from, created, expires: created + DIRECT_LIFETIME_MS, sdp,
        replyTo: await inviteHash(offer) }, this.identity!);
      if (this.pairs.get(offer.session) !== pair) throw new Error('direct_cancelled');
      pair.applied = true; pair.packet = packet;
      clearTimeout(pair.timer); pair.timer = setTimeout(() => this.closePair(offer.session), Math.max(1, packet.expires - Date.now()));
      return packet;
    } catch (error) { this.closePair(offer.session); throw error; }
  }

  async acceptAnswer(value: DirectInvite): Promise<string> {
    const answer = await verifyDirectInvite(value); const pair = this.pairs.get(answer.session);
    if (answer.kind !== 'answer' || answer.to !== this.self || answer.from === this.self ||
        !pair?.packet || pair.packet.kind !== 'offer' || pair.applied ||
        answer.created >= pair.packet.expires || answer.replyTo !== await inviteHash(pair.packet)) throw new Error('direct_wrong_answer');
    if (this.hasPeer(answer.from)) throw new Error('direct_already_connected');
    pair.peer = answer.from; pair.applied = true;
    try {
      await pair.pc.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
      if (this.pairs.get(answer.session) !== pair) throw new Error('direct_cancelled');
      clearTimeout(pair.timer); pair.timer = setTimeout(() => { if (!this.hasPeer(answer.from)) this.closePair(answer.session); }, 20_000);
      return answer.from;
    } catch (error) { this.closePair(answer.session); throw error; }
  }

  async send(message: TransportMessage): Promise<void> {
    const pair = this.peers.get(message.to); const channel = pair?.channel;
    if (message.from !== this.self || !channel || channel.readyState !== 'open') throw new Error('peer_unreachable');
    const encoded = encodeMessage(message);
    if (encoded.byteLength > this.capabilities.maxMessageBytes) throw new Error('message_too_large');
    if (channel.bufferedAmount > 512 * 1024) await new Promise<void>((resolve, reject) => {
      channel.bufferedAmountLowThreshold = 128 * 1024;
      const finish = (error?: Error) => {
        clearTimeout(timer); channel.removeEventListener('bufferedamountlow', drained); channel.removeEventListener('close', closed);
        if (error) reject(error); else resolve();
      };
      const drained = () => { if (channel.bufferedAmount <= channel.bufferedAmountLowThreshold) finish(); };
      const closed = () => finish(new Error('channel_closed'));
      const timer = setTimeout(() => finish(new Error('channel_backpressure_timeout')), 15_000);
      channel.addEventListener('bufferedamountlow', drained); channel.addEventListener('close', closed); drained();
    });
    if (this.peers.get(message.to) !== pair || channel.readyState !== 'open') throw new Error('channel_closed');
    channel.send(encoded);
  }

  cancelPending(): void { for (const [session, pair] of [...this.pairs]) if (this.peers.get(pair.peer) !== pair) this.closePair(session); }
  closePeer(peer: string): void { for (const [session, pair] of [...this.pairs]) if (pair.peer === peer) this.closePair(session); }
  private closePair(session: string): void {
    const pair = this.pairs.get(session); if (!pair) return;
    this.pairs.delete(session); clearTimeout(pair.timer); pair.cancelGather?.();
    const live = this.peers.get(pair.peer) === pair;
    if (live) this.peers.delete(pair.peer);
    pair.pc.onconnectionstatechange = null; pair.pc.ondatachannel = null;
    if (pair.channel) { pair.channel.onclose = null; pair.channel.onopen = null; pair.channel.onmessage = null; pair.channel.close(); }
    pair.pc.close();
    if (live) for (const cb of this.changes) cb(this.peer(pair.peer), 'left');
    for (const cb of this.statuses) cb(this.getStatus());
  }
  async disconnect(): Promise<void> { for (const session of [...this.pairs.keys()]) this.closePair(session); this.identity = undefined; this.self = ''; }
}
