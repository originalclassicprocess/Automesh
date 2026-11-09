import { audioFingerprint, callDigest, normalizeCallSignal, RING_MS, CONNECT_MS, verificationCode, type CallSignal } from './protocol';

export type CallPhase = 'idle' | 'incoming' | 'outgoing' | 'connecting' | 'active' | 'reconnecting' | 'ended';
export type CallReason = 'finished' | 'declined' | 'busy' | 'unanswered' | 'network' | 'microphone' | 'security' | 'unsupported';
export interface CallView {
  phase: CallPhase; id: string; peer: string; outgoing: boolean; muted: boolean;
  authenticated: boolean; code: string; started: number; reason?: CallReason;
  created: number; ended: number; stage: 'permission' | 'invite' | 'offer' | 'answer' | 'ice' | 'active';
  failure?: string;
  endedByPeer?: boolean;
}
export const idleCall = (): CallView => ({ phase: 'idle', id: '', peer: '', outgoing: false, muted: false, authenticated: false, code: '', started: 0, created: 0, ended: 0, stage: 'invite' });
export interface CallPorts {
  self: string;
  allowed(peer: string): boolean;
  online(peer: string): boolean;
  send(peer: string, value: CallSignal): Promise<void>;
  config(peer: string): RTCConfiguration;
  media(): Promise<MediaStream>;
  peerConnection(config: RTCConfiguration): RTCPeerConnection;
  update(view: CallView): void;
  remote(stream: MediaStream | null): void;
  now?: () => number;
}
interface Session {
  id: string; peer: string; outgoing: boolean; expires: number; deadline: number;
  pc?: RTCPeerConnection; stream?: MediaStream; remote?: MediaStream;
  offer?: string; answer?: string; digest?: string; pendingConfirm?: string;
  confirmed: boolean; accepting: boolean; accepted: boolean;
  candidates: RTCIceCandidateInit[]; localCandidates: RTCIceCandidateInit[];
  announced: boolean; candidateCount: number; timer?: ReturnType<typeof setTimeout>;
  sendQueue: Promise<void>;
}

