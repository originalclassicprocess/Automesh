import { describe, expect, it, vi } from 'vitest';

import { getAccountId } from '$lib/addressing/address';
import { WebCryptoIdentity } from '$lib/identity/webcrypto';
import { bytesToHex } from '$lib/message/encoding';
import { buildSignInput, importPublicKey, parsePayload, verify } from '$lib/message/envelope';
import {CourierController} from '$lib/node/courier-controller';
import {emptyCourierState,restoreCourierState} from '$lib/node/courier-state';
import {emptySessionChats,ensureConversation,setContactState} from './session-chats';
import {createCourierJob,openCourier,signCourier} from '$lib/node/courier-crypto';
import {cipherDigest} from '$lib/node/offline-crypto';
import { ChatService, type ChatMessage } from './ChatService';
import { avatarFixture } from './avatar.fixture';
import {
  TRANSPORT_CAPABILITIES,
  type Peer,
  type Transport,
  type TransportMessage,
  type TransportStatus,
} from '$lib/transport/transport';

class TestTransport implements Transport {
  readonly capabilities = TRANSPORT_CAPABILITIES.webrtc;

  sentMessage: TransportMessage | null = null;
  sentMessages: TransportMessage[] = [];
  connectedTo: string | null = null;
  peer: TestTransport | null = null;
  address = '';
  autoDeliver = true;

  private messageHandlers: Array<(message: TransportMessage) => void> = [];
  private statusHandlers: Array<(status: TransportStatus) => void> = [];
  private peerHandlers: Array<(peer: Peer, event: 'joined' | 'left') => void> = [];

  getStatus(): TransportStatus { return 'connected'; }
  async init(address: string): Promise<void> { this.address = address; }
  async connect(peer: Peer): Promise<void> {
    this.connectedTo = peer.address;
    if (this.peer) {
      for (const handler of this.peerHandlers) handler(peer, 'joined');
      for (const handler of this.peer.peerHandlers) {
        handler({ address: this.address, transport: 'webrtc', lastSeen: Date.now() }, 'joined');
      }
    }
  }
  async disconnect(): Promise<void> {}
  async isAvailable(): Promise<boolean> { return true; }
  async discover(): Promise<Peer[]> { return []; }

  async send(message: TransportMessage): Promise<void> {
    this.sentMessage = message;
    this.sentMessages.push(message);
    if (this.autoDeliver && this.peer) queueMicrotask(() => this.peer?.emit(message));
  }

  onMessage(cb: (message: TransportMessage) => void): void {
    this.messageHandlers.push(cb);
  }

  onStatusChange(cb: (status: TransportStatus) => void): void {
    this.statusHandlers.push(cb);
  }

  onPeerChange(cb: (peer: Peer, event: 'joined' | 'left') => void): void {
    this.peerHandlers.push(cb);
  }

  emit(message: TransportMessage): void {
    for (const handler of this.messageHandlers) handler(message);
  }

  leave(): void {
    for (const handler of this.peerHandlers) {
      handler({ address: this.peer?.address ?? '', transport: 'webrtc', lastSeen: Date.now() }, 'left');
    }
    for (const handler of this.peer?.peerHandlers ?? []) {
      handler({ address: this.address, transport: 'webrtc', lastSeen: Date.now() }, 'left');
    }
  }
}

async function connectedPair() {
  const senderIdentity = await createIdentity(1);
  const receiverIdentity = await createIdentity(2);
  const senderTransport = new TestTransport();
  const receiverTransport = new TestTransport();
  senderTransport.peer = receiverTransport;
  receiverTransport.peer = senderTransport;
  const sender = new ChatService(senderTransport);
  const receiver = new ChatService(receiverTransport);
  await sender.init(senderIdentity);
  await receiver.init(receiverIdentity);
  const ready: string[] = [];
  sender.onPeerChange((_, event) => { if (event === 'joined') ready.push('sender'); });
  receiver.onPeerChange((_, event) => { if (event === 'joined') ready.push('receiver'); });
  await sender.connect(receiverIdentity.address);
  await vi.waitFor(() => expect(ready).toHaveLength(2));
  return { senderIdentity, receiverIdentity, senderTransport, receiverTransport, sender, receiver };
}

async function createIdentity(lastByte: number) {
  const seed = new Uint8Array(32);
  seed[31] = lastByte;

  const provider = new WebCryptoIdentity();
  const identity = await provider.fromSeed(seed);
  const address = await getAccountId(bytesToHex(identity.publicKey));

  return { provider, address };
}

async function signedFrame(identity: Awaited<ReturnType<typeof createIdentity>>, to: string, content: Uint8Array): Promise<TransportMessage> {
  const timestamp = Date.now();
  const messageId = crypto.randomUUID();
  const metadata = new TextEncoder().encode(JSON.stringify([
    'MeshAutonomy signed envelope v2', identity.address, to, timestamp, messageId,
  ]));
  const signInput = new Uint8Array(4 + metadata.length + content.length);
  new DataView(signInput.buffer).setUint32(0, metadata.length);
  signInput.set(metadata, 4);
  signInput.set(content, 4 + metadata.length);
  const publicKey = await identity.provider.getPublicKeyBytes();
  const payload = new Uint8Array(2 + publicKey.length + content.length);
  new DataView(payload.buffer).setUint16(0, publicKey.length, true);
  payload.set(publicKey, 2);
  payload.set(content, 2 + publicKey.length);
  return {
    to, from: identity.address, payload,
    signature: await identity.provider.sign(signInput), timestamp, messageId, ttl: 7,
  };
}

