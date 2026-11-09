import { describe, expect, it, vi } from 'vitest';
import { ChatService } from '../chat/ChatService';
import { WebCryptoIdentity } from '../identity/webcrypto';
import { accountIdFromPublicKey } from '../addressing/account-id.js';
import { createDeviceRequest, deviceComparisonCode } from './enrollment';
import { createOwnerDeviceStore } from './owner-store';
import { createDeviceDelivery } from './delivery';
import { createDeviceChatBridge } from './chat-bridge';
import { webCryptoEnvironment } from '../core/ports';
import type { CoreRecordStore, SealedCoreRecord } from '../core/durable-state';
import { TRANSPORT_CAPABILITIES, type Transport, type Peer, type TransportMessage, type TransportStatus } from '../transport/transport';

// Actual ChatService and MAE cryptography, only the physical network is in memory.
class Network implements Transport {
  capabilities = TRANSPORT_CAPABILITIES.webrtc;
  address = ''; messages: TransportMessage[] = [];
  handlers: Array<(msg: TransportMessage) => void> = [];
  peerHandlers: Array<(peer: Peer, event: 'joined' | 'left') => void> = [];
  constructor(private network: Map<string, Network>) {}
  getStatus(): TransportStatus { return 'connected'; }
  async init(id: string) { this.address = id; this.network.set(id, this); }
  async connect(peer: Peer) {
    for (const h of this.peerHandlers) h(peer, 'joined');
    for (const h of this.network.get(peer.address)!.peerHandlers) h({ address: this.address, lastSeen: Date.now(), transport: 'webrtc' }, 'joined');
  }
  async send(msg: TransportMessage) {
    this.messages.push(structuredClone(msg));
    const target = this.network.get(msg.to); if (!target) throw new Error('offline');
    queueMicrotask(() => { for (const h of target.handlers) h(structuredClone(msg)); });
  }
  async disconnect() { this.network.delete(this.address); }
  async isAvailable() { return true; }
  async discover() { return []; }
  onMessage(h: (msg: TransportMessage) => void) { this.handlers.push(h); }
  onPeerChange(h: (peer: Peer, event: 'joined' | 'left') => void) { this.peerHandlers.push(h); }
  onStatusChange(_h: (status: TransportStatus) => void) {}
}
function records(): CoreRecordStore {
  const entries = new Map<string, SealedCoreRecord>();
  return { async read(scope) { const record = entries.get(scope); return record && structuredClone(record); },
    async compareAndSwap(scope, revision, next) {
      if ((entries.get(scope)?.revision ?? null) !== revision) return false; entries.set(scope, structuredClone(next)); return true;
    } };
}
const key = () => crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
describe('multi-device overlay on the actual encrypted chat channel', () => {
  it('delivers both ways to independent device keys without plaintext on the wire or weaker v1 identity validation', async () => {
    const environment = webCryptoEnvironment(), first = new WebCryptoIdentity(), second = new WebCryptoIdentity();
    await first.create(); await second.create();
    const a = await accountIdFromPublicKey(await first.getPublicKeyBytes()), b = await accountIdFromPublicKey(await second.getPublicKeyBytes());
    const phone = await createDeviceRequest('Independent Bob phone', environment), c = phone.request.record.author;
    const alice = createOwnerDeviceStore({ owner: a, signer: first, key: await key(), records: records(), environment, guard: () => {} });
    const bob = createOwnerDeviceStore({ owner: b, signer: second, key: await key(), records: records(), environment, guard: () => {} });
    await alice.setPrimaryEnabled(true, true); await bob.setPrimaryEnabled(true, true);
    await bob.approve(phone.request, { approved: true, comparisonCode: await deviceComparisonCode(b, phone.request, environment) });
    const policies = new Map([[a, await alice.publish()], [b, await bob.publish()]]), network = new Map<string, Network>();
    const clients: Array<{ chat: ChatService; bridge: ReturnType<typeof createDeviceChatBridge>; engine: ReturnType<typeof createDeviceDelivery>; wire: Network; ready: Set<string> }> = [];
    const errors: unknown[] = [];
    try {
      for (const identity of [{ owner: a, device: a, provider: first }, { owner: b, device: b, provider: second }, { owner: b, device: c, provider: phone.signer }]) {
        const wire = new Network(network), chat = new ChatService(wire), ready = new Set<string>();
        chat.onPeerChange((peer, event) => { if (event === 'joined') ready.add(peer.address); });
        await chat.init({ address: identity.device, provider: identity.provider });
        const bridge = createDeviceChatBridge(chat, error => errors.push(error));
        const engine = createDeviceDelivery({ owner: identity.owner, device: identity.device, key: await key(), records: records(), environment,
          policy: async owner => policies.get(owner), sendEncrypted: bridge.sendEncrypted, guard: () => {} });
        bridge.listen(engine.receive); clients.push({ chat, bridge, engine, wire, ready });
      }
      await clients[0].chat.connect(b); await clients[0].chat.connect(c); await clients[1].chat.connect(c);
      await vi.waitFor(() => expect(clients.map(client => client.ready.size)).toEqual([2, 2, 2]), { timeout: 5000 });
      const id = await clients[0].engine.send(b, 'E2EE multi-device payload'); await clients[0].engine.flush();
      await vi.waitFor(async () => expect((await clients[0].engine.inspect()).outbox[0].targets.every(t => t.status === 'received')).toBe(true));
      expect((await clients[1].engine.inspect()).inbox[0].event.id).toBe(id);
      expect((await clients[2].engine.inspect()).inbox[0].event.id).toBe(id);
      await clients[2].engine.send(a, 'Reply from independent phone'); await clients[2].engine.flush();
      await vi.waitFor(async () => expect((await clients[0].engine.inspect()).inbox[0]?.event.text).toBe('Reply from independent phone'));
      await vi.waitFor(async () => expect((await clients[1].engine.inspect()).inbox).toHaveLength(2));
      expect((await clients[1].engine.inspect()).inbox[1].kind).toBe('sync');
      for (const client of clients) for (const frame of client.wire.messages) {
        const raw = new TextDecoder().decode(frame.payload);
        expect(raw).not.toContain('E2EE multi-device payload'); expect(raw).not.toContain('Reply from independent phone');
      }
      expect(errors).toEqual([]);
    } finally {
      for (const client of clients) { client.bridge.close(); client.engine.close(); await client.chat.disconnect(); }
      alice.close(); bob.close(); phone.close(); first.dispose(); second.dispose();
    }
  });
});
