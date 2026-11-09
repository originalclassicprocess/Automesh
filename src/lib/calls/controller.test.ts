import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CallController, type CallView } from './controller';
import { testSdp } from './fixture';
import type { CallSignal } from './protocol';
class FakeTrack {
  kind = 'audio'; readyState = 'live'; enabled = true; onended: (() => void) | null = null;
  stop = vi.fn(() => { this.readyState = 'ended'; });
}
class FakeStream {
  constructor(readonly tracks: FakeTrack[] = [new FakeTrack()]) {}
  getTracks() { return this.tracks; }
  getAudioTracks() { return this.tracks.filter(t => t.kind === 'audio'); }
  getVideoTracks() { return this.tracks.filter(t => t.kind === 'video'); }
}
class FakePC {
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  connectionState = 'new';
  ontrack: ((event: { track: FakeTrack }) => void) | null = null;
  onicecandidate: ((event: { candidate: { toJSON(): RTCIceCandidateInit } }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  constructor(readonly sdp: string) {}
  addTrack = vi.fn(); addIceCandidate = vi.fn(async () => {});
  createOffer = vi.fn(async () => ({ type: 'offer', sdp: this.sdp }));
  createAnswer = vi.fn(async () => ({ type: 'answer', sdp: this.sdp }));
  setLocalDescription = vi.fn(async (d: RTCSessionDescriptionInit) => { this.localDescription = d; });
  setRemoteDescription = vi.fn(async (d: RTCSessionDescriptionInit) => { this.remoteDescription = d; });
  close = vi.fn(() => { this.connectionState = 'closed'; });
  connected() { this.connectionState = 'connected'; this.onconnectionstatechange?.(); }
}
function endpoint(self: string, byte: string) {
  const stream = new FakeStream(), pcs: FakePC[] = [], sent: CallSignal[] = [], views: CallView[] = [];
  const remote = vi.fn(), media = vi.fn(async () => stream as unknown as MediaStream);
  let other: CallController | undefined;
  const send = vi.fn(async (_peer: string, signal: CallSignal) => {
    sent.push(signal); if (other) queueMicrotask(() => void other!.receive(self, signal));
  });
  const allowed = vi.fn((peer: string) => peer !== 'stranger');
  const clock = vi.fn(() => Date.now());
  const controller = new CallController({ self, now: clock, allowed, online: () => true, send, config: () => ({ iceServers: [] }), media,
    peerConnection: () => { const pc = new FakePC(testSdp(byte)); pcs.push(pc); return pc as unknown as RTCPeerConnection; },
    update: view => views.push(view), remote });
  return { controller, clock, stream, media, pcs, sent, send, views, remote, allowed, link: (target: CallController) => other = target };
}
const endpoints: ReturnType<typeof endpoint>[] = [];
function pair() {
  const a = endpoint('alice', 'AA'), b = endpoint('bob', 'BB'); endpoints.push(a, b); a.link(b.controller); b.link(a.controller); return { a, b };
}
async function negotiate() {
  const { a, b } = pair(); await a.controller.start('bob');
  await vi.waitFor(() => expect(b.controller.snapshot().phase).toBe('incoming'));
  await b.controller.accept();
  await vi.waitFor(() => { expect(a.sent.some(s => s.kind === 'confirm')).toBe(true); expect(b.sent.some(s => s.kind === 'confirm')).toBe(true); });
  return { a, b };
}
beforeEach(() => { vi.stubGlobal('MediaStream', FakeStream); });
afterEach(() => { endpoints.splice(0).forEach(e => e.controller.dispose()); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('voice call session ownership and consent', () => {
  it('requests caller permission from Call intent but no recipient microphone or SDP on invitation', async () => {
    const { a, b } = pair(); await a.controller.start('bob');
    await vi.waitFor(() => expect(b.controller.snapshot().phase).toBe('incoming'));
    expect(a.media).toHaveBeenCalledOnce(); expect(a.stream.tracks[0].enabled).toBe(false); expect(b.media).not.toHaveBeenCalled(); expect(a.pcs).toHaveLength(0); expect(b.pcs).toHaveLength(0);
    b.controller.end(); await vi.waitFor(() => expect(a.controller.snapshot().reason).toBe('declined'));
  });
  it('requires mutual binding and connected DTLS before enabling audio, then mutes and stops cleanly', async () => {
    const { a, b } = await negotiate();
    expect(a.stream.tracks[0].enabled).toBe(false); expect(b.stream.tracks[0].enabled).toBe(false);
    expect(a.controller.snapshot().authenticated).toBe(false);
    a.pcs[0].connected(); b.pcs[0].connected();
    expect(a.controller.snapshot()).toMatchObject({ phase: 'active', authenticated: true });
    expect(a.controller.snapshot().code).toBe(b.controller.snapshot().code);
    expect(a.stream.tracks[0].enabled).toBe(true);
    a.controller.mute(); expect(a.stream.tracks[0].enabled).toBe(false); a.controller.mute(); expect(a.stream.tracks[0].enabled).toBe(true);
    a.controller.dispose(); expect(a.stream.tracks[0].stop).toHaveBeenCalledOnce(); expect(a.pcs[0].close).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(b.controller.snapshot().phase).toBe('ended')); expect(b.stream.tracks[0].stop).toHaveBeenCalledOnce();
  });
  it('stops delayed caller acquisition on cancellation before sending an invitation', async () => {
    const { a, b } = pair(); let resolve!: (stream: MediaStream) => void;
    a.media.mockImplementation(() => new Promise(r => resolve = r));
    const starting = a.controller.start('bob'); expect(a.media).toHaveBeenCalledOnce();
    a.controller.end(); expect(a.controller.snapshot().phase).toBe('ended');
    resolve(a.stream as unknown as MediaStream); await vi.waitFor(() => expect(a.stream.tracks[0].stop).toHaveBeenCalledOnce());
    await starting; expect(a.pcs).toHaveLength(0); expect(b.media).not.toHaveBeenCalled(); expect(a.sent.some(s => s.kind === 'invite')).toBe(false);
  });
  it('processes remote hangup while the recipient microphone prompt is pending', async () => {
    const { a, b } = pair(); let resolve!: (stream: MediaStream) => void;
    b.media.mockImplementation(() => new Promise(r => resolve = r));
    await a.controller.start('bob'); await vi.waitFor(() => expect(b.controller.snapshot().phase).toBe('incoming'));
    const accepting = b.controller.accept(); a.controller.end();
    await vi.waitFor(() => expect(b.controller.snapshot().phase).toBe('ended'));
    resolve(b.stream as unknown as MediaStream); await accepting;
    expect(b.stream.tracks[0].stop).toHaveBeenCalledOnce(); expect(b.sent.some(s => s.kind === 'accept')).toBe(false);
  });
  it('stops delayed recipient permissions on lock and never revives a disposed session', async () => {
    const { a, b } = pair(); let resolve!: (stream: MediaStream) => void;
    b.media.mockImplementation(() => new Promise(r => resolve = r));
    await a.controller.start('bob'); await vi.waitFor(() => expect(b.controller.snapshot().phase).toBe('incoming'));
    const accepting = b.controller.accept(); b.controller.dispose(); resolve(b.stream as unknown as MediaStream); await accepting;
    expect(b.stream.tracks[0].stop).toHaveBeenCalledOnce(); expect(b.sent.some(s => s.kind === 'accept')).toBe(false); expect(b.controller.snapshot().phase).toBe('idle');
  });
  it('rejects unknown contacts, invalid invites, replays and other peers controls', async () => {
    const { b } = pair(); const invite = { kind: 'invite' as const, id: crypto.randomUUID(), expires: Date.now() + 40000 };
    await b.controller.receive('stranger', invite); expect(b.controller.snapshot().phase).toBe('idle');
    await b.controller.receive('alice', { ...invite, expires: 0 }); expect(b.controller.snapshot().phase).toBe('idle');
    await b.controller.receive('alice', invite); await b.controller.receive('eve', { kind: 'end', id: invite.id });
    expect(b.controller.snapshot().phase).toBe('incoming'); b.controller.end(); b.controller.dismiss();
    await b.controller.receive('alice', invite); expect(b.controller.snapshot().phase).toBe('idle');
  });
  it('ends safely on microphone denial without a retry loop', async () => {
    const { a, b } = pair(); b.media.mockRejectedValue(new Error('NotAllowedError'));
    await a.controller.start('bob'); await vi.waitFor(() => expect(b.controller.snapshot().phase).toBe('incoming')); await b.controller.accept();
    expect(b.controller.snapshot().reason).toBe('microphone'); expect(b.media).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(a.controller.snapshot().phase).toBe('ended'));
  });
  it('does not terminate active media when only the chat route disappears; revocation still stops it', async () => {
    const { a, b } = await negotiate(); a.pcs[0].connected(); b.pcs[0].connected();
    a.controller.peerUnavailable('bob'); expect(a.controller.snapshot().phase).toBe('active');
    a.controller.revoke('bob'); expect(a.controller.snapshot().phase).toBe('ended'); expect(a.stream.tracks[0].stop).toHaveBeenCalledOnce();
  });
  it('fails closed when the peer confirms different parameters', async () => {
    const { a, b } = await negotiate();
    await a.controller.receive('bob', { kind: 'confirm', id: a.controller.snapshot().id, digest: '00'.repeat(32) });
    expect(a.controller.snapshot().reason).toBe('security'); expect(a.stream.tracks[0].enabled).toBe(false); expect(a.stream.tracks[0].stop).toHaveBeenCalledOnce();
    b.pcs[0].connected();
  });
  it('does not enable audio on connected transport alone, and rejects plaintext SDP', async () => {
    const a = endpoint('alice', 'AA'); endpoints.push(a); await a.controller.start('bob'); const id = a.controller.snapshot().id;
    await a.controller.receive('bob', { kind: 'accept', id }); await vi.waitFor(() => expect(a.pcs).toHaveLength(1));
    a.pcs[0].connected(); expect(a.stream.tracks[0].enabled).toBe(false);
    await a.controller.receive('bob', { kind: 'answer', id, sdp: testSdp().replace('UDP/TLS/RTP/SAVPF', 'RTP/AVP') });
    expect(a.controller.snapshot().reason).toBe('security');
  });
  it('bounds setup, disconnection and invitation lifetimes', async () => {
    vi.useFakeTimers(); const { a } = pair(); await a.controller.start('bob');
    await vi.advanceTimersByTimeAsync(45001); expect(a.controller.snapshot().reason).toBe('unanswered');
    a.media.mockImplementation(async () => new FakeStream() as unknown as MediaStream);
    a.controller.dismiss(); await a.controller.start('bob'); await a.controller.receive('bob', { kind: 'accept', id: a.controller.snapshot().id });
    await vi.advanceTimersByTimeAsync(30001); expect(a.controller.snapshot().reason).toBe('network');
  });
  it('terminates crossed invitations as busy without acquiring either microphone', async () => {
    const { a, b } = pair(); await Promise.all([a.controller.start('bob'), b.controller.start('alice')]);
    await vi.waitFor(() => { expect(a.controller.snapshot().phase).toBe('ended'); expect(b.controller.snapshot().phase).toBe('ended'); });
    expect(a.stream.tracks[0].stop).toHaveBeenCalledOnce(); expect(b.stream.tracks[0].stop).toHaveBeenCalledOnce(); expect(a.controller.snapshot().reason).toBe('busy');
  });
  it('bounds candidate work and ignores ended-call continuations', async () => {
    const { a } = pair(); await a.controller.start('bob'); const id = a.controller.snapshot().id;
    await a.controller.receive('bob', { kind: 'accept', id });
    for (let i = 0; i < 65; i++) await a.controller.receive('bob', { kind: 'candidate', id, candidate: { candidate: 'candidate:fake', sdpMid: '0', sdpMLineIndex: 0 } });
    expect(a.controller.snapshot().reason).toBe('security');
    await vi.waitFor(() => expect(a.stream.tracks[0].stop).toHaveBeenCalledOnce());
    const count = a.pcs.length; await a.controller.receive('bob', { kind: 'accept', id }); expect(a.pcs).toHaveLength(count);
  });
  it('recovers the same authenticated media path within the bounded interruption window', async () => {
    const { a, b } = await negotiate(); a.pcs[0].connected(); b.pcs[0].connected();
    a.pcs[0].connectionState = 'disconnected'; a.pcs[0].onconnectionstatechange?.(); expect(a.controller.snapshot().phase).toBe('reconnecting');
    a.pcs[0].connected(); expect(a.controller.snapshot().phase).toBe('active'); expect(a.stream.tracks[0].stop).not.toHaveBeenCalled();
    a.controller.verificationFailed(); expect(a.controller.snapshot().reason).toBe('security');
  });
  it('establishes identical binding despite clocks differing by twelve hours in either direction', async () => {
    for (const shift of [-12, 12]) {
      const { a, b } = pair(); b.clock.mockImplementation(() => Date.now() + shift * 3600000);
      await a.controller.start('bob'); await vi.waitFor(() => expect(b.controller.snapshot().phase).toBe('incoming'));
      await b.controller.accept(); await vi.waitFor(() => expect(a.sent.some(s => s.kind === 'confirm')).toBe(true));
      a.pcs[0].connected(); b.pcs[0].connected(); expect(a.controller.snapshot().authenticated).toBe(true); expect(b.controller.snapshot().code).toBe(a.controller.snapshot().code);
      a.controller.end(); await vi.waitFor(() => expect(b.controller.snapshot().phase).toBe('ended'));
    }
  });
  it('freezes end time and sends a bounded failure reason instead of claiming a successful call', async () => {
    const { a, b } = await negotiate(); a.pcs[0].connected(); b.pcs[0].connected();
    const endAt = Date.now() + 32000; a.clock.mockReturnValue(endAt); a.controller.end();
    expect(a.controller.snapshot().ended).toBe(endAt); a.clock.mockReturnValue(endAt + 60000);
    expect(a.controller.snapshot().ended).toBe(endAt);
    expect(a.sent.at(-1)).toMatchObject({ kind: 'end', reason: 'finished' });
    await vi.waitFor(() => expect(b.controller.snapshot().reason).toBe('finished'));
  });
});
