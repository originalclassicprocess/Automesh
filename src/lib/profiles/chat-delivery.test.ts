import { describe, expect, it, vi } from 'vitest';
import { prepareProfileChatContext } from './chat-context';
import { deriveProfileSeed } from './keys';
import { createProfileRegistry, addProfile, type ProfileEntry } from '../core/profiles';
import { WebCryptoIdentity } from '../identity/webcrypto';
import { accountIdFromPublicKey } from '../addressing/account-id.js';
import { ChatService, type ChatMessage } from '../chat/ChatService';
import { TRANSPORT_CAPABILITIES, type Transport, type TransportMessage, type Peer, type TransportStatus } from '../transport/transport';
import { generateCourierKey, createCourierJob, openCourier, signCourier } from '../node/courier-crypto';
import { cipherDigest } from '../node/offline-crypto';
import { COURIER_PROTOCOL } from '../node/courier-protocol.js';

// Controlled wire only; the real ChatService, signatures, handshake and E2EE run.
// This is NOT a browser WebRTC/router reachability test.
class Wire implements Transport {
  capabilities = TRANSPORT_CAPABILITIES.webrtc;
  address = ''; peer?: Wire; frames: TransportMessage[] = [];
  messages: ((value: TransportMessage) => void)[] = [];
  peers: ((peer: Peer, event: 'joined' | 'left') => void)[] = [];
  getStatus(): TransportStatus { return 'connected'; }
  async init(address: string) { this.address = address; }
  async connect(peer: Peer) {
    this.peers.forEach(h => h(peer,'joined'));
    this.peer?.peers.forEach(h => h({ address: this.address, transport: 'webrtc', lastSeen: Date.now() },'joined'));
  }
  async disconnect() { this.peer = undefined; }
  async isAvailable() { return true; }
  async discover() { return []; }
  async send(message: TransportMessage) {
    this.frames.push(structuredClone(message)); const target = this.peer;
    if (target) queueMicrotask(() => target.messages.forEach(h => h(structuredClone(message))));
  }
  onMessage(h: (value: TransportMessage) => void) { this.messages.push(h); }
  onStatusChange(_h: (value: TransportStatus) => void) {}
  onPeerChange(h: (peer: Peer, event: 'joined' | 'left') => void) { this.peers.push(h); }
}
const root = new Uint8Array(32); root[31] = 1;
async function fixture() {
  const ownerProvider = new WebCryptoIdentity();
  const owner = await accountIdFromPublicKey((await ownerProvider.fromSeed(root)).publicKey); ownerProvider.dispose();
  const entry = async (index: number, role: ProfileEntry['role']): Promise<ProfileEntry> => {
    const seed = await deriveProfileSeed(root,index,crypto.subtle), provider = new WebCryptoIdentity();
    try { return { id: crypto.randomUUID(), index, role, name: role, archived: false, createdAt: 1000,
      accountId: await accountIdFromPublicKey((await provider.fromSeed(seed)).publicKey) }; }
    finally { seed.fill(0); provider.dispose(); }
  };
  const main = await entry(0,'main'), a = await entry(1,'incoming'), b = await entry(2,'outgoing');
  const registry = addProfile(addProfile(createProfileRegistry(main),a),b);
  const options = { root, owner, registry, guard() {}, read: async () => undefined };
  return { owner, main, a, b, context: (id: string) => prepareProfileChatContext({ ...options, profileId: id }) };
}
async function remote() {
  const provider = new WebCryptoIdentity(); await provider.create();
  return { provider, address: await accountIdFromPublicKey(await provider.getPublicKeyBytes()) };
}
describe('derived profile delivery boundaries', () => {
  it('uses two child addresses (not owner/main) in authenticated conversations and receipts', async () => {
    const f = await fixture();
    for (const profile of [f.a,f.b]) {
      const context = await f.context(profile.id), recipient = await remote(), wire = new Wire(), other = new Wire();
      wire.peer = other; other.peer = wire;
      const sender = new ChatService(wire), receiver = new ChatService(other), messages: ChatMessage[] = [], receipts: string[] = [], ready: string[] = [];
      receiver.onMessage(m => { messages.push(m); }); sender.onReceipt((_peer,id) => { receipts.push(id); });
      sender.onPeerChange((_peer,event) => { if (event === 'joined') ready.push('a'); });
      receiver.onPeerChange((_peer,event) => { if (event === 'joined') ready.push('b'); });
      try {
        await sender.init({ provider: context.provider, address: context.accountId }); await receiver.init(recipient);
        await sender.connect(recipient.address); await vi.waitFor(() => expect(ready).toHaveLength(2));
        const id = crypto.randomUUID(), text = 'private message from ' + profile.role;
        await sender.send(text,recipient.address,id);
        await vi.waitFor(() => expect(messages).toHaveLength(1)); await vi.waitFor(() => expect(receipts).toContain(id));
        expect(messages[0]).toMatchObject({ from: profile.accountId, id, text });
        expect(wire.address).toBe(profile.accountId);
        expect(wire.frames.every(frame => frame.from === profile.accountId)).toBe(true);
        expect(wire.frames.some(frame => frame.from === f.owner || frame.from === f.main.accountId)).toBe(false);
        expect(new TextDecoder().decode(wire.frames.at(-1)!.payload)).not.toContain(text);
      } finally { await sender.disconnect(); await receiver.disconnect(); context.close(); recipient.provider.dispose(); }
    }
  });
  it('binds queued ciphertext and prekeys to the child profile; another child cannot impersonate it', async () => {
    const f = await fixture(), a = await f.context(f.a.id), b = await f.context(f.b.id), recipient = await remote(), courier = await remote();
    try {
      const expiresAt = Date.now() + 60000, key = await generateCourierKey(a.accountId,expiresAt);
      const bundle = await signCourier('prekeys',{ protocol: COURIER_PROTOCOL, from: recipient.address, to: a.accountId,
        expiresAt, keys: [{ id: key.id, publicKey: key.publicKey }] },recipient.provider);
      const job = await createCourierJob(a.provider,a.accountId,courier.address,bundle,key,crypto.randomUUID(),Date.now(),'queued child A');
      const hop = await signCourier('hop',{ protocol: COURIER_PROTOCOL, courier: courier.address, id: job.body.id, digest: await cipherDigest(job.body.packet) },courier.provider);
      expect((await openCourier(job,hop,key,recipient.address)).content).toBe('queued child A');
      expect(job.body.from).toBe(f.a.accountId); expect(job.body.from).not.toBe(f.owner);
      await expect(createCourierJob(b.provider,b.accountId,courier.address,bundle,key,crypto.randomUUID(),Date.now(),'wrong profile')).rejects.toThrow('invalid_courier_bundle');
      const forged = await signCourier('job',job.body,b.provider);
      await expect(openCourier(forged,hop,key,recipient.address)).rejects.toThrow('invalid_courier_signature');
      const main = await f.context(f.main.id);
      try { expect(main.network).toBe(false); } finally { main.close(); }
    } finally { a.close(); b.close(); recipient.provider.dispose(); courier.provider.dispose(); }
  });
});
