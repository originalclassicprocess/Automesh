import type { IdentityProvider } from '../identity/identity';
import type { ChatService } from '../chat/ChatService';
import type { SignedObject } from '../core/objects';
import { webCryptoEnvironment } from '../core/ports';
import { canonicalJson } from '../core/canonical';
import { requireNodeNetwork } from '../node/client';
import { createDirectoryClient } from './directory-client';
import { createDeviceDelivery, type DeviceEvent } from './delivery';
import { deviceRecords } from './journal';
import { createDeviceNodeMail } from './node-mail';
import { verifyMembership, activeMembers, memberDevice, type DirectoryAuthority, type MembershipBody } from './membership';
import type { OwnerDeviceStore } from './owner-store';
import { normalizeDeviceSettings, type DeviceSettings } from './settings';
import { createDeviceInvitation, type PairingChannel } from './links';
import { openDirectDeviceRuntime } from './direct-runtime';
import { createLiveOwnerPolicy } from './owner-policy';
import { requiresDeviceDelivery, requirePolicyProgress } from './delivery-plan';
import type { DeviceCopyJob } from './replication';

export type DeviceRuntime = Awaited<ReturnType<typeof openDeviceRuntime>> | Awaited<ReturnType<typeof openDirectDeviceRuntime>>;
export type DeviceRuntimeOptions = { owner: string; device: string; identity: IdentityProvider; key: CryptoKey;
  authority: DirectoryAuthority; settings(): DeviceSettings; save(settings: DeviceSettings): Promise<void>;
  store?: OwnerDeviceStore; chat?: ChatService; guard(): void; lanOnly?(): boolean;
  onlinePeers?(): string[];
  contacts(): string[]; allowed(owner: string): boolean;
  queued?(): Array<{ to: string; text: string; id: string }>;
  commit(event: DeviceEvent, kind: 'message' | 'sync'): Promise<void>;
  delivery?(to: string, id: string, status: 'stored' | 'delivered'): void;
  status?(status: 'fresh' | 'cached' | 'waiting', reason?: string): void;
  authorityChanged?(authority: DirectoryAuthority): void;
  primaryRouted?(peer: string, id: string): boolean;
  copies?(): DeviceCopyJob[];
  copied?(job: DeviceCopyJob): Promise<void>;
};
export async function openDeviceRuntime(options: DeviceRuntimeOptions) {
  let closed = false, timer: ReturnType<typeof setTimeout> | undefined, currentCycle: Promise<void> | null = null;
  const incoming = new Set<Promise<void>>(); let offControl = () => {}, offPeers = () => {};
  const environment = webCryptoEnvironment(), policies = new Map<string, SignedObject>(), ready = new Set<string>(), granted = new Set<string>(), projected = new Set<string>();
  let settings = normalizeDeviceSettings(options.settings()), dirty = false;
  const guard = () => { if (closed) throw new Error('device_runtime_closed'); options.guard(); };
  const known = (owner: string) => owner === options.owner || options.allowed(owner);
  const ownerPolicy = options.chat ? createLiveOwnerPolicy({ owner: options.owner, device: options.device, signer: options.identity, chat: options.chat, store: options.store, guard, allowed: known }) : null;
  const authorities = () => Object.fromEntries([options.owner, ...options.contacts(), ...policies.keys()].map(owner => [owner,
    (policies.get(owner)?.record.body as unknown as MembershipBody)?.directory ?? options.authority]));
  const directory = createDirectoryClient({ device: options.device, identity: options.identity, guard, authorities });
  const request = (authority: DirectoryAuthority, path: string, body: unknown) => {
    guard(); requireNodeNetwork(authority.url, options.lanOnly?.() === true); return directory.request(authority, path, body);
  };
  const deliveryRecords = deviceRecords('delivery', guard), mailRecords = deviceRecords('mail', guard);
  const remember = (roster: SignedObject) => {
    const owner = roster.record.author;
    if (!known(owner)) throw new Error('device_contact_not_accepted');
    const prior = policies.get(owner), body = roster.record.body as unknown as MembershipBody;
    requirePolicyProgress(prior,roster);
    if (prior) {
      const old = prior.record.body as unknown as MembershipBody;
      if (body.sequence < old.sequence || body.sequence === old.sequence && canonicalJson({ record: prior.record, publicKey: prior.publicKey }) !== canonicalJson({ record: roster.record, publicKey: roster.publicKey }) ||
        old.devices.filter(m => m.revokedAt !== null).some(m => !body.devices.some(n => n.certificate.record.id === m.certificate.record.id && n.revokedAt !== null))) throw new Error('device_membership_rollback');
    }
    if (canonicalJson(policies.get(owner) ?? null) !== canonicalJson(roster)) { policies.set(owner, roster); dirty = true; }
  };
  const ownerForDevice = (device: string) => [...policies].find(([owner, roster]) => device === owner ||
    (roster.record.body as unknown as MembershipBody).devices.some(m => memberDevice(m) === device))?.[0];
  async function acceptPolicy(peer: string, owner: string, value: unknown) {
    if (!known(owner)) throw new Error('device_contact_not_accepted');
    const candidate = value as SignedObject, issued = candidate?.record?.createdAt;
    if (!Number.isSafeInteger(issued) || issued > Date.now()) throw new Error('device_roster_sender');
    // This is a signed routing hint carried by an older queued envelope, NOT
    // fresh authorization. Delivery still asks the pinned authority with a new
    // nonce. An old hint must not replace a newer remembered list/revocation.
    const historical = { ...environment, now: () => issued };
    const hint = await verifyMembership(candidate, { owner, sequence: 0, digest: null, revoked: [] }, historical); guard();
    if (peer !== owner && !activeMembers(hint.body, issued).some(m => memberDevice(m) === peer)) throw new Error('device_roster_sender');
    const old = policies.get(owner);
    const prior = old ? await verifyMembership(old, { owner, sequence: 0, digest: null, revoked: [] }, { ...environment, now: () => old.record.createdAt }) : null;
    if (prior && hint.body.sequence < prior.body.sequence) return;
    const verified = await verifyMembership(candidate, prior?.anchor ?? { owner, sequence: 0, digest: null, revoked: [] }, historical); guard();
    remember(verified.roster);
  }
  let mail!: ReturnType<typeof createDeviceNodeMail>;
  const commit = async (event: DeviceEvent, kind: 'message' | 'sync') => {
    const id = `${event.from}:${event.id}:${kind}`;
    if (projected.has(id)) return;
    await options.commit(event, kind); guard(); projected.add(id);
  };
  const engine = createDeviceDelivery({ owner: options.owner, device: options.device, key: options.key, records: deliveryRecords, environment, guard,
    attemptTarget: (owner,kind,id,target) => !(options.store && kind === 'message' && owner !== options.owner &&
      (target === owner && options.primaryRouted?.(owner,id) || policies.has(owner) && !requiresDeviceDelivery(policies.get(owner)))),
    policy: (owner, nonce) => {
      if (!known(owner)) throw new Error('device_contact_not_accepted');
      return request(authorities()[owner] ?? options.authority, '/devices/policy', { owner, nonce }).catch(error => {
        if (!ownerPolicy) throw error;
        return ownerPolicy.policy(owner, nonce);
      });
    }, allowCachedPolicy: () => options.settings().allowCached === true, policyStatus: value => options.status?.(value), policyAccepted: remember,
    commit,
    async sendEncrypted(target, packet) {
      if (mail.receivingAck(target, packet)) return mail.sendEncrypted(target, packet);
      if (options.chat && ready.has(target)) {
        try { await options.chat.sendDeviceControl('packet', packet, target); guard(); return; } catch { guard(); }
      } else if (options.chat) void options.chat.connect(target).catch(() => {});
      await mail.sendEncrypted(target, packet); guard();
    } });
  mail = createDeviceNodeMail({ owner: options.owner, device: options.device, identity: options.identity, key: options.key, records: mailRecords, guard,
    authority: () => options.authority, policy: owner => policies.get(owner), ownerForDevice, acceptPolicy, request,
    receive: (peer, packet) => engine.receive(peer, packet),
    stored: (id, target) => { const owner = ownerForDevice(target); if (owner && owner !== options.owner) options.delivery?.(owner, id, 'stored'); },
    error: () => options.status?.('waiting', 'receive') });
  async function save() {
    if (!dirty) return;
    settings = { ...options.settings(), authority: options.authority, peers: [...policies.values()] };
    await options.save(settings); guard(); dirty = false;
  }
  async function publish() {
    guard(); if (!options.store) throw new Error('device_owner_required');
    const roster = await options.store.publish(); guard();
    const result = await request(options.authority, '/devices/publish', { roster }) as { published?: boolean; sequence?: number };
    if (result.published !== true || result.sequence !== (roster.record.body as unknown as MembershipBody).sequence) throw new Error('device_publish_unconfirmed');
    remember(roster); await save();
    if (options.chat) for (const peer of ready) if (known(peer)) void options.chat.sendDeviceControl('roster', roster, peer).catch(() => {});
    return roster;
  }
  async function project() {
    await engine.project(); guard();
    const state = await engine.inspect(); guard();
    for (const outgoing of state.outbox) if (outgoing.targets.some(t => t.kind === 'message' && t.status === 'received')) options.delivery?.(outgoing.event.to, outgoing.event.id, 'delivered');
  }
  async function cycle() {
    guard(); await currentAccess(); guard();
    for (const peer of options.onlinePeers?.() ?? []) if (!ready.has(peer)) {
      ready.add(peer);
      const roster = policies.get(options.owner);
      if (roster && known(peer)) void options.chat?.sendDeviceControl('roster', roster, peer).catch(() => {});
    }
    for (const peer of options.contacts()) if (!granted.has(peer)) {
      await request(options.authority, '/devices/grant', { owner: options.owner, sender: peer, revoke: false }); guard(); granted.add(peer);
    }
    for (const item of options.queued?.() ?? []) {
      if (!known(item.to)) continue;
      try { await engine.send(item.to, item.text, item.id); } catch { guard(); options.status?.('waiting', 'send'); }
    }
    for (const item of options.copies?.() ?? []) {
      try {
        if (item.kind === 'own' && !item.incoming) await engine.sync(item.peer, item.text, item.id, item.timestamp);
        else await engine.send(item.incoming ? options.owner : item.peer, item.text, item.id, item.incoming ? Date.now() : item.timestamp);
        guard(); await options.copied?.(item);
      } catch { guard(); options.status?.('waiting', 'copy'); }
    }
    await mail.poll(); await engine.flush(); await project(); await save(); guard();
  }
  async function wake() {
    guard(); if (currentCycle) return currentCycle;
    currentCycle = cycle().finally(() => { currentCycle = null; }); return currentCycle;
  }
  async function currentAccess() {
    const body = await engine.refresh(); guard();
    if (!(options.device === options.owner && body.primary) && !activeMembers(body, Date.now()).some(m => memberDevice(m) === options.device)) throw new Error('device_access_revoked');
  }
  const stop = () => {
    if (closed) return Promise.resolve();
    closed = true; clearTimeout(timer); offControl(); offPeers(); ownerPolicy?.close(); directory.close(); engine.close(); options.store?.close();
    return Promise.allSettled([currentCycle, mail.stop(), ...incoming]).then(() => { deliveryRecords.close(); mailRecords.close(); });
  };
  try {
    for (const candidate of settings.peers) {
      if (!known(candidate.record.author)) continue;
      const verified = await verifyMembership(candidate, { owner: candidate.record.author, sequence: 0, digest: null, revoked: [] },
        { ...environment, now: () => candidate.record.createdAt }); guard(); remember(verified.roster);
    }
    if (options.store) {
      // Recover public owner control metadata after restoring a backup, never
      // import device private keys or trust an unsigned claimed sequence.
      try {
        const response = await request(options.authority, '/devices/policy', { owner: options.owner, nonce: '0'.repeat(64) }) as { roster: SignedObject };
        await options.store.adoptPublished(response.roster); guard();
      } catch { guard(); }
      await options.store.bindDirectory(options.authority, true); await options.store.setPrimaryEnabled(true, true); await publish();
    }
    await currentAccess(); await project(); await save();
    offControl = options.chat?.onDeviceControl(async (peer, kind, value) => {
      if (closed) return; guard();
      if (kind !== 'packet' && kind !== 'roster') return;
      if (kind === 'packet') {
        if (typeof value !== 'string' || incoming.size >= 16) throw new Error('device_packet_invalid');
        const task = engine.receive(peer, value).then(project).then(save).catch(() => { if (!closed) options.status?.('waiting', 'receive'); });
        incoming.add(task); void task.finally(() => incoming.delete(task)); return;
      }
      const roster = value as SignedObject, owner = roster?.record?.author;
      if (!known(owner)) return;
      await acceptPolicy(peer, owner, roster); await save();
    }) ?? (() => {});
    offPeers = options.chat?.onPeerChange((peer, event) => {
      if (closed) return;
      if (event === 'left') { ready.delete(peer.address); return; }
      ready.add(peer.address);
      const roster = policies.get(options.owner);
      if (roster && known(peer.address)) void options.chat!.sendDeviceControl('roster', roster, peer.address).catch(() => {});
    }) ?? (() => {});
  } catch (error) { await stop(); throw error; }
  return Object.freeze({ mode: 'node' as const, store: options.store, publish, wake, stop,
    async mirror(to: string, text: string, id: string, timestamp: number) {
      guard(); if (!options.store || !(policies.get(options.owner)?.record.body as unknown as MembershipBody)?.devices.length) return;
      await engine.sync(to, text, id, timestamp); await engine.flush(); await save();
    },
    async invitation(nickname = '', pairing?: PairingChannel) {
      guard(); if (!options.store || options.owner !== options.device) throw new Error('device_owner_required');
      await currentAccess(); guard(); return createDeviceInvitation(options.authority, nickname, options.identity, environment, pairing);
    },
    async canSend(to: string) {
      guard(); if (!known(to)) return false;
      if (options.store && policies.has(to) && !requiresDeviceDelivery(policies.get(to))) return false;
      const knownPolicy = policies.has(to);
      try { await engine.refresh(to); await save(); return !options.store || requiresDeviceDelivery(policies.get(to)); }
      catch (error) { guard(); if (knownPolicy) throw error; return false; }
    },
    async send(to: string, text: string, id: string) { guard(); await engine.send(to, text, id); await engine.flush(); await project(); await save(); },
    start() {
      const tick = async () => { if (closed) return; try { await wake(); } catch { if (!closed) options.status?.('waiting', 'connection'); }
        if (!closed) timer = setTimeout(tick, 10000); }; void tick();
    }
  });
}
export { openDirectDeviceRuntime };
