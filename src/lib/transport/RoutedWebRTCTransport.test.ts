import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoutedWebRTCTransport } from './RoutedWebRTCTransport';
import { TRANSPORT_CAPABILITIES, type TransportMessage, type TransportStatus, type Peer } from './transport';
import type { SignalingEndpoint } from './client-config';
import { ChatService, type ChatMessage } from '$lib/chat/ChatService';
import { WebCryptoIdentity } from '$lib/identity/webcrypto';
import { getAccountId } from '$lib/addressing/address';
import { bytesToHex } from '$lib/message/encoding';
import { emptySessionChats, receiveMessage } from '$lib/chat/session-chats';
import type { CourierDelivery, CourierReply } from '$lib/node/courier-controller';
import { receiveRouting } from '$lib/node/receive-routing';
import { emptyCourierState } from '$lib/node/courier-state';

const internet: SignalingEndpoint = { kind: 'internet', url: 'wss://chat.example/signal' };
const lan: SignalingEndpoint = { kind: 'lan', url: 'wss://192.168.0.10:3002/signal' };
const live: RoutedWebRTCTransport[] = [];
afterEach(async () => { await Promise.all(live.map((item) => item.disconnect())); live.length = 0; vi.useRealTimers(); });

class FakeNode {
  readonly capabilities = TRANSPORT_CAPABILITIES.webrtc;
  status: TransportStatus = 'idle';
  address = '';
  initCount = 0;
  sent: TransportMessage[] = [];
  connections = new Set<string>();
  rejected = false;
  private statuses: Array<(status: TransportStatus) => void> = [];
  private messages: Array<(message: TransportMessage) => void> = [];
  private peers: Array<(peer: Peer, event: 'joined' | 'left') => void> = [];
  private failures: Array<(peer: string) => void> = [];
  private couriers: Array<(data: CourierDelivery, reply: CourierReply) => void> = [];
  onCourier(cb: (data: CourierDelivery, reply: CourierReply) => void) { this.couriers.push(cb); }
  emitCourier(data: CourierDelivery, reply: CourierReply) { for (const cb of this.couriers) cb(data, reply); }
  constructor(readonly endpoint: SignalingEndpoint, readonly admit: (peer: string) => boolean,
    readonly fabric: Fabric) {}
  getStatus() { return this.status; }
  getRegistryId() { return this.fabric.ids.get(this.endpoint.url); }
  async isAvailable() { return true; }
  async discover() { return []; }
  async resume() {}
  async init(address: string) {
    this.initCount++;
    if (this.rejected) throw new Error('signaling_registration_rejected');
    this.address = address;
    this.fabric.accounts.set(`${this.endpoint.url}|${address}`, this);
    this.setStatus('connected');
  }
  setStatus(status: TransportStatus) { this.status = status; for (const handler of this.statuses) handler(status); }
  async connect(peer: Peer) {
    const target = this.fabric.accounts.get(`${this.endpoint.url}|${peer.address}`);
    if (!target || target.status !== 'connected') {
      queueMicrotask(() => { for (const handler of this.failures) handler(peer.address); });
      return;
    }
    if (!target.admit(this.address)) return;
    if (!this.connections.has(peer.address)) {
      this.connections.add(peer.address); target.connections.add(this.address);
      for (const handler of target.peers) handler({ ...peer, address: this.address }, 'joined');
      for (const handler of this.peers) handler(peer, 'joined');
    }
  }
  async send(message: TransportMessage) {
    if (!this.connections.has(message.to)) throw new Error('channel_closed');
    this.sent.push(message);
    const target = this.fabric.accounts.get(`${this.endpoint.url}|${message.to}`);
    queueMicrotask(() => target?.emit(message));
  }
  emit(message: TransportMessage) { for (const handler of this.messages) handler(message); }
  releasePeer(peer: string) {
    if (!this.connections.delete(peer)) return;
    const target = this.fabric.accounts.get(`${this.endpoint.url}|${peer}`);
    target?.releasePeer(this.address);
    for (const handler of this.peers) handler({ address: peer, transport: 'webrtc', lastSeen: 0 }, 'left');
  }
  async disconnect() {
    for (const peer of [...this.connections]) this.releasePeer(peer);
    this.fabric.accounts.delete(`${this.endpoint.url}|${this.address}`);
    this.setStatus('idle');
  }
  onStatusChange(cb: (status: TransportStatus) => void) { this.statuses.push(cb); }
  onMessage(cb: (message: TransportMessage) => void) { this.messages.push(cb); }
  onPeerChange(cb: (peer: Peer, event: 'joined' | 'left') => void) { this.peers.push(cb); }
  onPeerFailure(cb: (peer: string) => void) { this.failures.push(cb); }
}
class Fabric {
  ids = new Map([[internet.url, 'a'.repeat(32)], [lan.url, 'b'.repeat(32)]]);
  accounts = new Map<string, FakeNode>();
  unavailable = new Set<string>();
  created: FakeNode[] = [];
  probe = vi.fn(async (url: string) => {
    if (this.unavailable.has(url)) throw new Error('node_unreachable');
    return { registryId: this.ids.get(url) };
  });
  router(endpoints = [internet, lan], quick = false) {
    const router = new RoutedWebRTCTransport(endpoints, quick, (endpoint, admit) => {
      const child = new FakeNode(endpoint, admit, this); this.created.push(child); return child;
    }, this.probe);
    live.push(router); return router;
  }
}
const peer = (address: string): Peer => ({ address, transport: 'webrtc', lastSeen: 0 });
const message = (from: string, to: string): TransportMessage => ({ from, to, payload: new Uint8Array([42]),
  signature: new Uint8Array(), timestamp: 1, messageId: 'sample', ttl: 1 });

