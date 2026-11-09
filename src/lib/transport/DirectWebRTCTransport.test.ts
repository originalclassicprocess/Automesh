import { afterEach, expect, it, vi } from 'vitest';
import { DirectWebRTCTransport } from './DirectWebRTCTransport';
import { RoutedWebRTCTransport } from './RoutedWebRTCTransport';
import { signDirectInvite, inviteHash } from './direct-invite';
import { ChatService, type ChatMessage } from '$lib/chat/ChatService';
import { emptySessionChats, receiveMessage } from '$lib/chat/session-chats';
import { testSdp, testIdentity } from './direct-test-fixtures';
import type { Transport } from './transport';

const live: Transport[] = [];
afterEach(async () => { await Promise.all(live.map((item) => item.disconnect())); live.length = 0; FakePC.all.length = 0; vi.unstubAllGlobals(); vi.useRealTimers(); });
class FakeChannel {
  label = 'mesh'; ordered = true; readyState = 'connecting'; binaryType = 'arraybuffer'; bufferedAmount = 0;
  bufferedAmountLowThreshold = 0; onopen?: () => void; onclose?: () => void;
  onmessage?: (event: { data:ArrayBuffer }) => void; partner?: FakeChannel; sent: ArrayBuffer[] = [];
  open() { this.readyState = 'open'; this.onopen?.(); }
  send(data: ArrayBuffer) { this.sent.push(data); queueMicrotask(() => this.partner?.onmessage?.({ data })); }
  close() { this.readyState = 'closed'; this.onclose?.(); }
  addEventListener() {} removeEventListener() {}
}
class FakePC {
  static all: FakePC[] = []; id = String(FakePC.all.length + 1); channel?: FakeChannel;
  connectionState = 'new'; iceGatheringState = 'complete'; signalingState = 'stable';
  localDescription?: { type:string; sdp:string }; remoteDescription?: { type:string; sdp:string };
  ondatachannel?: (event:{ channel:FakeChannel }) => void; onconnectionstatechange?: () => void;
  constructor(readonly config: RTCConfiguration) { FakePC.all.push(this); }
  async createOffer() { return { type:'offer', sdp:testSdp(this.id) }; }
  async createAnswer() { return { type:'answer', sdp:testSdp(this.id) }; }
  async setLocalDescription(sdp: {type:string;sdp:string}) { this.localDescription = sdp; }
  async setRemoteDescription(sdp: {type:string;sdp:string}) {
    this.remoteDescription = sdp;
    if (sdp.type === 'answer') {
      const responder = FakePC.all.find((pc) => pc.id === /a=ice-ufrag:(\w+)/.exec(sdp.sdp)?.[1])!;
      const remote = new FakeChannel(); remote.partner = this.channel; this.channel!.partner = remote;
      responder.ondatachannel?.({ channel:remote });
      setTimeout(() => { remote.open(); this.channel!.open(); }, 0);
    }
  }
  createDataChannel() { this.channel = new FakeChannel(); return this.channel; }
  addEventListener() {} removeEventListener() {}
  close() { this.connectionState = 'closed'; }
}

it('uses no WebSocket or ICE servers; signed QR pairing carries real MAE text and retries without UI duplicates', async () => {
  vi.stubGlobal('RTCPeerConnection', FakePC);
  const websocket = vi.fn(() => { throw new Error('must_not_contact_a_server'); }); vi.stubGlobal('WebSocket', websocket);
  const ai = await testIdentity(1); const bi = await testIdentity(2);
  const ar = new RoutedWebRTCTransport([]); const br = new RoutedWebRTCTransport([]); live.push(ar, br);
  const a = new ChatService(ar); const b = new ChatService(br);
  await a.init(ai); await b.init(bi);
  const received: ChatMessage[] = []; let history = emptySessionChats();
  b.onMessage((message) => { received.push(message); history = receiveMessage(history, { ...message, direction:'incoming' }); });
  const offer = await ar.createDirectOffer(); const answer = await br.acceptDirectOffer(offer);
  await ar.acceptDirectAnswer(answer);
  await vi.waitFor(() => expect(ar.getPeerRoutes()[bi.address]).toBe('Прямое QR-соединение'));
  const id = crypto.randomUUID(); await a.send('local QR encrypted text', bi.address, id);
  await vi.waitFor(() => expect(received).toHaveLength(1));
  await a.send('local QR encrypted text', bi.address, id);
  await vi.waitFor(() => expect(received).toHaveLength(2));
  expect(history.byPeer[ai.address].messages).toHaveLength(1);
  expect(websocket).not.toHaveBeenCalled();
  expect(FakePC.all.every((pc) => pc.config.iceServers?.length === 0)).toBe(true);
  for (const pc of FakePC.all) for (const packet of pc.channel?.sent ?? [])
    expect(new TextDecoder().decode(packet)).not.toContain('local QR encrypted text');
  ar.cancelPendingDirect(); br.cancelPendingDirect();
  await ar.configure([], false); await br.configure([], false);
  await a.send('QR survives server opt-out', bi.address);
  await vi.waitFor(() => expect(received).toHaveLength(3));
  expect(ar.getPeerRoutes()[bi.address]).toBe('Прямое QR-соединение');
  ar.closeDirectPeer(bi.address);
  expect(ar.getPeerRoutes()[bi.address]).toBeUndefined();
  expect(FakePC.all[0].connectionState).toBe('closed');
  await a.disconnect(); await b.disconnect();
});

