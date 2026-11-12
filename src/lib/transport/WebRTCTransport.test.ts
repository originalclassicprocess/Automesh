import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WebRTCTransport } from './WebRTCTransport';
import type { TransportMessage } from './transport';
import { WebCryptoIdentity } from '$lib/identity/webcrypto';
import { getAccountId } from '$lib/addressing/address';
import { bytesToHex } from '$lib/message/encoding';
import { registrationProofBytes } from './registration-proof.js';
import type { CourierReply } from '$lib/node/courier-controller';
import { ATTACHMENT_PROTOCOL } from '$lib/node/attachment-protocol.js';
import { base64 } from '$lib/node/offline-crypto';
import { INTRODUCTION_PROTOCOL } from '../../../nodes/packages/protocol/src/introduction.js';

class FakeWebSocket {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  static legacyRegistration = false;
  static failedRegistrations = 0;
  static registrationIceMode: 'lan' | undefined;
  static unavailableUrls = new Set<string>();
  static hangingUrls = new Set<string>();
  static wrongProbeProtocol = false;
  static introductionProtocol: string | undefined;

  readyState = FakeWebSocket.OPEN;
  bufferedAmount = 0;
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: ((error: Event) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  sent: Array<Record<string, unknown>> = [];

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => {
      if (FakeWebSocket.hangingUrls.has(url)) return;
      if (FakeWebSocket.unavailableUrls.has(url)) this.close();
      else this.onopen?.();
    });
  }

  send(data: string) {
    const message = JSON.parse(data);
    this.sent.push(message);
    if (message.type === 'probe') {
      queueMicrotask(() => this.emit({ type: 'probe_result', protocol: FakeWebSocket.wrongProbeProtocol ? 'other' : 'mesh-signaling-v1' }));
    } else if (message.type === 'register') {
      if (FakeWebSocket.failedRegistrations > 0) {
        FakeWebSocket.failedRegistrations--;
        queueMicrotask(() => this.close());
        return;
      }
      queueMicrotask(() => this.onmessage?.({
        data: JSON.stringify(typeof message.address === 'string' && message.address.startsWith('mesh1') &&
          !FakeWebSocket.legacyRegistration
          ? { type: 'register_challenge', address: message.address, challenge: 'a'.repeat(64) }
          : { type: 'registered', address: message.address, ...(FakeWebSocket.registrationIceMode ? { iceMode: FakeWebSocket.registrationIceMode } : {}) }),
      }));
    } else if (message.type === 'register_proof') {
      queueMicrotask(() => this.onmessage?.({
        data: JSON.stringify({ type: 'registered', address: message.address, attachmentProtocol: ATTACHMENT_PROTOCOL, introductionProtocol:FakeWebSocket.introductionProtocol, ...(FakeWebSocket.registrationIceMode ? { iceMode: FakeWebSocket.registrationIceMode } : {}) }),
      }));
    }
  }

  emit(message: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  close(code = 1000, reason = '') {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
}

class FakeChannel {
  readyState: RTCDataChannelState = 'connecting';
  binaryType: BinaryType = 'blob';
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  private listeners = new Map<string, Set<() => void>>();
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: ArrayBuffer }) => void) | null = null;
  sent: ArrayBuffer[] = [];

  send(data: ArrayBuffer) {
    if (this.readyState !== 'open') throw new Error('channel_not_open');
    this.sent.push(data);
  }

  addEventListener(type: string, listener: () => void) {
    const callbacks = this.listeners.get(type) ?? new Set<() => void>();
    callbacks.add(listener);
    this.listeners.set(type, callbacks);
  }

  removeEventListener(type: string, listener: () => void) { this.listeners.get(type)?.delete(listener); }

  drain() {
    this.bufferedAmount = 0;
    for (const listener of this.listeners.get('bufferedamountlow') ?? []) listener();
  }

  open() {
    this.readyState = 'open';
    this.onopen?.();
  }

  close() {
    this.readyState = 'closed';
    this.onclose?.();
    for (const listener of this.listeners.get('close') ?? []) listener();
  }
}

class FakePeerConnection {
  static instances: FakePeerConnection[] = [];
  static manualGathering = false;