describe('per-peer network routes', () => {
  it('prefers the server node for new routes without moving a live direct conversation',async()=>{
    const fabric=new Fabric(), server={url:'wss://node.example/signal',kind:'internet' as const};
    fabric.ids.set(server.url,'c'.repeat(32));
    const alice=fabric.router([internet]),bob=fabric.router([internet]),carol=fabric.router([server]);
    await alice.init('Alice');await bob.init('Bob');await carol.init('Carol');await alice.connect(peer('Bob'));
    const config=receiveRouting([internet],{quickReserve:false,nodes:[]},'https://automesh.space/',{
      ...emptyCourierState(),enabled:true,node:{url:'https://node.example',nodeId:'c'.repeat(32),address:'node'}});
    await alice.configure(config.endpoints,false,config.required);
    expect(alice.getNodeStates()[0].url).toBe(server.url);
    expect(alice.getPeerRoutes().Bob).toBe(internet.url);
    await alice.connect(peer('Carol'));expect(alice.getPeerRoutes().Carol).toBe(server.url);
    await alice.send(message('Alice','Bob'));await alice.send(message('Alice','Carol'));
    expect(fabric.accounts.get(internet.url+'|Alice')!.sent.map(m=>m.to)).toEqual(['Bob']);
    expect(fabric.accounts.get(server.url+'|Alice')!.sent.map(m=>m.to)).toEqual(['Carol']);
  });
  it('falls back to the application and restores the preferred receiving node after resume',async()=>{
    const fabric=new Fabric(),server={url:'wss://node.example/signal',kind:'internet' as const};
    fabric.ids.set(server.url,'c'.repeat(32));fabric.unavailable.add(server.url);
    const router=new RoutedWebRTCTransport([server,internet,lan],false,(e,admit)=>{
      const n=new FakeNode(e,admit,fabric);fabric.created.push(n);return n;
    },fabric.probe,[server.url]);live.push(router);
    await router.init('Alice');expect(fabric.probe.mock.calls[0][0]).toBe(server.url);
    expect(fabric.accounts.has(internet.url+'|Alice')).toBe(true);
    fabric.unavailable.delete(server.url);await router.resume();
    expect(router.getNodeStates()[0].status).toBe('connected');
    const received=vi.fn();router.onCourier(received);
    fabric.accounts.get(server.url+'|Alice')!.emitCourier({from:'node'} as CourierDelivery,()=>{});
    expect(received).toHaveBeenCalledOnce();expect(router.getPeerRoutes()).toEqual({});
  });
  it('keeps a required internet reception channel without opening a peer or every reserve',async()=>{
    vi.useFakeTimers();const fabric=new Fabric();const receiving={kind:'internet' as const,url:'wss://node.example/signal'};
    const unused={kind:'internet' as const,url:'wss://reserve.example/signal'};
    fabric.ids.set(receiving.url,'c'.repeat(32));fabric.ids.set(unused.url,'d'.repeat(32));
    const router=new RoutedWebRTCTransport([internet,receiving,unused],false,(e,admit)=>{
      const node=new FakeNode(e,admit,fabric);fabric.created.push(node);return node;
    },fabric.probe,[receiving.url]);live.push(router);const got=vi.fn();router.onCourier(got);
    await router.init('receiver');await vi.waitFor(()=>expect(fabric.accounts.has(receiving.url+'|receiver')).toBe(true));
    expect(fabric.accounts.has(unused.url+'|receiver')).toBe(false);
    await vi.advanceTimersByTimeAsync(30000);expect(fabric.accounts.has(receiving.url+'|receiver')).toBe(true);
    fabric.accounts.get(receiving.url+'|receiver')!.emitCourier({from:'node'} as CourierDelivery,()=>{});expect(got).toHaveBeenCalledOnce();
    expect(router.getPeerRoutes()).toEqual({});
    await router.configure([internet,receiving,unused],false,[receiving.url]);expect(fabric.accounts.has(receiving.url+'|receiver')).toBe(true);
    await router.configure([internet,receiving,unused],false,[]);expect(fabric.accounts.has(receiving.url+'|receiver')).toBe(false);
  });
  it('restores a required node even while another server remains healthy',async()=>{
    vi.useFakeTimers();const fabric=new Fabric(), receiving={kind:'internet' as const,url:'wss://node.example/signal'};
    fabric.ids.set(receiving.url,'c'.repeat(32));fabric.unavailable.add(receiving.url);
    const router=new RoutedWebRTCTransport([internet,receiving],false,(e,admit)=>{const n=new FakeNode(e,admit,fabric);fabric.created.push(n);return n;},fabric.probe,[receiving.url]);live.push(router);
    await router.init('receiver');await vi.waitFor(()=>expect(fabric.probe).toHaveBeenCalledWith(receiving.url,expect.anything()));
    fabric.unavailable.delete(receiving.url);await router.resume();expect(fabric.accounts.has(receiving.url+'|receiver')).toBe(true);
    await router.disconnect();const calls=fabric.probe.mock.calls.length;await router.resume();expect(fabric.probe.mock.calls.length).toBe(calls);
  });
  it('receives courier frames without a sticky DataChannel route and ignores removed transports', async () => {
    const fabric = new Fabric(); const router = fabric.router([internet]); const received = vi.fn(); const messages = vi.fn();
    router.onCourier(received); router.onMessage(messages); await router.init('Alice');
    const data = { from: 'node' } as CourierDelivery; const reply = vi.fn();
    fabric.created[0].emitCourier(data, reply); expect(received).toHaveBeenCalledWith(data, reply);
    expect(messages).not.toHaveBeenCalled(); expect(router.getPeerRoutes()).toEqual({});
    await router.configure([], false); fabric.created[0].emitCourier(data, reply); expect(received).toHaveBeenCalledTimes(1);
  });
  it('keeps configured LAN registered for courier reception even with normal reserve', async () => {
    const fabric = new Fabric();
    const router = fabric.router();
    await router.init('Alice');
    await vi.waitFor(() => expect(fabric.created.map((node) => node.initCount)).toEqual([1, 1]));
    expect(fabric.probe.mock.calls.map(([url]) => url)).toEqual([internet.url, lan.url]);
    await router.configure([internet, lan], false);
    expect(router.getNodeStates().every(n => n.status === 'connected')).toBe(true);
  });
  it('switches to LAN-only, removes Internet channels and still receives local courier frames', async () => {
    const fabric = new Fabric(); const alice = fabric.router(); const bob = fabric.router([internet]);
    await alice.init('Alice'); await bob.init('Bob'); await alice.connect(peer('Bob'));
    const received = vi.fn(); alice.onCourier(received);
    await alice.configure([lan], false);
    expect(alice.getPeerRoutes()).toEqual({});
    expect(fabric.accounts.has(`${internet.url}|Alice`)).toBe(false);
    expect(alice.getNodeStates()).toHaveLength(1);
    const data = { from: 'local node' } as CourierDelivery;
    fabric.created.find(n => n.endpoint.kind === 'lan')!.emitCourier(data, vi.fn<(id: string, receipt: string) => void>());
    expect(received).toHaveBeenCalledWith(data, expect.any(Function));
  });
  it('selects different nodes for different peers without broadcasting ciphertext', async () => {
    const fabric = new Fabric();
    const alice = fabric.router(); const bob = fabric.router([internet]); const carol = fabric.router([lan]);
    await alice.init('Alice'); await bob.init('Bob'); await carol.init('Carol');
    await alice.connect(peer('Bob')); await alice.connect(peer('Carol'));
    await vi.waitFor(() => expect(alice.getPeerRoutes()).toEqual({ Bob: internet.url, Carol: lan.url }));
    expect(alice.isLocalOnlyPeer('Bob')).toBe(false);
    expect(alice.isLocalOnlyPeer('Carol')).toBe(true);
    await alice.send(message('Alice', 'Bob')); await alice.send(message('Alice', 'Carol'));
    expect(fabric.accounts.get(`${internet.url}|Alice`)!.sent.map((item) => item.to)).toEqual(['Bob']);
    expect(fabric.accounts.get(`${lan.url}|Alice`)!.sent.map((item) => item.to)).toEqual(['Carol']);
  });
  it('keeps a live conversation when signaling becomes unreachable', async () => {
    const fabric = new Fabric();
    const alice = fabric.router(); const bob = fabric.router([internet]);
    await alice.init('Alice'); await bob.init('Bob'); await alice.connect(peer('Bob'));
    const changes = vi.fn(); alice.onPeerChange(changes);
    fabric.unavailable.add(internet.url);
    fabric.accounts.get(`${internet.url}|Alice`)!.setStatus('offline');
    await alice.send(message('Alice', 'Bob'));
    expect(changes).not.toHaveBeenCalled();
    expect(alice.getPeerRoutes().Bob).toBe(internet.url);
  });
  it('reconnects both peers locally after their old channels break', async () => {
    const fabric = new Fabric(); const alice = fabric.router(undefined, true); const bob = fabric.router(undefined, true);
    await alice.init('Alice'); await bob.init('Bob');
    await vi.waitFor(() => expect(alice.getNodeStates().every((node) => node.status === 'connected')).toBe(true));
    await vi.waitFor(() => expect(bob.getNodeStates().every((node) => node.status === 'connected')).toBe(true));
    await alice.connect(peer('Bob'));
    fabric.unavailable.add(internet.url);
    const oldAlice = fabric.accounts.get(`${internet.url}|Alice`)!;
    const oldBob = fabric.accounts.get(`${internet.url}|Bob`)!;
    oldAlice.setStatus('offline'); oldBob.setStatus('offline'); oldAlice.releasePeer('Bob');
    await vi.waitFor(() => expect(alice.getPeerRoutes().Bob).toBe(lan.url));
    await vi.waitFor(() => expect(bob.getPeerRoutes().Alice).toBe(lan.url));
    await alice.send(message('Alice', 'Bob'));
    expect(fabric.accounts.get(`${lan.url}|Alice`)!.sent).toHaveLength(1);
  });
  it('prepares independent nodes but deduplicates listeners of the same registry', async () => {
    const fabric = new Fabric(); fabric.ids.set(lan.url, fabric.ids.get(internet.url)!);
    const router = fabric.router(undefined, true); await router.init('Alice');
    await vi.waitFor(() => expect(router.getNodeStates()[1].alias).toBe(true));
    expect(fabric.created.map((node) => node.initCount)).toEqual([1, 0]);
  });
  it('serializes concurrent alias registrations during configuration and never connects twice to one registry', async () => {
    const fabric = new Fabric(); fabric.ids.set(lan.url, fabric.ids.get(internet.url)!);
    const router = fabric.router([], true); await router.init('Alice');
    const original = FakeNode.prototype.init; let finish!: () => void;
    const gate = new Promise<void>(resolve => finish = resolve);
    const init = vi.spyOn(FakeNode.prototype, 'init').mockImplementation(async function(this: FakeNode, address: string) {
      await gate; return original.call(this,address);
    });
    try {
      const configuring = router.configure([internet,lan],true);
      await vi.waitFor(() => expect(init).toHaveBeenCalledTimes(1));
      const resuming = router.resume(); await Promise.resolve(); await Promise.resolve();
      expect(init).toHaveBeenCalledTimes(1); finish(); await Promise.all([configuring,resuming]);
      expect(router.getNodeStates().filter(n=>n.status==='connected')).toHaveLength(1);
      expect(router.getNodeStates()[1].alias).toBe(true);
      expect(init).toHaveBeenCalledTimes(1);
    } finally { finish(); init.mockRestore(); }
  });
  it('does not register again while a foreground renewal is in progress on the same registry', async () => {
    const fabric = new Fabric(); fabric.ids.set(lan.url, fabric.ids.get(internet.url)!);
    const router = fabric.router(undefined, true); await router.init('Alice');
    await vi.waitFor(() => expect(router.getNodeStates()[1].alias).toBe(true));
    const primary = fabric.created[0]; let finish!: () => void;
    const gate = new Promise<void>(resolve => finish = resolve);
    primary.resume = async () => { primary.setStatus('connecting'); await gate; primary.setStatus('connected'); };
    const renewing = router.resume();
    await vi.waitFor(() => expect(primary.status).toBe('connecting'));
    const configuring = router.configure([internet, lan], true);
    try {
      for (let i=0;i<12;i++) await Promise.resolve();
      expect(primary.initCount).toBe(1);
      expect(fabric.created[1].initCount).toBe(0);
    } finally { finish(); await Promise.all([renewing, configuring]); }
    expect(router.getNodeStates().filter(n => n.status === 'connected')).toHaveLength(1);
  });
  it('keeps independent home and server listeners connected simultaneously without reserve mode', async () => {
    const fabric = new Fabric(), router = fabric.router(); await router.init('Alice');
    await vi.waitFor(() => expect(router.getNodeStates().every(n=>n.status==='connected')).toBe(true));
    await router.resume();
    expect(router.getNodeStates().every(n=>n.status==='connected'&&!n.alias)).toBe(true);
  });
  it('does not interrupt a live LAN chat when Internet returns', async () => {
    vi.useFakeTimers();
    const fabric = new Fabric(); fabric.unavailable.add(internet.url);
    const alice = fabric.router(); const bob = fabric.router([lan]);
    await alice.init('Alice'); await bob.init('Bob'); await alice.connect(peer('Bob'));
    fabric.unavailable.clear();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(alice.getPeerRoutes().Bob).toBe(lan.url);
    expect(fabric.created[0].initCount).toBe(0);
  });
  it('keeps an all-offline client usable and cancels retries on logout', async () => {
    vi.useFakeTimers();
    const fabric = new Fabric(); fabric.unavailable.add(internet.url); fabric.unavailable.add(lan.url);
    const router = fabric.router(); await router.init('Alice'); await router.connect(peer('Bob'));
    expect(router.getStatus()).toBe('offline');
    await router.disconnect();
    const count = fabric.probe.mock.calls.length;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fabric.probe).toHaveBeenCalledTimes(count);
    await expect(router.send(message('Alice', 'Bob'))).rejects.toThrow('peer_unreachable');
  });
  it('changing reserve mode preserves active conversations; disabling their node reconnects them', async () => {
    const fabric = new Fabric(); const alice = fabric.router(); const bob = fabric.router([internet]);
    await alice.init('Alice'); await bob.init('Bob'); await alice.connect(peer('Bob'));
    await alice.configure([internet, lan], true);
    expect(alice.getPeerRoutes().Bob).toBe(internet.url);
    await alice.configure([internet, lan], false);
    await alice.send(message('Alice', 'Bob'));
    await alice.configure([lan], false);
    expect(alice.getPeerRoutes().Bob).toBeUndefined();
    await expect(alice.send(message('Alice', 'Bob'))).rejects.toThrow('peer_unreachable');
  });
  it('does not remain stuck if an online node never produces an offer', async () => {
    vi.useFakeTimers(); const fabric = new Fabric(); const alice = fabric.router();
    // Model the higher-address connect_request case with no PeerConnection yet.
    fabric.created[0].connect = async () => {};
    await alice.init('Alice'); await alice.connect(peer('Bob'));
    expect(alice.getPeerRoutes().Bob).toBe(internet.url);
    await vi.advanceTimersByTimeAsync(20_001);
    expect(alice.getPeerRoutes().Bob).not.toBe(internet.url);
  });
  it('does not bypass a rejected registration by registering on reserve nodes', async () => {
    const fabric = new Fabric(); const alice = fabric.router(); fabric.created[0].rejected = true;
    await alice.init('Alice'); expect(alice.getStatus()).toBe('error');
    expect(fabric.created[1].initCount).toBe(0);
  });
  it('does not treat a duplicate session as a global authentication denial', async () => {
    const fabric = new Fabric(); const alice = fabric.router();
    fabric.created[0].init = async () => { throw new Error('signaling_address_busy'); };
    await alice.init('Alice');
    expect(alice.getStatus()).toBe('connected');
    expect(fabric.created[1].initCount).toBe(1);
    expect(alice.getNodeStates()[0].error).toBe('signaling_address_busy');
  });
});