it('rejects a validly signed answer for another attempt without applying remote SDP', async () => {
  vi.stubGlobal('RTCPeerConnection', FakePC);
  const ai = await testIdentity(1); const bi = await testIdentity(2);
  const a = new DirectWebRTCTransport(); const b = new DirectWebRTCTransport(); live.push(a, b);
  await a.init(ai.address, ai.signer); await b.init(bi.address, bi.signer);
  const offer = await a.createOffer(); const answer = await b.acceptOffer(offer);
  const wrong = await signDirectInvite({ ...answer, replyTo:'0'.repeat(64) }, bi.signer);
  await expect(a.acceptAnswer(wrong)).rejects.toThrow('wrong_answer');
  expect(FakePC.all[0].remoteDescription).toBeUndefined();
  const wrongRecipient = await signDirectInvite({ ...answer, to:bi.address }, bi.signer);
  await expect(a.acceptAnswer(wrongRecipient)).rejects.toThrow('wrong_answer');
  expect(await inviteHash(offer)).toBe(answer.replyTo);
});

it('cancels an unfinished offer on section exit/logout and expires abandoned attempts', async () => {
  vi.useFakeTimers(); vi.stubGlobal('RTCPeerConnection', FakePC);
  const ai = await testIdentity(1); const a = new DirectWebRTCTransport(); live.push(a);
  await a.init(ai.address, ai.signer); await a.createOffer();
  a.cancelPending(); expect(FakePC.all[0].connectionState).toBe('closed');
  await a.createOffer(); await vi.advanceTimersByTimeAsync(600_001);
  expect(FakePC.all[1].connectionState).toBe('closed');
  expect(await a.discover()).toEqual([]);
});

it('keeps an unopened DataChannel bounded even when the peer connection reports connected', async () => {
  vi.useFakeTimers(); vi.stubGlobal('RTCPeerConnection', FakePC);
  const ai = await testIdentity(1); const a = new DirectWebRTCTransport(); live.push(a);
  await a.init(ai.address, ai.signer); await a.createOffer();
  FakePC.all[0].connectionState = 'connected'; FakePC.all[0].onconnectionstatechange?.();
  await vi.advanceTimersByTimeAsync(600_001);
  expect(FakePC.all[0].connectionState).toBe('closed');
  expect(await a.discover()).toEqual([]);
});

it('allows the answer its own full scan window even when the original offer has just expired', async () => {
  vi.useFakeTimers(); vi.stubGlobal('RTCPeerConnection', FakePC);
  const ai = await testIdentity(1); const bi = await testIdentity(2);
  const a = new DirectWebRTCTransport(); const b = new DirectWebRTCTransport(); live.push(a, b);
  await a.init(ai.address, ai.signer); await b.init(bi.address, bi.signer);
  const offer = await a.createOffer();
  await vi.advanceTimersByTimeAsync(299_000);
  const answer = await b.acceptOffer(offer);
  expect(answer.expires - answer.created).toBe(300_000);
  expect(answer.expires).toBeGreaterThan(offer.expires);
  await vi.advanceTimersByTimeAsync(2_000);
  await a.acceptAnswer(answer);
  await vi.advanceTimersByTimeAsync(1);
  expect(a.hasPeer(bi.address)).toBe(true);
  expect(b.hasPeer(ai.address)).toBe(true);
});
