import { WebRTCTransport } from './WebRTCTransport';
import { DirectWebRTCTransport } from './DirectWebRTCTransport';
import type { CourierDelivery, CourierReply } from '$lib/node/courier-controller';
import type { DirectInvite } from './direct-invite';
import { probeSignaling } from './network-settings';
import type { SignalingEndpoint } from './client-config';
import { TRANSPORT_CAPABILITIES, type Transport, type TransportMessage, type TransportStatus,
  type TransportRegistrationIdentity, type Peer } from './transport';

export type NodeState = SignalingEndpoint & { status: TransportStatus; alias: boolean; error: string; registryId?: string };
type Managed = Transport & {
  getRegistryId(): string | undefined;
  releasePeer(peer: string): void;
  onPeerFailure(cb: (peer: string) => void): void;
  onCourier?(cb: (data: CourierDelivery, reply: CourierReply) => void): void;
  resume?(): Promise<void>;
};
type Node = { endpoint: SignalingEndpoint; transport: Managed; status: TransportStatus;
  registryId?: string; alias: boolean; error: string; pending?: Promise<boolean>; abort?: AbortController };

// Each peer has one sticky DataChannel route. Multiple nodes are for discovery
// and negotiation only; encrypted frames are never broadcast to all transports.
export class RoutedWebRTCTransport implements Transport {
  readonly capabilities = TRANSPORT_CAPABILITIES.webrtc;
  private nodes: Node[] = [];
  private self = '';
  private identity?: TransportRegistrationIdentity;
  private running = false;
  private status: TransportStatus = 'idle';
  private quick = false;
  private receiveUrls = new Set<string>();
  private resuming: Promise<void> | null = null;
  private registrations = new Map<string, Promise<boolean>>();
  private policyBlocked = false;
  private routes = new Map<string, Node>();
  private connected = new Set<string>();
  private desired = new Set<string>();
  private trying = new Map<string, Promise<void>>();
  private tried = new Map<string, Set<string>>();
  private retry = new Map<string, ReturnType<typeof setTimeout>>();
  private retryCount = new Map<string, number>();
  private deadlines = new Map<string, ReturnType<typeof setTimeout>>();
  private maintenance: ReturnType<typeof setInterval> | null = null;
  private messages: Array<(message: TransportMessage) => void> = [];
  private statuses: Array<(status: TransportStatus) => void> = [];
  private peers: Array<(peer: Peer, event: 'joined' | 'left') => void> = [];
  private changes: Array<() => void> = [];
  private direct = new DirectWebRTCTransport();
  private directPeers = new Set<string>();
  private couriers: Array<(data: CourierDelivery, reply: CourierReply) => void> = [];
  onCourier(cb: (data: CourierDelivery, reply: CourierReply) => void) { this.couriers.push(cb); }

  constructor(endpoints: SignalingEndpoint[], quickReserve = false,
    private readonly factory = (endpoint: SignalingEndpoint, admitPeer: (peer: string) => boolean): Managed =>
      new WebRTCTransport([endpoint], { admitPeer }),
    private readonly probe = probeSignaling, receiveUrls: Iterable<string> = []) {
    this.quick = quickReserve;
    this.receiveUrls = new Set(receiveUrls);
    this.configureNodes(endpoints);
    this.direct.onPeerChange((peer, event) => {
      if (!this.running) return;
      if (event === 'joined') {
        const previous = this.routes.get(peer.address);
        if (previous) this.dropRoute(peer.address, previous);
        this.directPeers.add(peer.address); this.cancelRetry(peer.address);
        for (const cb of this.peers) cb(peer, 'joined');
      } else if (this.directPeers.delete(peer.address)) {
        for (const cb of this.peers) cb(peer, 'left');
        if (this.nodes.length) this.queueRetry(peer.address, true);
      }
      this.refreshStatus();
    });
    this.direct.onMessage((message) => {
      if (this.running && this.directPeers.has(message.from)) for (const cb of this.messages) cb(message);
    });
  }