describe('identity and signed chat messages', () => {
  it('dispatches history only through authenticated control, never as a chat message or delivery receipt', async () => {
    const pair = await connectedPair(), control = vi.fn(), messages = vi.fn(), receipts = vi.fn();
    pair.receiver.onDeviceControl(control); pair.receiver.onMessage(messages); pair.receiver.onReceipt(receipts);
    try { await pair.sender.sendDeviceControl('history', { marker: 'historical control fixture' }, pair.receiverIdentity.address);
      await vi.waitFor(() => expect(control).toHaveBeenCalledOnce());
      expect(control.mock.calls[0]).toEqual([pair.senderIdentity.address, 'history', { marker: 'historical control fixture' }]);
      expect(messages).not.toHaveBeenCalled(); expect(receipts).not.toHaveBeenCalled();
    } finally { await pair.sender.disconnect(); await pair.receiver.disconnect(); }
  });
  it('rejects network sends to saved messages without blocking a real contact', async () => {
    const pair = await connectedPair();
    try {
      await expect(pair.sender.sendCourierBundle({}, pair.senderIdentity.address)).rejects.toThrow('invalid_peer_address');
      const received = vi.fn(); pair.receiver.onMessage(received);
      await pair.sender.send('Still reachable', pair.receiverIdentity.address);
      await vi.waitFor(() => expect(received).toHaveBeenCalledOnce());
    } finally { await pair.sender.disconnect(); await pair.receiver.disconnect(); }
  });
  it('never sends an old-connection frame after its asynchronous signature finishes on a new connection', async () => {
    const pair = await connectedPair();
    let release!: () => void;
    const gate = new Promise<void>(resolve => release = resolve);
    const sign = pair.senderIdentity.provider.sign.bind(pair.senderIdentity.provider);
    const held = vi.spyOn(pair.senderIdentity.provider,'sign').mockImplementationOnce(async input => { await gate; return sign(input); });
    pair.senderTransport.autoDeliver = false;
    const before = pair.senderTransport.sentMessages.length;
    const sending = pair.sender.send('do not cross the channel boundary',pair.receiverIdentity.address).then(() => 'sent',() => 'rejected');
    try {
      await vi.waitFor(() => expect(held).toHaveBeenCalledOnce());
      pair.senderTransport.leave(); release();
      expect(await sending).toBe('rejected');
      expect(pair.senderTransport.sentMessages).toHaveLength(before);
    } finally { release(); held.mockRestore(); await pair.sender.disconnect(); await pair.receiver.disconnect(); }
  });

  it('does not process an old hello whose verification finishes after the connection was dropped', async () => {
    const pair = await connectedPair();
    const hello = [...pair.senderTransport.sentMessages,...pair.receiverTransport.sentMessages].find(message => parsePayload(message.payload).textBytes[4] === 1)!;
    const recipient = hello.to === pair.senderIdentity.address ? pair.senderTransport : pair.receiverTransport;
    const service = hello.to === pair.senderIdentity.address ? pair.sender : pair.receiver;
    let release!: () => void;
    const gate = new Promise<void>(resolve => release = resolve);
    const verify = crypto.subtle.verify.bind(crypto.subtle);
    const held = vi.spyOn(crypto.subtle,'verify').mockImplementationOnce(async (...args) => { await gate; return verify(...args); });
    const before = recipient.sentMessages.length;
    try {
      recipient.emit(hello);
      await vi.waitFor(() => expect(held).toHaveBeenCalledOnce());
      const pending = (service as unknown as { receiveQueues:Map<string,Promise<void>> }).receiveQueues.get(hello.from)!;
      recipient.leave(); release(); await pending;
      expect(recipient.sentMessages).toHaveLength(before);
    } finally { release(); held.mockRestore(); await pair.sender.disconnect(); await pair.receiver.disconnect(); }
  });

  it('waits for authentication, not just transport connect, before device control traffic', async () => {
    const a = new TestTransport(), b = new TestTransport();
    a.peer = b; b.peer = a; a.autoDeliver = false; b.autoDeliver = false;
    const first = new ChatService(a), second = new ChatService(b);
    const ai = await createIdentity(11), bi = await createIdentity(12);
    await first.init(ai); await second.init(bi);
    let ready = false;
    const waiting = first.connectAndWait(bi.address, 2000).then(() => ready = true);
    try {
      await new Promise(resolve => setTimeout(resolve, 30));
      expect(a.connectedTo).toBe(bi.address); expect(ready).toBe(false);
      a.autoDeliver = true; b.autoDeliver = true;
      for (const message of [...a.sentMessages]) b.emit(message);
      for (const message of [...b.sentMessages]) a.emit(message);
      await waiting; expect(ready).toBe(true);
      await first.connectAndWait(bi.address, 1);
    } finally { await first.disconnect(); await second.disconnect(); }
  });

  it('times out instead of treating an unauthenticated peer as ready', async () => {
    const chat = new ChatService(new TestTransport());
    await chat.init(await createIdentity(11));
    try { await expect(chat.connectAndWait((await createIdentity(12)).address, 20)).rejects.toThrow('peer_unreachable'); }
    finally { await chat.disconnect(); }
  });

  it('cancels authentication waiters immediately when the account locks', async () => {
    const chat = new ChatService(new TestTransport()); await chat.init(await createIdentity(11));
    const pending = chat.connectAndWait((await createIdentity(12)).address);
    const denied = expect(pending).rejects.toThrow('chat_session_closed');
    await chat.disconnect(); await denied;
  });
  it('delivers call controls only through authenticated encryption, not as messages or receipts', async () => {
    const { sender, receiver, receiverIdentity, senderIdentity, senderTransport } = await connectedPair();
    const calls: unknown[] = [], messages: ChatMessage[] = [];
    receiver.onCall((peer, signal) => { calls.push({ peer, signal }); }); receiver.onMessage(message => { messages.push(message); });
    const signal = { kind: 'invite' as const, id: crypto.randomUUID(), expires: Date.now() + 45000 };
    const stopping = vi.fn(); sender.onDisconnect(stopping);
    try {
      await sender.sendCall(signal, receiverIdentity.address);
      await vi.waitFor(() => expect(calls).toEqual([{ peer: senderIdentity.address, signal }]));
      expect(messages).toHaveLength(0);
      expect(new TextDecoder().decode(senderTransport.sentMessage!.payload)).not.toContain(signal.id);
      const signed = senderTransport.sentMessage!;
      senderTransport.peer!.emit(signed);
      await new Promise(resolve => setTimeout(resolve, 30)); expect(calls).toHaveLength(1);
    } finally { await sender.disconnect(); await receiver.disconnect(); }
    expect(stopping).toHaveBeenCalledOnce();
  });
  it('delivers participant pin controls inside the encrypted authenticated session', async () => {
    const { sender, receiver, receiverIdentity, senderIdentity, senderTransport } = await connectedPair();
    const messages: ChatMessage[] = []; receiver.onMessage(message => { messages.push(message); });
    const details = { pin: { targetId: crypto.randomUUID(), revision: 1 } };
    try {
      await sender.send('', receiverIdentity.address, crypto.randomUUID(), details);
      await vi.waitFor(() => expect(messages).toHaveLength(1));
      expect(messages[0]).toMatchObject({ from: senderIdentity.address, text: '', details });
      expect(new TextDecoder().decode(senderTransport.sentMessage!.payload)).not.toContain(details.pin.targetId);
    } finally { await sender.disconnect(); await receiver.disconnect(); }
  });
  it('keeps queue ownership and authenticated metadata when the transport mutates its original buffer', async () => {
    const { sender, receiver, senderIdentity, receiverIdentity, senderTransport, receiverTransport } = await connectedPair();
    senderTransport.autoDeliver = false;
    const received: ChatMessage[] = []; receiver.onMessage(message => { received.push(message); });
    try {
      await sender.send('snapshot at the boundary', receiverIdentity.address);
      const original = senderTransport.sentMessage!, id = original.messageId, timestamp = original.timestamp;
      receiverTransport.emit(original);
      original.from = receiverIdentity.address; original.messageId = crypto.randomUUID(); original.timestamp++;
      original.payload.fill(0); original.signature.fill(0);
      await vi.waitFor(() => expect(received).toHaveLength(1));
      expect(received[0]).toMatchObject({ id, timestamp, from: senderIdentity.address, text: 'snapshot at the boundary' });
      await vi.waitFor(() => expect((receiver as unknown as { receiveQueues: Map<string, Promise<void>> }).receiveQueues.size).toBe(0));
    } finally { await sender.disconnect(); await receiver.disconnect(); }
  });
  it('transmits rich replies and contact cards inside the authenticated encrypted session', async () => {
    const { sender, receiver, receiverIdentity, senderIdentity, senderTransport } = await connectedPair();
    const messages: ChatMessage[] = []; receiver.onMessage(message => { messages.push(message); });
    const details = { reply: { id: crypto.randomUUID(), from: senderIdentity.address, preview: 'quoted' },
      contactCard: { accountId: senderIdentity.address, nickname: 'Alice' }, allowForwardAttribution: false };
    await sender.send('answer', receiverIdentity.address, crypto.randomUUID(), details);
    await vi.waitFor(() => expect(messages).toHaveLength(1));
    expect(messages[0].details).toEqual(details);
    expect(new TextDecoder().decode(senderTransport.sentMessage!.payload)).not.toContain('quoted');
    await sender.disconnect(); await receiver.disconnect();
  });
  it('serializes simultaneous copies of a valid signed ciphertext before accepting its counter', async () => {
    const { receiverIdentity, senderTransport, receiverTransport, sender, receiver } = await connectedPair();
    const received: ChatMessage[] = [];
    receiver.onMessage(message => received.push(message));
    senderTransport.autoDeliver = false;
    try {
      await sender.send('one delivery only', receiverIdentity.address);
      const message = senderTransport.sentMessage!;
      for (let i = 0; i < 32; i++) receiverTransport.emit(message);
      const queue = (receiver as unknown as { receiveQueues: Map<string, Promise<void>> }).receiveQueues.get(message.from)!;
      await queue;
      expect(received.map(item => item.text)).toEqual(['one delivery only']);
      expect(receiverTransport.sentMessages.filter(item => parsePayload(item.payload).textBytes[4] === 5)).toHaveLength(1);
    } finally { await sender.disconnect(); await receiver.disconnect(); }
  });
  it('does not bypass replay protection by changing ECDSA s to n-s', async () => {
    const { receiverIdentity, senderTransport, receiverTransport, sender, receiver } = await connectedPair();
    const received: ChatMessage[] = [];
    receiver.onMessage(message => received.push(message));
    senderTransport.autoDeliver = false;
    await sender.send('one message', receiverIdentity.address);
    const original = senderTransport.sentMessage!;
    expect(original.signature.length).toBe(64);
    const order = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
    const s = BigInt(`0x${bytesToHex(original.signature.slice(32))}`);
    const alternate = original.signature.slice();
    const hex = (order - s).toString(16).padStart(64, '0');
    for (let i = 0; i < 32; i++) alternate[32 + i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    const { pubKeyBytes, textBytes } = parsePayload(original.payload);
    expect(await verify(buildSignInput(textBytes, original.timestamp, original.messageId, original.from, original.to),
      alternate, await importPublicKey(pubKeyBytes))).toBe(true);
    receiverTransport.emit(original);
    await vi.waitFor(() => expect(received).toHaveLength(1));
    receiverTransport.emit({ ...original, signature: alternate });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(received).toHaveLength(1);
    await sender.disconnect(); await receiver.disconnect();
  });
  it('bounds incoming verification work even when an established peer floods frames', async () => {
    const { receiverIdentity, senderTransport, receiverTransport, sender, receiver } = await connectedPair();
    senderTransport.autoDeliver = false;
    await sender.send('bounded', receiverIdentity.address);
    const original = crypto.subtle.verify.bind(crypto.subtle);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const verify = vi.spyOn(crypto.subtle, 'verify').mockImplementation(async (...args) => { await gate; return original(...args); });
    try {
      for (let i = 0; i < 1000; i++) receiverTransport.emit(senderTransport.sentMessage!);
      expect((receiver as unknown as { incomingCount: number }).incomingCount).toBe(128);
      await vi.waitFor(() => expect(verify).toHaveBeenCalledTimes(1));
      await receiver.disconnect(); release();
      await new Promise(resolve => setTimeout(resolve, 20));
      expect((receiver as unknown as { incomingCount: number }).incomingCount).toBe(0);
      expect(verify).toHaveBeenCalledTimes(1);
    } finally { release(); verify.mockRestore(); await sender.disconnect(); await receiver.disconnect(); }
  });
  it('does not deliver an outgoing signature completed after disconnect and reinitialization', async () => {
    const { senderIdentity, receiverIdentity, senderTransport, sender, receiver } = await connectedPair();
    const count = senderTransport.sentMessages.length;
    const original = senderIdentity.provider.sign.bind(senderIdentity.provider);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let signing = false;
    const spy = vi.spyOn(senderIdentity.provider, 'sign').mockImplementation(async bytes => { signing = true; await gate; return original(bytes); });
    const pending = sender.send('must not escape after logout', receiverIdentity.address);
    const rejected = expect(pending).rejects.toThrow('chat_session_closed');
    try {
      await vi.waitFor(() => expect(signing).toBe(true));
      await sender.disconnect();
      await sender.init(await createIdentity(3));
      release(); await rejected;
      expect(senderTransport.sentMessages).toHaveLength(count);
    } finally { release(); spy.mockRestore(); await sender.disconnect(); await receiver.disconnect(); }
  });

  it('does not start an already queued send in a new account session', async () => {
    const { receiverIdentity, senderTransport, sender, receiver } = await connectedPair();
    const count = senderTransport.sentMessages.length;
    const pending = sender.send('old account content', receiverIdentity.address);
    const rejected = expect(pending).rejects.toThrow('chat_session_closed');
    await sender.disconnect();
    await sender.init(await createIdentity(3));
    await rejected;
    expect(senderTransport.sentMessages).toHaveLength(count);
    await sender.disconnect(); await receiver.disconnect();
  });

  it('does not expose peer identity after verification completes following disconnect', async () => {
    const { receiverIdentity, senderTransport, receiverTransport, sender, receiver } = await connectedPair();
    senderTransport.autoDeliver = false;
    await sender.send('old session', receiverIdentity.address);
    const observed: string[] = [];
    receiver.onPeerIdentity(peer => observed.push(peer));
    const original = crypto.subtle.verify.bind(crypto.subtle);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let verifying = false;
    const spy = vi.spyOn(crypto.subtle, 'verify').mockImplementation(async (...args) => { verifying = true; await gate; return original(...args); });
    try {
      receiverTransport.emit(senderTransport.sentMessage!);
      await vi.waitFor(() => expect(verifying).toBe(true));
      await receiver.disconnect(); release();
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(observed).toEqual([]);
    } finally { release(); spy.mockRestore(); await sender.disconnect(); await receiver.disconnect(); }
  });
  it('allows either address to request a personal connection', async () => {
    const identity = await createIdentity(1);
    const transport = new TestTransport();
    const chat = new ChatService(transport);
    await chat.init(identity);

    const otherAddress = (await createIdentity(2)).address;
    await chat.connect(otherAddress);
    expect(transport.connectedTo).toBe(otherAddress);
  });

  it('restores the same address from the same seed', async () => {
    const first = await createIdentity(1);
    const second = await createIdentity(1);

    expect(second.address).toBe(first.address);
  });

  it('rejects a valid signature when the claimed sender address is spoofed', async () => {
    const { senderIdentity, receiverIdentity, senderTransport, receiverTransport, sender, receiver } = await connectedPair();
    const received: ChatMessage[] = [];
    const knownKeys: string[] = [];

    receiver.onMessage((message) => received.push(message));
    receiver.onPeerIdentity((accountId, publicKey) => knownKeys.push(`${accountId}:${publicKey}`));

    senderTransport.autoDeliver = false;
    await sender.send('hello', receiverIdentity.address);
    expect(senderTransport.sentMessage).not.toBeNull();

    const validMessage = senderTransport.sentMessage!;
    receiverTransport.emit({
      ...validMessage,
      from: (await createIdentity(3)).address,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(received).toHaveLength(0);
    expect(knownKeys).toHaveLength(0);

    receiverTransport.emit(validMessage);
    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]).toMatchObject({
      text: 'hello',
      from: senderIdentity.address,
      verified: true,
    });
    expect(knownKeys).toHaveLength(1);
    expect(knownKeys[0]).toMatch(new RegExp(`^${senderIdentity.address}:04[0-9a-f]{128}$`));
    await sender.disconnect(); await receiver.disconnect();
  });

  it('accepts a signed nickname without putting it in chat history', async () => {
    const { senderIdentity, receiverIdentity, sender, receiver } = await connectedPair();
    const names: string[] = [];
    const messages: ChatMessage[] = [];
    receiver.onProfile((accountId, nickname) => names.push(`${accountId}:${nickname}`));
    receiver.onMessage((message) => messages.push(message));

    await sender.sendProfile('Alice', receiverIdentity.address);
    await vi.waitFor(() => expect(names).toEqual([`${senderIdentity.address}:Alice`]));
    expect(messages).toHaveLength(0);
    await sender.disconnect(); await receiver.disconnect();
  });

  it('exchanges encrypted avatars and explicit removal without messages or receipts', async () => {
    const { senderIdentity, receiverIdentity, sender, receiver, senderTransport } = await connectedPair();
    const photos: string[] = [], messages: ChatMessage[] = [], receipts: string[] = [];
    receiver.onAvatar((peer, photo) => photos.push(`${peer}:${photo}`));
    receiver.onMessage(message => messages.push(message)); sender.onReceipt((peer,id) => receipts.push(`${peer}:${id}`));
    const photo = avatarFixture();
    await sender.sendAvatar(photo, receiverIdentity.address);
    await vi.waitFor(() => expect(photos).toEqual([`${senderIdentity.address}:${photo}`]));
    expect(new TextDecoder().decode(senderTransport.sentMessage!.payload)).not.toContain(photo);
    await sender.sendAvatar('', receiverIdentity.address);
    await vi.waitFor(() => expect(photos).toHaveLength(2)); expect(photos[1]).toBe(`${senderIdentity.address}:`);
    await expect(sender.sendAvatar('https://tracker.test/avatar', receiverIdentity.address)).rejects.toThrow('invalid_avatar');
    // Malicious but authenticated controls must not replace the saved avatar.
    await (sender as unknown as { sendPayload(value: string, peer: string): Promise<void> }).sendPayload('\u0000mesh-avatar-v1:data:image/svg+xml;base64,PHN2Zy8+', receiverIdentity.address);
    await sender.sendProfile('after invalid avatar', receiverIdentity.address);
    const names: string[] = []; receiver.onProfile((_peer, name) => names.push(name));
    await vi.waitFor(() => expect(names).toContain('after invalid avatar'));
    expect(photos).toHaveLength(2); expect(messages).toHaveLength(0); expect(receipts).toHaveLength(0);
    await sender.disconnect(); await receiver.disconnect();
  });

  it('acknowledges only after acceptance and ties the receipt to the stable message ID', async () => {
    const { receiverIdentity, sender, receiver } = await connectedPair();
    const messageId = crypto.randomUUID();
    let release!: () => void;
    const accepted = new Promise<void>((resolve) => { release = resolve; });
    const receipts: string[] = [];
    receiver.onMessage(async () => { await accepted; });
    sender.onReceipt((peer, id) => receipts.push(`${peer}:${id}`));

    await sender.send('queued text', receiverIdentity.address, messageId);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(receipts).toHaveLength(0);
    release();
    await vi.waitFor(() => expect(receipts).toEqual([`${receiverIdentity.address}:${messageId}`]));
    await sender.disconnect(); await receiver.disconnect();
  });

  it('can retry with the same message ID and receive another receipt', async () => {
    const { receiverIdentity, senderTransport, receiverTransport, sender, receiver } = await connectedPair();
    const messageId = crypto.randomUUID();
    const received: string[] = [];
    const receipts: string[] = [];
    receiver.onMessage((message) => { received.push(message.id); });
    sender.onReceipt((peer, id) => { receipts.push(`${peer}:${id}`); });
    receiverTransport.autoDeliver = false; // first receipt is lost
    await sender.send('retry me', receiverIdentity.address, messageId);
    await vi.waitFor(() => expect(received).toEqual([messageId]));
    expect(receipts).toHaveLength(0);

    receiverTransport.autoDeliver = true;
    await sender.send('retry me', receiverIdentity.address, messageId);
    await vi.waitFor(() => expect(receipts).toEqual([`${receiverIdentity.address}:${messageId}`]));
    expect(received).toEqual([messageId, messageId]); // UI deduplicates the second accepted copy
    const encryptedAttempts = senderTransport.sentMessages.filter((message) => message.messageId === messageId);
    expect(encryptedAttempts).toHaveLength(2);
    expect(encryptedAttempts[0].payload).not.toEqual(encryptedAttempts[1].payload);
    await sender.disconnect(); await receiver.disconnect();
  });

  it('exchanges contact consent and read settings only inside encrypted authenticated frames', async () => {
    const { senderIdentity, receiverIdentity, senderTransport, sender, receiver } = await connectedPair();
    const accepted: string[] = [];
    const preferences: string[] = [];
    const reads: string[] = [];
    const messages: ChatMessage[] = [];
    receiver.onContactAccepted((peer) => accepted.push(peer));
    receiver.onReadPreference((peer, enabled) => preferences.push(`${peer}:${enabled}`));
    receiver.onReadReceipt((peer, id) => reads.push(`${peer}:${id}`));
    receiver.onMessage((message) => { messages.push(message); });
    const messageId = crypto.randomUUID();

    await sender.sendContactAccepted(receiverIdentity.address);
    await sender.sendReadPreference(true, receiverIdentity.address);
    await sender.sendReadReceipt(messageId, receiverIdentity.address);
    await vi.waitFor(() => expect(reads).toEqual([`${senderIdentity.address}:${messageId}`]));
    expect(accepted).toEqual([senderIdentity.address]);
    expect(preferences).toEqual([`${senderIdentity.address}:true`]);
    expect(messages).toHaveLength(0);
    for (const frame of senderTransport.sentMessages.slice(-3)) {
      expect(new TextDecoder().decode(frame.payload)).not.toContain('mesh-read-');
      expect(new TextDecoder().decode(frame.payload)).not.toContain('mesh-contact-');
    }
    await sender.disconnect(); await receiver.disconnect();
  });

  it('does not acknowledge a message rejected by local storage', async () => {
    const { receiverIdentity, sender, receiver } = await connectedPair();
    const receipts: string[] = [];
    receiver.onMessage(() => { throw new Error('storage_failed'); });
    sender.onReceipt((peer, id) => { receipts.push(`${peer}:${id}`); });
    await sender.send('not persisted', receiverIdentity.address);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(receipts).toHaveLength(0);
    await sender.disconnect(); await receiver.disconnect();
  });

  it('rejects a signed message redirected to a different recipient', async () => {
    const { senderIdentity, receiverIdentity, senderTransport, sender, receiver } = await connectedPair();
    const intendedIdentity = await createIdentity(2);
    const wrongIdentity = await createIdentity(3);
    const wrongTransport = new TestTransport();
    const wrongRecipient = new ChatService(wrongTransport);
    const received: ChatMessage[] = [];
    await wrongRecipient.init(wrongIdentity);
    wrongRecipient.onMessage((message) => received.push(message));

    senderTransport.autoDeliver = false;
    await sender.send('for another account', intendedIdentity.address);
    wrongTransport.emit({ ...senderTransport.sentMessage!, to: wrongIdentity.address });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(received).toHaveLength(0);
    await sender.disconnect(); await receiver.disconnect(); await wrongRecipient.disconnect();
  });

  it('puts no plaintext on the wire and rejects ciphertext tampering and replay', async () => {
    const { receiverIdentity, senderTransport, receiverTransport, sender, receiver } = await connectedPair();
    const received: ChatMessage[] = [];
    receiver.onMessage((message) => received.push(message));
    senderTransport.autoDeliver = false;
    await sender.send('private phrase', receiverIdentity.address);
    const original = senderTransport.sentMessage!;
    expect(new TextDecoder().decode(original.payload)).not.toContain('private phrase');

    const payload = original.payload.slice();
    payload[payload.length - 1] ^= 1;
    receiverTransport.emit({ ...original, payload });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(received).toHaveLength(0);

    receiverTransport.emit(original);
    await vi.waitFor(() => expect(received).toHaveLength(1));
    receiverTransport.emit(original);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(received).toHaveLength(1);
    await sender.disconnect(); await receiver.disconnect();
  });

  it('establishes fresh ciphertext after a connection is dropped', async () => {
    const { receiverIdentity, senderTransport, receiverTransport, sender, receiver } = await connectedPair();
    const received: ChatMessage[] = [];
    receiver.onMessage((message) => received.push(message));
    await sender.send('before', receiverIdentity.address);
    await vi.waitFor(() => expect(received).toHaveLength(1));
    const oldPacket = senderTransport.sentMessage!;

    senderTransport.leave();
    const newReady: string[] = [];
    sender.onPeerChange((_, event) => { if (event === 'joined') newReady.push('sender'); });
    receiver.onPeerChange((_, event) => { if (event === 'joined') newReady.push('receiver'); });
    await sender.connect(receiverIdentity.address);
    await vi.waitFor(() => expect(newReady).toHaveLength(2));
    await sender.send('after', receiverIdentity.address);
    await vi.waitFor(() => expect(received).toHaveLength(2));
    receiverTransport.emit(oldPacket);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(received).toHaveLength(2);
    await sender.disconnect(); await receiver.disconnect();
  });

  it('does not accept even correctly signed plaintext as a downgrade', async () => {
    const { senderIdentity, receiverIdentity, receiverTransport, sender, receiver } = await connectedPair();
    const received: ChatMessage[] = [];
    receiver.onMessage((message) => received.push(message));
    const oldStyle = await signedFrame(senderIdentity, receiverIdentity.address,
      new TextEncoder().encode('\u0000mesh-chat-v1:exposed text'));
    receiverTransport.emit(oldStyle);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(received).toHaveLength(0);
    await sender.disconnect(); await receiver.disconnect();
  });

  it('sends file offer, acceptance, and binary chunks only inside the authenticated encrypted session', async () => {
    const { senderIdentity, receiverIdentity, senderTransport, sender, receiver } = await connectedPair();
    const offers: string[] = [];
    const controls: string[] = [];
    const chunks: Uint8Array[] = [];
    receiver.onFileOffer((peer, offer) => offers.push(`${peer}:${offer.name}`));
    sender.onFileControl((peer, id, action) => controls.push(`${peer}:${id}:${action}`));
    receiver.onFileChunk((peer, id, index, bytes) => {
      expect(peer).toBe(senderIdentity.address);
      expect(id).toBe('12345678-1234-4234-8234-123456789abc');
      expect(index).toBe(0);
      chunks.push(bytes);
    });
    const offer = { id: '12345678-1234-4234-8234-123456789abc', name: 'private.txt', size: 3,
      mime: 'text/plain', sha256: 'a'.repeat(64) };
    await sender.sendFileOffer(offer, receiverIdentity.address);
    expect(new TextDecoder().decode(senderTransport.sentMessage!.payload)).not.toContain('private.txt');
    await vi.waitFor(() => expect(offers).toEqual([`${senderIdentity.address}:private.txt`]));
    await receiver.sendFileControl('accept', offer.id, senderIdentity.address);
    await vi.waitFor(() => expect(controls).toEqual([`${receiverIdentity.address}:${offer.id}:accept`]));
    await sender.sendFileChunk(offer.id, 0, new Uint8Array([0, 255, 1]), receiverIdentity.address);
    await vi.waitFor(() => expect(chunks).toHaveLength(1));
    expect(chunks[0]).toEqual(new Uint8Array([0, 255, 1]));
    await sender.disconnect(); await receiver.disconnect();
  });

  it('rejects a modified or replayed encrypted file chunk', async () => {
    const { receiverIdentity, senderTransport, receiverTransport, sender, receiver } = await connectedPair();
    const chunks: Uint8Array[] = [];
    receiver.onFileChunk((_peer, _id, _index, bytes) => chunks.push(bytes));
    senderTransport.autoDeliver = false;
    await sender.sendFileChunk('12345678-1234-4234-8234-123456789abc', 0,
      new Uint8Array([1, 2, 3]), receiverIdentity.address);
    const original = senderTransport.sentMessage!;
    const damaged = original.payload.slice();
    damaged[damaged.length - 1] ^= 1;
    receiverTransport.emit({ ...original, payload: damaged });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(chunks).toHaveLength(0);
    receiverTransport.emit(original);
    await vi.waitFor(() => expect(chunks).toHaveLength(1));
    receiverTransport.emit(original);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(chunks).toHaveLength(1);
    await sender.disconnect(); await receiver.disconnect();
  });
});

it('retains a sender queue grant received over encrypted chat and automatically polls after a fresh unlock without an own node',async()=>{
 const f=await connectedPair(),node=await createIdentity(7);
 let as={...emptyCourierState(),enabled:true,node:{url:'https://queue.example',nodeId:'a'.repeat(32),address:node.address}},bs=emptyCourierState(),saved=emptyCourierState();
 const chats=(peer:string)=>setContactState(ensureConversation(emptySessionChats(),peer),peer,'accepted');
 const ac=chats(f.receiverIdentity.address),bc=chats(f.senderIdentity.address);
 const request=vi.fn(async(_url:string,_node:string,_identity:unknown,address:string,path:string,body:any)=>{
  expect(address).toBe(f.receiverIdentity.address);expect(path).toBe('/receive/list');expect(body.grant.body.from).toBe(f.senderIdentity.address);expect(body.grant.body.to).toBe(address);
  return {protocol:'automesh-inbox-v1',deliveries:[],cursor:''};
 });
 const a=new CourierController({address:f.senderIdentity.address,identity:f.senderIdentity.provider,state:()=>as,update:s=>as=s as typeof as,chats:()=>ac,persist:async()=>true,receive:()=>{},delivery:()=>{},error:()=>{},publish:(peer,value)=>f.sender.sendCourierBundle(value,peer)});
 const makeReceiver=()=>new CourierController({address:f.receiverIdentity.address,identity:f.receiverIdentity.provider,state:()=>bs,update:s=>bs=s,chats:()=>bc,persist:async()=>{saved=JSON.parse(JSON.stringify(bs));return true;},receive:()=>{},delivery:()=>{},error:()=>{},publish:(peer,value)=>f.receiver.sendCourierBundle(value,peer),request});
 let b=makeReceiver();
 f.receiver.onCourierBundle((peer,value)=>b.accept(peer,value));
 try{
  await a.publish(f.receiverIdentity.address);
  await vi.waitFor(()=>expect(saved.bundles[f.senderIdentity.address]?.body.senderQueue?.grant.body.to).toBe(f.receiverIdentity.address));
  b.start();await vi.waitFor(()=>expect(request).toHaveBeenCalled());b.stop();await b.settled();
  bs=restoreCourierState(saved);expect(bs.node).toBeNull();request.mockClear();b=makeReceiver();b.start();
  await vi.waitFor(()=>expect(request).toHaveBeenCalled());
 }finally{a.stop();b.stop();await a.settled();await b.settled();node.provider.dispose();await f.sender.disconnect();await f.receiver.disconnect();}
});

it.each([0,17])('replenishes a depleted key cache with %s remaining in the opposite direction over the real encrypted chat',async(remaining)=>{
 const f=await connectedPair();let now=Date.now();const clock=vi.spyOn(Date,'now').mockImplementation(()=>now);
 let as=emptyCourierState(),bs=emptyCourierState();
 const chats=(peer:string)=>{const c=setContactState(ensureConversation(emptySessionChats(),peer),peer,'accepted');c.byPeer[peer].connection='connected';return c;};
 const ac=chats(f.receiverIdentity.address),bc=chats(f.senderIdentity.address),messages:ChatMessage[]=[];f.receiver.onMessage(m=>messages.push(m));
 const a=new CourierController({address:f.senderIdentity.address,identity:f.senderIdentity.provider,state:()=>as,update:s=>as=s,chats:()=>ac,persist:async()=>true,receive:()=>{},delivery:()=>{},error:()=>{},publish:(peer,value)=>f.sender.sendCourierBundle(value,peer)});
 const b=new CourierController({address:f.receiverIdentity.address,identity:f.receiverIdentity.provider,state:()=>bs,update:s=>bs=s,chats:()=>bc,persist:async()=>true,receive:()=>{},delivery:()=>{},error:()=>{},publish:(peer,value)=>f.receiver.sendCourierBundle(value,peer)});
 f.sender.onCourierBundle((peer,value)=>a.accept(peer,value));f.receiver.onCourierBundle((peer,value)=>b.accept(peer,value));
 try{
  await a.publish(f.receiverIdentity.address);await vi.waitFor(()=>{expect(as.bundles[f.receiverIdentity.address]?.body.keys).toHaveLength(32);expect(bs.bundles[f.senderIdentity.address]?.body.keys).toHaveLength(32);});
  const beforeA=as.bundles[f.receiverIdentity.address],beforeB=bs.bundles[f.senderIdentity.address],old=bs.keys.find(k=>k.id===beforeA.body.keys[0].id)!;
  const node=await createIdentity(3),id=crypto.randomUUID();
  const job=await createCourierJob(f.senderIdentity.provider,f.senderIdentity.address,node.address,beforeA,beforeA.body.keys[0],id,Date.now(),'pending before refresh');
  for(const k of beforeA.body.keys)as.used[k.id]=k===beforeA.body.keys[0]?job.body.expiresAt+86400000:now+86400000;
  for(const k of beforeB.body.keys.slice(0,32-remaining))bs.used[k.id]=now+86400000;
  now+=6000;await a.publish(f.receiverIdentity.address);
  await vi.waitFor(()=>{
   const fresh=as.bundles[f.receiverIdentity.address].body.keys;expect(fresh.filter(k=>!as.used[k.id])).toHaveLength(32);
   expect(bs.bundles[f.senderIdentity.address].body.keys.filter(k=>!bs.used[k.id])).toHaveLength(remaining||32);
  });
  expect(bs.keys.find(k=>k.id===old.id)?.retired).toBe(true);expect(restoreCourierState(bs).version).toBe(3);
  expect(restoreCourierState(bs).keys.find(k=>k.id===old.id)?.privateKey).toBe(old.privateKey);
  const hop=await signCourier('hop',{protocol:'automesh-courier-v1',courier:node.address,id,digest:await cipherDigest(job.body.packet)},node.provider);
  expect((await openCourier(job,hop,old,f.receiverIdentity.address)).content).toBe('pending before refresh');
  const count=as.keys.length;now+=6000;await a.publish(f.receiverIdentity.address);await a.settled();await b.settled();expect(as.keys).toHaveLength(count);
  expect(messages).toHaveLength(0);node.provider.dispose();
 }finally{a.stop();b.stop();await a.settled();await b.settled();clock.mockRestore();await f.sender.disconnect();await f.receiver.disconnect();}
});