// One bounded call per opened account. No global state, no persisted media,
// no plaintext fallback. All async continuations re-check session ownership.
export class CallController {
  private session?: Session;
  private view = idleCall();
  private closed = false;
  private incoming: Promise<void> = Promise.resolve();
  private pending = 0;
  private seen = new Map<string, number>();
  private ringAfter = new Map<string, number>();
  constructor(private readonly ports: CallPorts) {}
  private now(): number { return this.ports.now?.() ?? Date.now(); }
  snapshot(): CallView { return { ...this.view }; }
  private current(s: Session): boolean { return !this.closed && this.session === s; }
  private publish(patch: Partial<CallView>): void { this.view = { ...this.view, ...patch }; this.ports.update({ ...this.view }); }
  private newSession(peer: string, id: string, expires: number, outgoing: boolean): Session {
    const s: Session = { peer, id, expires, deadline: this.now() + RING_MS, outgoing, accepting: false, accepted: false, confirmed: false, announced: false,
      candidates: [], localCandidates: [], candidateCount: 0, sendQueue: Promise.resolve() };
    this.session = s;
    this.view = { ...idleCall(), id, peer, outgoing, created: this.now(), phase: outgoing ? 'outgoing' : 'incoming' };
    // Remote wall clocks are not a freshness authority. MAE rejects replayed
    // frames; each side bounds the live invitation using its own local deadline.
    this.publish({}); this.arm(s, RING_MS, 'unanswered');
    return s;
  }
  private remember(id: string): void {
    for (const [key, until] of this.seen) if (until <= this.now()) this.seen.delete(key);
    if (this.seen.size >= 256) this.seen.delete(this.seen.keys().next().value!);
    this.seen.set(id, this.now() + RING_MS * 2);
  }
  async start(peer: string): Promise<void> {
    if (this.closed || this.session) return;
    if (!this.ports.allowed(peer) || peer === this.ports.self || !this.ports.online(peer)) throw new Error('call_peer_unavailable');
    const s = this.newSession(peer, crypto.randomUUID(), this.now() + RING_MS, true);
    this.remember(s.id);
    // A click on Call is the caller's consent. Request permission in that user
    // gesture, not later from an incoming asynchronous accept event (WebKit).
    this.publish({ stage: 'permission' });
    try { await this.acquire(s); }
    catch (error) { if (this.current(s)) { this.failure(error); this.finish(s, 'microphone'); } return; }
    if (!this.current(s)) return;
    s.expires = this.now() + RING_MS; s.deadline = s.expires;
    this.publish({ stage: 'invite' }); this.arm(s, RING_MS, 'unanswered');
    await this.send(s, { kind: 'invite', id: s.id, expires: s.expires });
  }
  async accept(): Promise<void> {
    const s = this.session;
    if (!s || s.outgoing || s.accepting || s.accepted || this.view.phase !== 'incoming') return;
    if (!this.ports.allowed(s.peer) || !this.ports.online(s.peer) || this.now() >= s.deadline) { this.finish(s, 'unanswered', true); return; }
    s.accepting = true; this.publish({ phase: 'connecting', stage: 'permission' }); this.arm(s, CONNECT_MS, 'network');
    try {
      await this.acquire(s);
      if (!this.current(s)) return;
      s.accepted = true;
      await this.send(s, { kind: 'accept', id: s.id });
    } catch (error) { if (this.current(s)) { this.failure(error); this.finish(s, 'microphone', true); } }
  }
  receive(peer: string, raw: unknown): Promise<void> {
    if (this.closed || this.pending >= 64) return Promise.resolve();
    const signal = normalizeCallSignal(raw);
    if (!signal) return Promise.resolve();
    this.pending++;
    const next = this.incoming.catch(() => {}).then(() => this.handle(peer, signal));
    this.incoming = next;
    return next.catch(() => {}).finally(() => { this.pending--; });
  }
  private async handle(peer: string, signal: CallSignal): Promise<void> {
    if (this.closed || peer === this.ports.self) return;
    if (signal.kind === 'invite') {
      if (!this.ports.allowed(peer) || !this.ports.online(peer) || signal.expires <= 0 || this.seen.has(signal.id)) return;
      this.remember(signal.id);
      if (this.session) {
        // Crossed invites terminate both predictably; no hidden second call.
        await this.ports.send(peer, { kind: 'busy', id: signal.id }).catch(() => {});
        return;
      }
      if ((this.ringAfter.get(peer) ?? 0) > this.now()) return;
      if (this.ringAfter.size >= 128) this.ringAfter.delete(this.ringAfter.keys().next().value!);
      this.ringAfter.set(peer, this.now() + 5_000);
      this.newSession(peer, signal.id, signal.expires, false); return;
    }
    const s = this.session;
    if (!s || s.peer !== peer || s.id !== signal.id) return;
    try {
      if (signal.kind === 'end' || signal.kind === 'busy') { this.publish({ endedByPeer: true }); this.finish(s, signal.kind === 'busy' ? 'busy' : signal.reason ?? (this.view.started ? 'finished' : s.accepted ? 'network' : 'declined')); return; }
      if (signal.kind === 'accept') {
        if (!s.outgoing || s.accepted || this.now() >= s.deadline) return;
        s.accepted = true; this.publish({ phase: 'connecting', stage: 'offer' }); this.arm(s, CONNECT_MS, 'network');
        // SDP setup does not hold the receive actor; end/candidate controls
        // can arrive while browser negotiation is in progress.
        void this.beginOffer(s); return;
      }
      if (signal.kind === 'offer') {
        if (s.outgoing || !s.accepted || s.offer) return;
        this.publish({ stage: 'answer' });
        audioFingerprint(signal.sdp);
        const pc = this.createPC(s); s.offer = signal.sdp;
        await pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
        if (!this.current(s)) return;
        await this.flushCandidates(s);
        if (!this.current(s)) return;
        await pc.setLocalDescription(await pc.createAnswer());
        if (!this.current(s)) return;
        s.answer = pc.localDescription?.sdp;
        if (!s.answer) throw new Error('call_security'); audioFingerprint(s.answer);
        await this.bind(s);
        if (!this.current(s)) return;
        await this.send(s, { kind: 'answer', id: s.id, sdp: s.answer });
        await this.announceCandidates(s);
        await this.send(s, { kind: 'confirm', id: s.id, digest: s.digest! }); return;
      }
      if (signal.kind === 'answer') {
        if (!s.outgoing || !s.offer || s.answer || !s.pc) return;
        this.publish({ stage: 'ice' });
        audioFingerprint(signal.sdp); s.answer = signal.sdp;
        await s.pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
        if (!this.current(s)) return;
        await this.flushCandidates(s); await this.bind(s);
        if (!this.current(s)) return;
        await this.send(s, { kind: 'confirm', id: s.id, digest: s.digest! }); return;
      }
      if (signal.kind === 'confirm') {
        if (!s.accepted) return;
        if (s.digest) { if (s.digest !== signal.digest) throw new Error('call_security'); s.confirmed = true; this.activate(s); }
        else if (s.pendingConfirm && s.pendingConfirm !== signal.digest) throw new Error('call_security');
        else s.pendingConfirm = signal.digest;
        return;
      }
      if (signal.kind === 'candidate' && s.accepted) {
        if (++s.candidateCount > 64) throw new Error('call_security');
        if (s.pc?.remoteDescription) await s.pc.addIceCandidate(signal.candidate);
        else s.candidates.push(signal.candidate);
      }
    } catch (error) {
      if (this.current(s)) this.failure(error);
      if (this.current(s)) this.finish(s, error instanceof Error && error.message === 'call_security' ? 'security' : 'network', true);
    }
  }
  private async beginOffer(s: Session): Promise<void> {
    if (!this.current(s)) return;
    try {
      const pc = this.createPC(s);
      await pc.setLocalDescription(await pc.createOffer());
      if (!this.current(s)) return;
      s.offer = pc.localDescription?.sdp;
      if (!s.offer) throw new Error('call_security'); audioFingerprint(s.offer);
      await this.send(s, { kind: 'offer', id: s.id, sdp: s.offer });
      await this.announceCandidates(s);
    } catch (error) {
      if (this.current(s)) { this.failure(error); this.finish(s, error instanceof Error && error.message === 'call_security' ? 'security' : 'network', true); }
    }
  }
  private async acquire(s: Session): Promise<void> {
    const stream = await this.ports.media();
    if (!this.current(s)) { stream.getTracks().forEach(track => track.stop()); return; }
    if (stream.getAudioTracks().length !== 1 || stream.getVideoTracks().length || stream.getAudioTracks()[0].readyState !== 'live') {
      stream.getTracks().forEach(track => track.stop()); throw new Error('microphone');
    }
    s.stream = stream;
    for (const track of stream.getTracks()) {
      track.enabled = false;
      track.onended = () => { if (this.current(s)) this.finish(s, 'microphone', true); };
    }
  }
  private createPC(s: Session): RTCPeerConnection {
    if (s.pc) return s.pc;
    const pc = this.ports.peerConnection(this.ports.config(s.peer)); s.pc = pc;
    for (const track of s.stream!.getAudioTracks()) pc.addTrack(track, s.stream!);
    pc.onicecandidate = event => {
      if (!this.current(s) || !event.candidate) return;
      const candidate = event.candidate.toJSON();
      if (s.localCandidates.length >= 64) { this.finish(s, 'network', true); return; }
      if (!s.announced) s.localCandidates.push(candidate);
      else void this.send(s, { kind: 'candidate', id: s.id, candidate });
    };
    pc.ontrack = event => {
      if (!this.current(s)) return;
      if (event.track.kind !== 'audio') { this.finish(s, 'security', true); return; }
      s.remote = new MediaStream([event.track]);
      if (this.view.authenticated) this.ports.remote(s.remote);
    };
    pc.onconnectionstatechange = () => {
      if (!this.current(s)) return;
      if (pc.connectionState === 'connected') this.activate(s);
      else if (pc.connectionState === 'disconnected') {
        this.publish({ phase: 'reconnecting' }); this.arm(s, 15_000, 'network');
      } else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.finish(s, 'network', true);
    };
    return pc;
  }
  private async announceCandidates(s: Session): Promise<void> {
    if (!this.current(s)) return;
    s.announced = true;
    for (const candidate of s.localCandidates.splice(0)) { if (!this.current(s)) return; await this.send(s, { kind: 'candidate', id: s.id, candidate }); }
  }
  private async flushCandidates(s: Session): Promise<void> {
    for (const candidate of s.candidates.splice(0)) { if (!this.current(s)) return; await s.pc!.addIceCandidate(candidate); }
  }
  private async bind(s: Session): Promise<void> {
    const digest = await callDigest({ id: s.id, expires: s.expires, caller: s.outgoing ? this.ports.self : s.peer,
      callee: s.outgoing ? s.peer : this.ports.self, offer: s.offer!, answer: s.answer! });
    if (!this.current(s)) return;
    s.digest = digest;
    this.publish({ stage: 'ice' });
    if (s.pendingConfirm) {
      if (s.pendingConfirm !== digest) throw new Error('call_security');
      s.confirmed = true;
    }
    this.publish({ code: verificationCode(digest) }); this.activate(s);
  }
  private activate(s: Session): void {
    if (!this.current(s) || !s.confirmed || !s.digest || s.pc?.connectionState !== 'connected') return;
    clearTimeout(s.timer);
    for (const track of s.stream?.getAudioTracks() ?? []) track.enabled = !this.view.muted;
    this.publish({ phase: 'active', stage: 'active', authenticated: true, started: this.view.started || this.now() });
    if (s.remote) this.ports.remote(s.remote);
  }
  private send(s: Session, value: CallSignal): Promise<void> {
    const next = s.sendQueue.catch(() => {}).then(async () => {
      if (!this.current(s)) return;
      await this.ports.send(s.peer, value);
    });
    s.sendQueue = next;
    return next.catch(() => { if (this.current(s)) this.finish(s, 'network'); });
  }
  private arm(s: Session, ms: number, reason: CallReason): void {
    clearTimeout(s.timer); s.timer = setTimeout(() => { if (this.current(s)) this.finish(s, reason, true); }, ms);
  }
  private failure(error: unknown): void {
    const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
    if (['NotAllowedError', 'NotFoundError', 'NotReadableError', 'OverconstrainedError', 'InvalidStateError', 'OperationError', 'NotSupportedError'].includes(name)) this.publish({ failure: name });
  }
  mute(): void {
    const s = this.session; if (!s) return;
    this.publish({ muted: !this.view.muted });
    for (const track of s.stream?.getAudioTracks() ?? []) track.enabled = this.view.authenticated && !this.view.muted;
  }
  end(): void { if (this.session) this.finish(this.session, this.view.phase === 'incoming' ? 'declined' : 'finished', true); }
  verificationFailed(): void { if (this.session) this.finish(this.session, 'security', true); }
  peerUnavailable(peer: string): void {
    const s = this.session;
    // Losing the chat route does not tear down an already authenticated media path.
    if (s?.peer === peer && !this.view.authenticated) this.finish(s, 'network');
  }
  revoke(peer: string): void { if (this.session?.peer === peer) this.finish(this.session, 'finished', true); }
  dismiss(): void { if (!this.session) { this.view = idleCall(); this.publish({}); } }
  dispose(): void {
    if (this.session) this.finish(this.session, 'finished', true);
    this.closed = true; this.seen.clear(); this.ringAfter.clear(); this.view = idleCall(); this.ports.update(this.view);
  }
  private finish(s: Session, reason: CallReason, notify = false): void {
    if (!this.current(s)) return;
    this.session = undefined; clearTimeout(s.timer);
    for (const track of s.stream?.getTracks() ?? []) { track.onended = null; track.enabled = false; try { track.stop(); } catch {} }
    if (s.pc) { s.pc.ontrack = null; s.pc.onicecandidate = null; s.pc.onconnectionstatechange = null; try { s.pc.close(); } catch {} }
    this.ports.remote(null);
    this.publish({ phase: 'ended', reason, ended: this.now(), authenticated: false, code: '' });
    if (notify) void this.ports.send(s.peer, { kind: 'end', id: s.id, reason }).catch(() => {});
  }
}