  getStatus(): TransportStatus { return this.status; }
  isLocalOnlyPeer(peer: string): boolean { return this.directPeers.has(peer) || this.routes.get(peer)?.endpoint.kind === 'lan'; }
  getNodeStates(): NodeState[] { return this.nodes.map((node) => ({ ...node.endpoint,
    status: node.status, alias: node.alias, error: node.error, registryId: node.registryId })); }
  getPeerRoutes(): Record<string, string> { return Object.fromEntries([
    ...[...this.routes].map(([peer, node]) => [peer, node.endpoint.url]),
    ...[...this.directPeers].map((peer) => [peer, 'Прямое QR-соединение']),
  ]); }
  onNodesChange(cb: () => void): void { this.changes.push(cb); }
  onMessage(cb: (message: TransportMessage) => void): void { this.messages.push(cb); }
  onStatusChange(cb: (status: TransportStatus) => void): void { this.statuses.push(cb); }
  onPeerChange(cb: (peer: Peer, event: 'joined' | 'left') => void): void { this.peers.push(cb); }
  async isAvailable(): Promise<boolean> { return typeof RTCPeerConnection !== 'undefined'; }
  async discover(): Promise<Peer[]> { return [...new Set([...this.connected, ...this.directPeers])].map((address) => this.peer(address)); }
  createDirectOffer(): Promise<DirectInvite> { return this.direct.createOffer(); }
  acceptDirectOffer(packet: DirectInvite): Promise<DirectInvite> { return this.direct.acceptOffer(packet); }
  acceptDirectAnswer(packet: DirectInvite): Promise<string> { return this.direct.acceptAnswer(packet); }
  cancelPendingDirect(): void { this.direct.cancelPending(); }
  hasPendingDirectPeer(peer: string): boolean { return this.direct.hasPendingPeer(peer); }
  closeDirectPeer(peer: string): void { this.direct.closePeer(peer); }

  async init(address: string, identity?: TransportRegistrationIdentity): Promise<void> {
    this.self = address;
    this.identity = identity;
    this.running = true;
    await this.direct.init(address, identity);
    this.refreshStatus();
    for (const node of this.nodes) if (await this.ensureNode(node)) break;
    if (!this.running) return;
    if (this.quick) void this.warmNodes();
    else void this.warmLan();
    this.maintenance = setInterval(() => { void this.maintain(); }, 10_000);
    this.refreshStatus();
  }

  async configure(endpoints: SignalingEndpoint[], quickReserve: boolean, receiveUrls: Iterable<string> = this.receiveUrls): Promise<void> {
    this.policyBlocked = false;
    this.quick = quickReserve;
    this.receiveUrls = new Set(receiveUrls);
    this.configureNodes(endpoints);
    if (this.running) {
      if (this.quick) await this.warmNodes();
      else {
        const preferred = this.nodes.find((node) => node.status === 'connected');
        for (const node of this.nodes) if (node.endpoint.kind !== 'lan' && !this.receiveUrls.has(node.endpoint.url) && node !== preferred && ![...this.routes.values()].includes(node)) {
          node.abort?.abort();
          await node.transport.disconnect();
          node.status = 'idle';
        }
      }
      for (const peer of this.desired) if (!this.routes.has(peer)) this.queueRetry(peer, true);
      await this.maintain();
    }
    this.refreshStatus();
  }

  private configureNodes(endpoints: SignalingEndpoint[]): void {
    const unique = [...new Map(endpoints.map((endpoint) => [endpoint.url, endpoint])).values()]
      .sort((a, b) => Number(a.kind === 'lan') - Number(b.kind === 'lan'));
    const previous = this.nodes;
    this.nodes = unique.map((endpoint) => previous.find((node) => node.endpoint.url === endpoint.url) ?? this.makeNode(endpoint));
    for (const node of previous) if (!this.nodes.includes(node)) {
      node.abort?.abort();
      for (const [peer, route] of this.routes) if (route === node) this.dropRoute(peer, node);
      void node.transport.disconnect();
    }
  }