  connectionState: RTCPeerConnectionState = 'new';
  signalingState: RTCSignalingState = 'stable';
  remoteDescription: RTCSessionDescriptionInit | null = null;
  localDescription: RTCSessionDescriptionInit | null = null;
  iceGatheringState: RTCIceGatheringState = FakePeerConnection.manualGathering ? 'new' : 'complete';
  onicecandidate: ((event: { candidate: RTCIceCandidate | null }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;
  ondatachannel: ((event: { channel: RTCDataChannel }) => void) | null = null;
  channel = new FakeChannel();
  offers = 0;
  private listeners = new Map<string, Set<() => void>>();
  config: RTCConfiguration;

  constructor(config: RTCConfiguration) {
    this.config = config;
    FakePeerConnection.instances.push(this);
  }

  createDataChannel() { return this.channel as unknown as RTCDataChannel; }
  async createOffer(): Promise<RTCSessionDescriptionInit> {
    this.offers++;
    return { type: 'offer', sdp: 'offer' };
  }
  async createAnswer(): Promise<RTCSessionDescriptionInit> { return { type: 'answer', sdp: 'answer' }; }
  async setLocalDescription(sdp: RTCSessionDescriptionInit) {
    this.localDescription = sdp;
    this.signalingState = sdp.type === 'offer' ? 'have-local-offer' : 'stable';
  }
  async setRemoteDescription(sdp: RTCSessionDescriptionInit) {
    this.remoteDescription = sdp;
    this.signalingState = sdp.type === 'offer' ? 'have-remote-offer' : 'stable';
  }
  async addIceCandidate() {}
  addEventListener(type: string, listener: () => void) {
    const callbacks = this.listeners.get(type) ?? new Set<() => void>();
    callbacks.add(listener);
    this.listeners.set(type, callbacks);
  }
  removeEventListener(type: string, listener: () => void) { this.listeners.get(type)?.delete(listener); }
  finishIceGathering() {
    this.iceGatheringState = 'complete';
    if (this.localDescription) this.localDescription = { ...this.localDescription, sdp: `${this.localDescription.sdp}\r\na=candidate:1 1 UDP 1 192.168.0.2 5000 typ host` };
    for (const listener of this.listeners.get('icegatheringstatechange') ?? []) listener();
  }
  close() { this.connectionState = 'closed'; }
}

const message: TransportMessage = {
  to: 'rPeer',
  from: 'rAlice',
  payload: new Uint8Array([1, 2]),
  signature: new Uint8Array([3]),
  timestamp: 1,
  messageId: 'test-message',
  ttl: 1,
};

describe('WebRTC peer session', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    FakeWebSocket.legacyRegistration = false;
    FakeWebSocket.failedRegistrations = 0;
    FakeWebSocket.registrationIceMode = undefined;
    FakeWebSocket.unavailableUrls.clear();
    FakeWebSocket.hangingUrls.clear();
    FakeWebSocket.wrongProbeProtocol = false;
    FakeWebSocket.introductionProtocol = undefined;
    FakePeerConnection.instances = [];
    FakePeerConnection.manualGathering = false;
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('RTCPeerConnection', FakePeerConnection);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('includes LAN candidates in the offer SDP before sending it', async () => {
    FakePeerConnection.manualGathering = true;
    vi.stubEnv('VITE_MESH_ICE_MODE', 'lan');
    const transport = new WebRTCTransport();
    await transport.init('rAlice');
    const socket = FakeWebSocket.instances[0];
    const connecting = transport.connect({ address: 'rPeer', transport: 'webrtc', lastSeen: Date.now() });
    await vi.waitFor(() => expect(FakePeerConnection.instances[0]?.localDescription).not.toBeNull());
    expect(socket.sent.some((entry) => entry.type === 'offer')).toBe(false);
    FakePeerConnection.instances[0].finishIceGathering();
    await connecting;
    expect((socket.sent.find((entry) => entry.type === 'offer')?.sdp as RTCSessionDescriptionInit).sdp).toContain('a=candidate:');
    await transport.disconnect();
  });

  it('uses local ICE without STUN when the shared signaling server announces LAN mode', async () => {
    FakePeerConnection.manualGathering = true;
    FakeWebSocket.registrationIceMode = 'lan';
    const transport = new WebRTCTransport();
    await transport.init('rAlice');
    const connecting = transport.connect({ address: 'rPeer', transport: 'webrtc', lastSeen: Date.now() });
    await vi.waitFor(() => expect(FakePeerConnection.instances[0]?.localDescription).not.toBeNull());
    expect(FakePeerConnection.instances[0].config.iceServers).toEqual([]);
    FakePeerConnection.instances[0].finishIceGathering();
    await connecting;
    await transport.disconnect();
  });

  it('includes LAN candidates in the answer SDP before sending it', async () => {
    FakePeerConnection.manualGathering = true;
    vi.stubEnv('VITE_MESH_ICE_MODE', 'lan');
    const transport = new WebRTCTransport();
    await transport.init('rPeer');
    const socket = FakeWebSocket.instances[0];
    socket.emit({ type: 'offer', from: 'rAlice', to: 'rPeer', attemptId: 'attempt-789', sdp: { type: 'offer', sdp: 'incoming' } });
    await vi.waitFor(() => expect(FakePeerConnection.instances[0]?.localDescription).not.toBeNull());
    expect(socket.sent.some((entry) => entry.type === 'answer')).toBe(false);
    FakePeerConnection.instances[0].finishIceGathering();
    await vi.waitFor(() => expect(socket.sent.some((entry) => entry.type === 'answer')).toBe(true));
    expect((socket.sent.find((entry) => entry.type === 'answer')?.sdp as RTCSessionDescriptionInit).sdp).toContain('a=candidate:');
    await transport.disconnect();
  });

  it('signs the server challenge before registering a real Account ID', async () => {
    const identity = new WebCryptoIdentity();
    const seed = new Uint8Array(32);
    seed[31] = 1;
    const publicKey = (await identity.fromSeed(seed)).publicKey;
    const address = await getAccountId(bytesToHex(publicKey));
    const transport = new WebRTCTransport();
    await transport.init(address, { publicKey, sign: (data) => identity.sign(data) });
    const proof = FakeWebSocket.instances[0].sent[1];
    expect(proof).toMatchObject({ type: 'register_proof', address, publicKey: bytesToHex(publicKey) });
    const verifyKey = await crypto.subtle.importKey(
      'raw', publicKey.buffer.slice(publicKey.byteOffset, publicKey.byteOffset + publicKey.byteLength) as ArrayBuffer,
      { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'],
    );
    expect(await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' }, verifyKey,
      new Uint8Array((proof.signature as string).match(/.{2}/g)!.map((byte) => Number.parseInt(byte, 16))),
      registrationProofBytes(address, 'a'.repeat(64)),
    )).toBe(true);
    await transport.disconnect();
  });

  it('uses introductions only when advertised, without creating a WebRTC peer or treating signaling as delivery',async()=>{
    FakeWebSocket.introductionProtocol=INTRODUCTION_PROTOCOL;
    const identity=new WebCryptoIdentity(),other=new WebCryptoIdentity();
    const publicKey=(await identity.create()).publicKey,peerKey=(await other.create()).publicKey;
    const address=await getAccountId(bytesToHex(publicKey)),peer=await getAccountId(bytesToHex(peerKey));
    const transport=new WebRTCTransport(),received=vi.fn(),joined=vi.fn();transport.onIntroduction(received);transport.onPeerChange(joined);
    try{
      await transport.init(address,{publicKey,sign:bytes=>identity.sign(bytes)});
      expect(transport.supportsIntroduction()).toBe(true);transport.sendIntroduction(peer);
      const socket=FakeWebSocket.instances[0];expect(socket.sent.at(-1)).toMatchObject({type:'introduction',protocol:INTRODUCTION_PROTOCOL,to:peer,kind:'open'});
      socket.emit({type:'introduction',protocol:INTRODUCTION_PROTOCOL,from:peer,to:address,kind:'frame',frame:'AAAA'});
      await vi.waitFor(()=>expect(received).toHaveBeenCalled());expect(joined).not.toHaveBeenCalled();expect(FakePeerConnection.instances).toHaveLength(0);
      await transport.disconnect();expect(transport.supportsIntroduction()).toBe(false);expect(()=>transport.sendIntroduction(peer)).toThrow('introduction_unavailable');
    }finally{await transport.disconnect();identity.dispose();other.dispose();}
  });

  it('refuses an old signaling server that registers an Account ID without proof', async () => {
    FakeWebSocket.legacyRegistration = true;
    const identity = new WebCryptoIdentity();
    const seed = new Uint8Array(32);
    seed[31] = 2;
    const publicKey = (await identity.fromSeed(seed)).publicKey;
    const address = await getAccountId(bytesToHex(publicKey));
    const transport = new WebRTCTransport();
    await expect(transport.init(address, { publicKey, sign: (data) => identity.sign(data) }))
      .rejects.toThrow('signaling_protocol_outdated');
    await transport.disconnect();
  });

  it('routes courier envelopes separately from DataChannels and binds receipt to the receiving socket', async () => {
    const identities = await Promise.all([1, 2].map(async value => {
      const identity = new WebCryptoIdentity(); const seed = new Uint8Array(32); seed[31] = value;
      const publicKey = (await identity.fromSeed(seed)).publicKey;
      return { identity, publicKey, address: await getAccountId(bytesToHex(publicKey)) };
    }));
    const [recipient, courier] = identities; const transport = new WebRTCTransport();
    const received = vi.fn(); const messages = vi.fn(); const peers = vi.fn();
    let reply: ((id: string, receipt: string) => void) | undefined;
    transport.onCourier((data, cb) => { received(data); reply = cb; }); transport.onMessage(messages); transport.onPeerChange(peers);
    await transport.init(recipient.address, { publicKey: recipient.publicKey, sign: bytes => recipient.identity.sign(bytes) });
    const ws = FakeWebSocket.instances[0];
    const packet = { type: 'courier_delivery', from: courier.address, to: recipient.address,
      job: { body: { courier: courier.address, to: recipient.address } }, hop: {} };
    ws.emit({ ...packet, to: courier.address }); ws.emit({ ...packet, from: recipient.address }); expect(received).not.toHaveBeenCalled();
    ws.emit(packet); await vi.waitFor(() => expect(received).toHaveBeenCalledTimes(1));
    expect(messages).not.toHaveBeenCalled(); expect(peers).not.toHaveBeenCalled(); expect(await transport.discover()).toEqual([]);
    reply!('a'.repeat(32), '{}'); expect(ws.sent.at(-1)).toMatchObject({ type: 'courier_receipt', to: courier.address, id: 'a'.repeat(32) });
    const count = ws.sent.length; await transport.disconnect(); reply!('a'.repeat(32), '{}'); expect(ws.sent).toHaveLength(count);
  });
  it('negotiates attachment pulls and binds each reply to the node, part, nonce and live socket', async () => {
    const identity = new WebCryptoIdentity(); const { publicKey } = await identity.create(); const address = await getAccountId(bytesToHex(publicKey));
    const nodeIdentity = new WebCryptoIdentity(); const nodeAddress = await getAccountId(bytesToHex((await nodeIdentity.create()).publicKey));
    const transport = new WebRTCTransport(); let reply: CourierReply | undefined;
    transport.onCourier((_data, cb) => { reply = cb; }); await transport.init(address, { publicKey, sign: bytes => identity.sign(bytes) });
    const ws = FakeWebSocket.instances[0]; ws.emit({ type: 'courier_delivery', from: nodeAddress, to: address, job: { body: { courier: nodeAddress, to: address } }, hop: {} });
    await vi.waitFor(() => expect(reply?.chunk).toBeTypeOf('function'));
    const request = { body: { protocol: ATTACHMENT_PROTOCOL, from: address, to: nodeAddress, id: 'a'.repeat(32), index: 0, requestId: 'b'.repeat(32), expiresAt: Date.now() + 30000 }, publicKey: '', signature: '' };
    const promise = reply!.chunk!(request, new AbortController().signal); const bytes = new Uint8Array(16).fill(12);
    expect(ws.sent.at(-1)).toMatchObject({ type: 'courier_file_request', to: nodeAddress });
    const chunk = { type: 'courier_file_chunk', from: nodeAddress, to: address, id: request.body.id, index: 0, requestId: request.body.requestId, cipher: base64(bytes) };
    ws.emit({ ...chunk, from: address }); ws.emit({ ...chunk, index: 1 }); ws.emit(chunk);
    expect(await promise).toEqual(bytes);
    const abort = new AbortController(), canceled = reply!.chunk!({ ...request, body: { ...request.body, requestId: 'c'.repeat(32) } }, abort.signal); abort.abort();
    await expect(canceled).rejects.toThrow('attachment_transport_closed');
    const closed = reply!.chunk!({ ...request, body: { ...request.body, requestId: 'd'.repeat(32) } }, new AbortController().signal);
    const rejection = expect(closed).rejects.toThrow('attachment_transport_closed'); await transport.disconnect(); await rejection;
    await expect(reply!.chunk!(request, new AbortController().signal)).rejects.toThrow('attachment_transport_closed');
  });

  it('renews a signed registration on foreground without closing live chat channels; lock cannot restart it', async () => {
    const identity = new WebCryptoIdentity(); const { publicKey } = await identity.create();
    const address = await getAccountId(bytesToHex(publicKey));
    const transport = new WebRTCTransport();
    await transport.init(address, { publicKey, sign: bytes => identity.sign(bytes) });
    // Select a higher peer address, so this side opens a DataChannel.
    await transport.connect({ address: 'zzPeer', transport: 'webrtc', lastSeen: Date.now() });
    const channel = FakePeerConnection.instances[0].channel; channel.open();
    const old = FakeWebSocket.instances[0]; await transport.resume();
    expect(old.readyState).toBe(FakeWebSocket.CLOSED);
    expect(channel.readyState).toBe('open');
    expect(FakePeerConnection.instances).toHaveLength(1);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(FakeWebSocket.instances[1].sent.some(m => m.type === 'register_proof')).toBe(true);
    expect(transport.getStatus()).toBe('connected');
    await transport.disconnect(); await transport.resume();
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('recovers a stale registration after a fresh unlock without a page reload', async () => {
    vi.useFakeTimers();
    for (let cycle = 0; cycle < 5; cycle++) {
      const transport = new WebRTCTransport(); await transport.init('rAlice');
      FakeWebSocket.instances.at(-1)!.close(1008, 'address in use');
      expect(transport.getStatus()).toBe('reconnecting');
      await vi.advanceTimersByTimeAsync(2001);
      expect(transport.getStatus()).toBe('connected');
      await transport.disconnect();
    }
  });

  it('only treats a stale address registration as transient during the bounded foreground recovery window', async () => {
    vi.useFakeTimers(); const transport = new WebRTCTransport(); await transport.init('rAlice');
    await transport.resume();
    FakeWebSocket.instances.at(-1)!.close(1008, 'address in use');
    expect(transport.getStatus()).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(2001);
    expect(transport.getStatus()).toBe('connected');
    FakeWebSocket.instances.at(-1)!.close(1008, 'unauthorized');
    expect(transport.getStatus()).toBe('error');
    const count = FakeWebSocket.instances.length; await vi.advanceTimersByTimeAsync(70000);
    expect(FakeWebSocket.instances).toHaveLength(count);
    await transport.disconnect();
  });

  it('uses one connection and sends queued messages when the channel opens', async () => {
    const transport = new WebRTCTransport();
    await transport.init('rAlice');
    const peer = { address: 'rPeer', transport: 'webrtc' as const, lastSeen: Date.now() };

    await Promise.all([transport.connect(peer), transport.connect(peer)]);
    expect(FakePeerConnection.instances).toHaveLength(1);
    expect(FakePeerConnection.instances[0].offers).toBe(1);

    let sent = false;
    const pending = transport.send(message).then(() => { sent = true; });
    await Promise.resolve();
    expect(sent).toBe(false);

    const channel = FakePeerConnection.instances[0].channel;
    channel.open();
    await pending;
    expect(channel.sent).toHaveLength(1);

    await transport.disconnect();
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('lets the higher address request a connection without creating a competing offer', async () => {
    const transport = new WebRTCTransport();
    await transport.init('rPeer');
    await transport.connect({ address: 'rAlice', transport: 'webrtc', lastSeen: Date.now() });
    const socket = FakeWebSocket.instances[0];
    expect(socket.sent).toContainEqual({ type: 'connect_request', to: 'rAlice', from: 'rPeer' });
    expect(FakePeerConnection.instances).toHaveLength(0);

    socket.emit({
      type: 'offer', from: 'rAlice', to: 'rPeer', attemptId: 'attempt-789',
      sdp: { type: 'offer', sdp: 'incoming' },
    });
    await vi.waitFor(() => expect(socket.sent.some((entry) => entry.type === 'answer')).toBe(true));
    expect(FakePeerConnection.instances).toHaveLength(1);
    await transport.disconnect();
  });

  it('keeps separate channels for separate personal conversations', async () => {
    const transport = new WebRTCTransport();
    await transport.init('rAlice');
    await transport.connect({ address: 'rBob', transport: 'webrtc', lastSeen: Date.now() });
    await transport.connect({ address: 'rCharlie', transport: 'webrtc', lastSeen: Date.now() });
    expect(FakePeerConnection.instances).toHaveLength(2);

    const [bob, charlie] = FakePeerConnection.instances;
    bob.channel.open();
    charlie.channel.open();
    await transport.send({ ...message, to: 'rBob', messageId: 'for-bob' });
    await transport.send({ ...message, to: 'rCharlie', messageId: 'for-charlie' });
    expect(bob.channel.sent).toHaveLength(1);
    expect(charlie.channel.sent).toHaveLength(1);
    expect(new Uint8Array(bob.channel.sent[0])).not.toEqual(new Uint8Array(charlie.channel.sent[0]));
    await transport.disconnect();
  });

  it('reserves the replacement route again after old channel cleanup releases it', async () => {
    let reserved = false;
    const admitPeer = vi.fn(() => { reserved = true; return true; });
    const transport = new WebRTCTransport('ws://localhost:3000/signal', { admitPeer });
    const joined: string[] = [];
    transport.onPeerChange((peer,event) => {
      if (event === 'left') reserved = false; // Same release contract as the routed transport.
      else if (reserved) joined.push(peer.address);
    });
    await transport.init('rPeer');
    const socket = FakeWebSocket.instances[0];
    const offer = (attemptId: string) => socket.emit({ type:'offer',from:'rAlice',to:'rPeer',attemptId,sdp:{type:'offer',sdp:'incoming'} });
    try {
      offer('before-reload');
      await vi.waitFor(() => expect(socket.sent.some(entry => entry.type === 'answer' && entry.attemptId === 'before-reload')).toBe(true));
      const old = FakePeerConnection.instances[0];
      old.ondatachannel?.({channel:old.channel as unknown as RTCDataChannel}); old.channel.open();
      expect(joined).toHaveLength(1);
      offer('after-reload');
      await vi.waitFor(() => expect(socket.sent.some(entry => entry.type === 'answer' && entry.attemptId === 'after-reload')).toBe(true));
      expect(old.connectionState).toBe('closed');
      expect(reserved).toBe(true);
      const replacement = FakePeerConnection.instances[1];
      replacement.ondatachannel?.({channel:replacement.channel as unknown as RTCDataChannel}); replacement.channel.open();
      expect(joined).toHaveLength(2);
    } finally { await transport.disconnect(); }
  });

  it('does not install a replacement if route admission is revoked during cleanup', async () => {
    let allowed = true;
    const transport = new WebRTCTransport('ws://localhost:3000/signal', { admitPeer:() => allowed });
    transport.onPeerChange((_peer,event) => { if (event === 'left') allowed = false; });
    await transport.init('rPeer');
    const socket = FakeWebSocket.instances[0];
    try {
      socket.emit({type:'offer',from:'rAlice',to:'rPeer',attemptId:'old',sdp:{type:'offer',sdp:'incoming'}});
      await vi.waitFor(() => expect(socket.sent.some(entry => entry.type === 'answer')).toBe(true));
      const old = FakePeerConnection.instances[0];
      old.ondatachannel?.({channel:old.channel as unknown as RTCDataChannel}); old.channel.open();
      socket.emit({type:'offer',from:'rAlice',to:'rPeer',attemptId:'revoked',sdp:{type:'offer',sdp:'incoming'}});
      await vi.waitFor(() => expect(old.connectionState).toBe('closed'));
      expect(allowed).toBe(false); expect(FakePeerConnection.instances).toHaveLength(1);
      expect(socket.sent.some(entry => entry.type === 'answer' && entry.attemptId === 'revoked')).toBe(false);
    } finally { await transport.disconnect(); }
  });

  it('waits for DataChannel buffer room instead of flooding large transfers', async () => {
    const transport = new WebRTCTransport();
    await transport.init('rAlice');
    await transport.connect({ address: 'rPeer', transport: 'webrtc', lastSeen: Date.now() });
    const channel = FakePeerConnection.instances[0].channel;
    channel.open();
    channel.bufferedAmount = 600 * 1024;
    let finished = false;
    const pending = transport.send(message).then(() => { finished = true; });
    await Promise.resolve();
    expect(finished).toBe(false);
    expect(channel.sent).toHaveLength(0);
    channel.drain();
    await pending;
    expect(channel.sent).toHaveLength(1);
    await transport.disconnect();
  });

  it('rejects a buffered send when the channel closes before draining', async () => {
    const transport = new WebRTCTransport();
    await transport.init('rAlice');
    await transport.connect({ address: 'rPeer', transport: 'webrtc', lastSeen: Date.now() });
    const channel = FakePeerConnection.instances[0].channel;
    channel.open();
    channel.bufferedAmount = 600 * 1024;
    const pending = transport.send(message);
    const rejection = expect(pending).rejects.toThrow('channel_closed');
    channel.close();
    await rejection;
    await transport.disconnect();
  });

  it('starts an offer when a higher address requests a connection', async () => {
    const transport = new WebRTCTransport();
    await transport.init('rAlice');
    const socket = FakeWebSocket.instances[0];
    socket.emit({ type: 'connect_request', from: 'rPeer', to: 'rAlice' });

    await vi.waitFor(() => expect(socket.sent.some((entry) => entry.type === 'offer' && entry.to === 'rPeer')).toBe(true));
    expect(FakePeerConnection.instances).toHaveLength(1);
    await transport.disconnect();
  });

  it('rejects a queued send after the channel timeout', async () => {
    vi.useFakeTimers();
    const transport = new WebRTCTransport();
    const init = transport.init('rAlice');
    await vi.runAllTicks();
    await init;
    const pending = transport.send(message);
    const assertion = expect(pending).rejects.toThrow('channel_open_timeout:rPeer');

    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
    await transport.disconnect();
  });

  it('ignores an answer from an old connection attempt', async () => {
    const transport = new WebRTCTransport();
    await transport.init('rAlice');
    await transport.connect({ address: 'rPeer', transport: 'webrtc', lastSeen: Date.now() });
    const socket = FakeWebSocket.instances[0];
    const offer = socket.sent.find((entry) => entry.type === 'offer');
    const pc = FakePeerConnection.instances[0];

    socket.emit({
      type: 'answer',
      from: 'rPeer',
      to: 'rAlice',
      attemptId: 'old-attempt',
      sdp: { type: 'answer', sdp: 'stale' },
    });
    await Promise.resolve();
    expect(pc.remoteDescription).toBeNull();

    socket.emit({
      type: 'answer',
      from: 'rPeer',
      to: 'rAlice',
      attemptId: offer?.attemptId,
      sdp: { type: 'answer', sdp: 'current' },
    });
    await vi.waitFor(() => expect(pc.remoteDescription?.sdp).toBe('current'));
    await transport.disconnect();
  });

  it('stops reconnecting after manual disconnect', async () => {
    vi.useFakeTimers();
    const transport = new WebRTCTransport();
    const init = transport.init('rAlice');
    await vi.runAllTicks();
    await init;
    await transport.connect({ address: 'rPeer', transport: 'webrtc', lastSeen: Date.now() });
    const channel = FakePeerConnection.instances[0].channel;
    channel.open();
    channel.close();
    await transport.disconnect();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(FakePeerConnection.instances).toHaveLength(1);
  });

  it('continues retrying after a long signaling outage', async () => {
    const transport = new WebRTCTransport();
    await transport.init('rAlice');
    vi.useFakeTimers();
    FakeWebSocket.failedRegistrations = 12;
    FakeWebSocket.instances[0].close();
    try {
      await vi.advanceTimersByTimeAsync(500_000);
      expect(FakeWebSocket.instances.length).toBeGreaterThan(12);
      expect(transport.getStatus()).toBe('connected');
    } finally {
      await transport.disconnect();
    }
  });

  it('re-watches a peer after signaling restarts without closing its live channel', async () => {
    const transport = new WebRTCTransport();
    await transport.init('rAlice');
    await transport.connect({ address: 'rPeer', transport: 'webrtc', lastSeen: Date.now() });
    const channel = FakePeerConnection.instances[0].channel;
    channel.open();
    vi.useFakeTimers();
    FakeWebSocket.instances[0].close();
    try {
      await vi.advanceTimersByTimeAsync(2_100);
      expect(FakeWebSocket.instances).toHaveLength(2);
      expect(FakeWebSocket.instances[1].sent).toContainEqual({ type: 'watch_peer', to: 'rPeer' });
      expect(channel.readyState).toBe('open');
    } finally {
      await transport.disconnect();
    }
  });

  const internet = { url: 'wss://chat.example/signal', kind: 'internet' as const };
  const lan = { url: 'wss://192.168.0.169:3002/signal', kind: 'lan' as const };

  it('tries Internet first and falls back to LAN without parallel registration', async () => {
    FakeWebSocket.unavailableUrls.add(internet.url);
    const transport = new WebRTCTransport([lan, internet]);
    await transport.init('rAlice');
    expect(FakeWebSocket.instances.map((ws) => ws.url)).toEqual([internet.url, lan.url]);
    expect(FakeWebSocket.instances[0].sent).toEqual([]);
    expect(transport.getConnectionInfo()).toEqual(lan);
    expect(transport.getStatus()).toBe('connected');
    await transport.connect({ address: 'rPeer', transport: 'webrtc', lastSeen: 0 });
    expect(FakePeerConnection.instances[0].config.iceServers).toEqual([]);
    await transport.disconnect();
  });

  it('does not contact LAN while Internet registration succeeds', async () => {
    const transport = new WebRTCTransport([internet, lan]);
    await transport.init('rAlice');
    expect(FakeWebSocket.instances.map((ws) => ws.url)).toEqual([internet.url]);
    await transport.disconnect();
  });

  it('bounds a silent node timeout then registers on the fallback', async () => {
    vi.useFakeTimers();
    FakeWebSocket.hangingUrls.add(internet.url);
    const transport = new WebRTCTransport([internet, lan]);
    const init = transport.init('rAlice');
    await vi.advanceTimersByTimeAsync(5_001);
    await init;
    expect(transport.getConnectionInfo()).toEqual(lan);
    expect(FakeWebSocket.instances[0].readyState).toBe(3);
    await transport.disconnect();
  });

  it('preserves a live encrypted channel when signaling fails over to another registry', async () => {
    const transport = new WebRTCTransport([internet, lan]);
    await transport.init('rAlice');
    await transport.connect({ address: 'rPeer', transport: 'webrtc', lastSeen: 0 });
    const channel = FakePeerConnection.instances[0].channel;
    channel.open();
    FakeWebSocket.instances[0].close();
    await vi.waitFor(() => expect(transport.getConnectionInfo()).toEqual(lan));
    await vi.waitFor(() => expect(transport.getStatus()).toBe('connected'));
    FakeWebSocket.instances[1].emit({ type: 'peer_offline', address: 'rPeer' });
    FakeWebSocket.instances[1].emit({ type: 'peer_unavailable', address: 'rPeer', attemptId: '' });
    await transport.send(message);
    expect(channel.readyState).toBe('open');
    expect(channel.sent).toHaveLength(1);
    expect(FakePeerConnection.instances).toHaveLength(1);
    await transport.disconnect();
  });

  it('throws away stale unfinished negotiations on a node switch', async () => {
    const transport = new WebRTCTransport([internet, lan]);
    await transport.init('rAlice');
    await transport.connect({ address: 'rPeer', transport: 'webrtc', lastSeen: 0 });
    const old = FakePeerConnection.instances[0];
    FakeWebSocket.instances[0].close();
    await vi.waitFor(() => expect(FakePeerConnection.instances).toHaveLength(2));
    expect(old.connectionState).toBe('closed');
    expect(FakeWebSocket.instances[1].sent.some((packet) => packet.type === 'offer')).toBe(true);
    await transport.disconnect();
  });

  it('returns to Internet using an anonymous probe when no live conversation would be disrupted', async () => {
    vi.useFakeTimers();
    FakeWebSocket.unavailableUrls.add(internet.url);
    const transport = new WebRTCTransport([internet, lan]);
    const init = transport.init('rAlice');
    await vi.runAllTicks();
    await init;
    FakeWebSocket.unavailableUrls.clear();
    await vi.advanceTimersByTimeAsync(60_001);
    expect(transport.getConnectionInfo()).toEqual(internet);
    expect(transport.getStatus()).toBe('connected');
    expect(FakeWebSocket.instances[2].url).toBe(internet.url);
    expect(FakeWebSocket.instances[2].sent).toEqual([{ type: 'probe' }]);
    expect(FakeWebSocket.instances[1].readyState).toBe(3);
    await transport.disconnect();
  });

  it('defers preferred-node probing while a direct conversation is alive', async () => {
    vi.useFakeTimers();
    FakeWebSocket.unavailableUrls.add(internet.url);
    const transport = new WebRTCTransport([internet, lan]);
    const init = transport.init('rAlice');
    await vi.runAllTicks();
    await init;
    await transport.connect({ address: 'rPeer', transport: 'webrtc', lastSeen: 0 });
    FakePeerConnection.instances[0].channel.open();
    FakeWebSocket.unavailableUrls.clear();
    await vi.advanceTimersByTimeAsync(120_001);
    expect(transport.getConnectionInfo()).toEqual(lan);
    expect(FakeWebSocket.instances).toHaveLength(2);
    await transport.disconnect();
  });

  it('cancels a pending registration on lock/logout and never starts a fallback afterwards', async () => {
    vi.useFakeTimers();
    FakeWebSocket.hangingUrls.add(internet.url);
    const transport = new WebRTCTransport([internet, lan]);
    const init = transport.init('rAlice');
    const assertion = expect(init).rejects.toThrow('transport_disconnected');
    await transport.disconnect();
    await assertion;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(transport.getStatus()).toBe('idle');
  });

  it('does not move off LAN for a server that only accepts sockets but speaks another protocol', async () => {
    vi.useFakeTimers();
    FakeWebSocket.unavailableUrls.add(internet.url);
    const transport = new WebRTCTransport([internet, lan]);
    const init = transport.init('rAlice');
    await vi.runAllTicks();
    await init;
    FakeWebSocket.unavailableUrls.clear();
    FakeWebSocket.wrongProbeProtocol = true;
    await vi.advanceTimersByTimeAsync(60_001);
    expect(transport.getConnectionInfo()).toEqual(lan);
    expect(FakeWebSocket.instances[1].readyState).toBe(FakeWebSocket.OPEN);
    expect(FakeWebSocket.instances[2].sent).toEqual([{ type: 'probe' }]);
    await transport.disconnect();
  });

  it('halts on a policy/authentication rejection instead of leaking identity to each fallback', async () => {
    vi.useFakeTimers();
    FakeWebSocket.hangingUrls.add(internet.url);
    const transport = new WebRTCTransport([internet, lan]);
    const init = transport.init('rAlice');
    const assertion = expect(init).rejects.toThrow('signaling_registration_rejected');
    FakeWebSocket.instances[0].close(1008);
    await assertion;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(transport.getStatus()).toBe('error');
    expect(FakeWebSocket.instances).toHaveLength(1);
    await transport.disconnect();
  });
  it('distinguishes a competing session from an invalid authentication proof', async () => {
    FakeWebSocket.hangingUrls.add(internet.url);
    const transport = new WebRTCTransport([internet]);
    const init = transport.init('rAlice'), assertion = expect(init).rejects.toThrow('signaling_address_busy');
    FakeWebSocket.instances[0].close(1008,'address in use'); await assertion; await transport.disconnect();
  });

  it('recovers after all configured nodes are down and restarts with Internet priority', async () => {
    vi.useFakeTimers();
    FakeWebSocket.unavailableUrls.add(internet.url);
    FakeWebSocket.unavailableUrls.add(lan.url);
    const transport = new WebRTCTransport([internet, lan]);
    const init = transport.init('rAlice');
    const assertion = expect(init).rejects.toThrow('signaling_closed');
    await vi.runAllTicks();
    await assertion;
    FakeWebSocket.unavailableUrls.clear();
    await vi.advanceTimersByTimeAsync(2_001);
    expect(transport.getConnectionInfo()).toEqual(internet);
    expect(transport.getStatus()).toBe('connected');
    await transport.disconnect();
  });
});