it('establishes fresh authenticated E2EE after a route break without plaintext or duplicate delivery', async () => {
  const identity = async (byte: number) => {
    const provider = new WebCryptoIdentity(); const seed = new Uint8Array(32); seed[31] = byte;
    const key = (await provider.fromSeed(seed)).publicKey;
    return { provider, address: await getAccountId(bytesToHex(key)) };
  };
  const identities = [await identity(1), await identity(2)].sort((a, b) => a.address.localeCompare(b.address));
  const fabric = new Fabric(); const ar = fabric.router(undefined, true); const br = fabric.router(undefined, true);
  const a = new ChatService(ar); const b = new ChatService(br);
  await a.init(identities[0]); await b.init(identities[1]);
  const received: ChatMessage[] = [];
  let history = emptySessionChats();
  b.onMessage((entry) => {
    received.push(entry);
    history = receiveMessage(history, { ...entry, direction: 'incoming' });
  });
  await a.connect(identities[1].address);
  const id = crypto.randomUUID(); await a.send('before route change', identities[1].address, id);
  await vi.waitFor(() => expect(received).toHaveLength(1));
  fabric.unavailable.add(internet.url);
  const oldA = fabric.accounts.get(`${internet.url}|${identities[0].address}`)!;
  const oldB = fabric.accounts.get(`${internet.url}|${identities[1].address}`)!;
  oldA.setStatus('offline'); oldB.setStatus('offline'); oldA.releasePeer(identities[1].address);
  await vi.waitFor(() => expect(ar.getPeerRoutes()[identities[1].address]).toBe(lan.url));
  await a.send('after route change', identities[1].address);
  await vi.waitFor(() => expect(received).toHaveLength(2));
  expect(received.map((entry) => entry.text)).toEqual(['before route change', 'after route change']);
  // Model an outbox retry when delivery succeeded but its old ACK was lost.
  await a.send('before route change', identities[1].address, id);
  await vi.waitFor(() => expect(received).toHaveLength(3));
  expect(history.byPeer[identities[0].address].messages).toHaveLength(2);
  for (const child of fabric.created) for (const packet of child.sent) {
    expect(new TextDecoder().decode(packet.payload)).not.toContain('route change');
  }
  await a.disconnect(); await b.disconnect();
});