  private makeNode(endpoint: SignalingEndpoint): Node {
    const node: Node = { endpoint, transport: null as unknown as Managed, status: 'idle', alias: false, error: '' };
    node.transport = this.factory(endpoint, (peer) => this.admit(node, peer));
    node.transport.onStatusChange((status) => {
      if (!this.running || !this.nodes.includes(node)) return;
      node.status = status;
      if (status === 'connected') {
        node.registryId = node.transport.getRegistryId();
        node.error = '';
        for (const peer of this.desired) if (!this.routes.has(peer)) this.queueRetry(peer, true);
      } else if (status === 'offline' || status === 'error') {
        for (const [peer, route] of [...this.routes]) if (route === node && !this.connected.has(peer)) this.routeFailed(peer, node);
        if (!this.nodes.some((item) => item.status === 'connected')) void this.warmNodes(true);
      }
      this.refreshStatus();
    });
    node.transport.onPeerFailure((peer) => this.routeFailed(peer, node));
    node.transport.onCourier?.((data, reply) => {
      if (this.running && this.nodes.includes(node)) for (const cb of this.couriers) cb(data, reply);
    });
    node.transport.onPeerChange((peer, event) => {
      if (!this.running || !this.nodes.includes(node) || this.routes.get(peer.address) !== node) return;
      if (this.directPeers.has(peer.address)) { this.dropRoute(peer.address, node); return; }
      if (event === 'joined') {
        this.cancelDeadline(peer.address);
        this.connected.add(peer.address);
        this.retryCount.delete(peer.address);
        this.cancelRetry(peer.address);
        for (const handler of this.peers) handler(this.peer(peer.address), 'joined');
        this.refreshStatus();
      } else this.routeFailed(peer.address, node);
    });
    node.transport.onMessage((message) => {
      if (this.running && !this.directPeers.has(message.from) && this.routes.get(message.from) === node && this.connected.has(message.from)) {
        for (const handler of this.messages) handler(message);
      }
    });
    return node;
  }

  private admit(node: Node, peer: string): boolean {
    if (!this.running || !this.nodes.includes(node) || !peer || peer === this.self || this.directPeers.has(peer)) return false;
    const current = this.routes.get(peer);
    if (this.connected.has(peer)) return current === node;
    if (current && current !== node) { this.routes.delete(peer); current.transport.releasePeer(peer); }
    this.desired.add(peer);
    this.routes.set(peer, node);
    this.armDeadline(peer, node);
    this.markTried(peer, node);
    return true;
  }

  private async ensureNode(node: Node): Promise<boolean> {
    if (!this.running || this.policyBlocked || !this.nodes.includes(node)) return false;
    if (node.status === 'connected') return true;
    if (node.pending) return node.pending;
    node.pending = (async () => {
      node.abort = new AbortController();
      node.status = 'connecting';
      node.error = '';
      this.refreshStatus();
      try {
        const result = await this.probe(node.endpoint.url, node.abort.signal);
        if (!this.running || !this.nodes.includes(node) || node.abort.signal.aborted) return false;
        node.registryId = result.registryId;
        // Foreground/configuration/maintenance may probe aliases concurrently.
        // Serialize only registration to the SAME registry, not independent
        // home/server nodes. Never evict an existing authenticated session.
        const register = async () => {
          if (!this.running || this.policyBlocked || !this.nodes.includes(node) || node.abort?.signal.aborted) return false;
          const alias = result.registryId && this.nodes.find((other) => other !== node &&
            other.status === 'connected' && other.registryId === result.registryId);
          if (alias) { node.alias = true; node.status = 'idle'; node.error = ''; return false; }
          node.alias = false;
          try { await node.transport.init(this.self, this.identity); }
          catch (error) {
            // Set policy state before releasing the per-registry gate, so a
            // waiting alias cannot race a rejected proof on another listener.
            if (error instanceof Error && ['signaling_registration_rejected','signaling_protocol_outdated','invalid_registration_challenge'].includes(error.message)) this.policyBlocked = true;
            throw error;
          }
          return this.running && this.nodes.includes(node) && node.transport.getStatus() === 'connected';
        };
        return await this.atRegistry(result.registryId, register);
      } catch (error) {
        node.status = 'offline';
        node.error = error instanceof Error ? error.message : 'node_unreachable';
        if (['signaling_registration_rejected', 'signaling_protocol_outdated', 'invalid_registration_challenge'].includes(node.error)) {
          this.policyBlocked = true;
          node.status = 'error';
        }
        return false;
      } finally { node.abort = undefined; this.refreshStatus(); }
    })().finally(() => { node.pending = undefined; });
    return node.pending;
  }

  private atRegistry(id: string | undefined, work: () => Promise<boolean>): Promise<boolean> {
    // Renewal and first registration share the gate. Otherwise a foreground
    // renewal can temporarily look offline to configuration/maintenance and
    // cause a second registration on this listener or one of its LAN aliases.
    const previous = id ? this.registrations.get(id) : undefined;
    const attempt = (previous ?? Promise.resolve(false)).catch(() => false).then(work);
    if (id) this.registrations.set(id, attempt);
    return attempt.finally(() => {
      if (id && this.registrations.get(id) === attempt) this.registrations.delete(id);
    });
  }

  private renewNode(node: Node): Promise<boolean> {
    if (node.pending) return node.pending;
    const pending = this.atRegistry(node.registryId, async () => {
      if (!this.running || this.policyBlocked || !this.nodes.includes(node) || node.status !== 'connected') return false;
      await node.transport.resume?.();
      return this.running && this.nodes.includes(node) && node.transport.getStatus() === 'connected';
    });
    node.pending = pending.finally(() => { node.pending = undefined; this.refreshStatus(); });
    return node.pending;
  }

  private async warmNodes(stopAfterFirst = false): Promise<void> {
    for (const node of this.nodes) {
      if (!this.running || this.policyBlocked) return;
      const ready = await this.ensureNode(node);
      if (stopAfterFirst && ready) return;
    }
  }
  private async warmLan(): Promise<void> {
    for (const node of this.nodes) if (node.endpoint.kind === 'lan' || this.receiveUrls.has(node.endpoint.url)) await this.ensureNode(node);
  }

  // A foreground transition renews signed registrations, not E2EE channels.
  // Coalesce visibility/pageshow/online bursts; a closed account cannot restart.
  resume(): Promise<void> {
    if (!this.running || this.policyBlocked) return Promise.resolve();
    if (this.resuming) return this.resuming;
    this.resuming = (async () => {
      // Offline listeners must go through ensureNode's alias/registration gate.
      // An already connected listener can renew its own socket in place.
      await Promise.all(this.nodes.filter(n => n.status === 'connected' && !n.alias).map(n => this.renewNode(n).catch(() => false)));
      if (this.running) await this.maintain();
    })().finally(() => { this.resuming = null; });
    return this.resuming;
  }

  private async maintain(): Promise<void> {
    if (!this.running || this.policyBlocked) return;
    await this.warmLan();
    if (this.quick) await this.warmNodes();
    else if (!this.nodes.some((node) => node.status === 'connected')) await this.warmNodes(true);
    else if (!this.connected.size && !this.routes.size && !this.trying.size) {
      const preferred = this.nodes[0];
      if (preferred && preferred.status !== 'connected' && await this.ensureNode(preferred)) {
        for (const node of this.nodes) if (node.endpoint.kind !== 'lan' && !this.receiveUrls.has(node.endpoint.url) && node !== preferred && node.status === 'connected') {
          await node.transport.disconnect();
          node.status = 'idle';
        }
      }
    }
    if (!this.quick && this.nodes[0]?.status === 'connected' && !this.trying.size) {
      for (const node of this.nodes.slice(1)) if (node.endpoint.kind !== 'lan' && !this.receiveUrls.has(node.endpoint.url) && node.status === 'connected' && ![...this.routes.values()].includes(node)) {
        await node.transport.disconnect();
        node.status = 'idle';
      }
    }
    if (!this.quick) await this.warmLan();
    this.refreshStatus();
  }

  connect(peer: Peer): Promise<void> {
    if (!this.running || !peer.address || peer.address === this.self) return Promise.reject(new Error('invalid_peer_address'));
    this.desired.add(peer.address);
    if (this.direct.hasPeer(peer.address) || this.direct.hasPendingPeer(peer.address)) return Promise.resolve();
    if (!this.nodes.length) return Promise.reject(new Error('direct_pairing_required'));
    if (this.routes.has(peer.address)) return Promise.resolve();
    const existing = this.trying.get(peer.address);
    if (existing) return existing;
    const pending = this.attemptPeer(peer.address).finally(() => {
      if (this.trying.get(peer.address) === pending) this.trying.delete(peer.address);
    });
    this.trying.set(peer.address, pending);
    return pending;
  }

  private async attemptPeer(peer: string): Promise<void> {
    const attempted = this.tried.get(peer) ?? new Set<string>();
    for (const node of this.nodes) {
      if (!this.running || this.directPeers.has(peer) || this.routes.has(peer)) return;
      if (attempted.has(node.endpoint.url)) continue;
      this.markTried(peer, node);
      if (!await this.ensureNode(node)) continue;
      if (!this.running || this.directPeers.has(peer) || this.routes.has(peer)) return;
      this.routes.set(peer, node);
      this.armDeadline(peer, node);
      try { await node.transport.connect(this.peer(peer)); return; }
      catch { this.dropRoute(peer, node); }
    }
    this.queueRetry(peer);
  }

  private markTried(peer: string, node: Node): void {
    const tried = this.tried.get(peer) ?? new Set<string>();
    tried.add(node.endpoint.url);
    this.tried.set(peer, tried);
  }
  private routeFailed(peer: string, node: Node): void {
    if (!this.running || this.routes.get(peer) !== node) return;
    this.dropRoute(peer, node);
    this.queueRetry(peer, true);
  }
  private dropRoute(peer: string, node: Node): void {
    if (this.routes.get(peer) !== node) return;
    this.routes.delete(peer);
    this.cancelDeadline(peer);
    node.transport.releasePeer(peer);
    if (this.connected.delete(peer)) for (const handler of this.peers) handler(this.peer(peer), 'left');
    this.refreshStatus();
  }
  private queueRetry(peer: string, immediate = false): void {
    if (!this.running || !this.nodes.length || this.directPeers.has(peer) || !this.desired.has(peer) || this.retry.has(peer)) return;
    const exhausted = this.nodes.every((node) => this.tried.get(peer)?.has(node.endpoint.url));
    const count = this.retryCount.get(peer) ?? 0;
    const delay = immediate && !exhausted ? 0 : Math.min(30_000, 2_000 * 1.5 ** count);
    if (exhausted) this.retryCount.set(peer, Math.min(count + 1, 10));
    this.retry.set(peer, setTimeout(() => {
      this.retry.delete(peer);
      if (exhausted) this.tried.delete(peer);
      if (this.running && !this.routes.has(peer)) void this.connect(this.peer(peer)).catch(() => {});
    }, delay));
  }
  private cancelRetry(peer: string): void { const timer = this.retry.get(peer); if (timer) clearTimeout(timer); this.retry.delete(peer); }
  private armDeadline(peer: string, node: Node): void {
    this.cancelDeadline(peer);
    this.deadlines.set(peer, setTimeout(() => {
      this.deadlines.delete(peer);
      if (this.running && !this.connected.has(peer)) this.routeFailed(peer, node);
    }, 20_000));
  }
  private cancelDeadline(peer: string): void { const timer = this.deadlines.get(peer); if (timer) clearTimeout(timer); this.deadlines.delete(peer); }
  private peer(address: string): Peer { return { address, transport: 'webrtc', lastSeen: Date.now() }; }

  async send(message: TransportMessage): Promise<void> {
    if (this.directPeers.has(message.to)) { await this.direct.send(message); return; }
    const route = this.routes.get(message.to);
    if (!route || !this.connected.has(message.to)) throw new Error('peer_unreachable');
    // No automatic retry of ciphertext on another E2EE session. The existing
    // plaintext outbox retries with the same message ID after a fresh handshake.
    await route.transport.send(message);
  }

  async disconnect(): Promise<void> {
    this.running = false;
    if (this.maintenance) clearInterval(this.maintenance);
    this.maintenance = null;
    for (const peer of this.retry.keys()) this.cancelRetry(peer);
    for (const peer of this.deadlines.keys()) this.cancelDeadline(peer);
    for (const node of this.nodes) node.abort?.abort();
    await Promise.all(this.nodes.map((node) => node.transport.disconnect()));
    await this.direct.disconnect(); this.directPeers.clear();
    this.routes.clear(); this.connected.clear(); this.desired.clear(); this.tried.clear(); this.trying.clear(); this.retryCount.clear();
    this.identity = undefined; this.self = ''; this.status = 'idle';
    for (const handler of this.statuses) handler('idle');
    for (const handler of this.changes) handler();
  }

  private refreshStatus(): void {
    const next: TransportStatus = !this.running ? 'idle' : this.policyBlocked ? 'error' : this.nodes.some((node) => node.status === 'connected') ? 'connected' :
      this.nodes.some((node) => node.status === 'connecting') ? 'connecting' : 'offline';
    if (next !== this.status) { this.status = next; for (const handler of this.statuses) handler(next); }
    for (const handler of this.changes) handler();
  }
}
