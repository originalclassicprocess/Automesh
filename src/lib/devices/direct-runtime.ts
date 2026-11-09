import type { DeviceRuntimeOptions } from './runtime';
import type { SignedObject } from '../core/objects';
import { webCryptoEnvironment } from '../core/ports';
import { createDeviceDelivery } from './delivery';
import { deviceRecords } from './journal';
import { activeMembers, memberDevice, verifyMembership, type MembershipBody } from './membership';
import { createLiveOwnerPolicy } from './owner-policy';
import { createDeviceInvitation, type PairingChannel } from './links';
import { requiresDeviceDelivery, requirePolicyProgress } from './delivery-plan';

export async function openDirectDeviceRuntime(options: Omit<DeviceRuntimeOptions, 'authority'>) {
  if (!options.chat) throw new Error('device_direct_transport_required');
  let closed = false, timer: ReturnType<typeof setTimeout> | undefined, cycling: Promise<void> | null = null;
  const incoming = new Set<Promise<void>>(); let offControl = () => {}, offPeers = () => {};
  const environment = webCryptoEnvironment(), policies = new Map<string, SignedObject>();
  const guard = () => { if (closed) throw new Error('device_runtime_closed'); options.guard(); };
  const known = (owner: string) => owner === options.owner || options.allowed(owner);
  const live = createLiveOwnerPolicy({ owner: options.owner, device: options.device, signer: options.identity, chat: options.chat, store: options.store, guard, allowed: known });
  const records = deviceRecords('delivery', guard);
  const accepted = (roster: SignedObject, fresh = false) => {
    requirePolicyProgress(policies.get(roster.record.author), roster);
    policies.set(roster.record.author, roster);
    const directory = (roster.record.body as unknown as MembershipBody).directory;
    if (fresh && roster.record.author === options.owner && directory && !options.settings().authority) options.authorityChanged?.(directory);
  };
  const engine = createDeviceDelivery({ owner: options.owner, device: options.device, key: options.key, records, environment, guard,
    attemptTarget: (owner,kind,id,target) => !(options.store && kind === 'message' && owner !== options.owner &&
      (target === owner && options.primaryRouted?.(owner,id) || policies.has(owner) && !requiresDeviceDelivery(policies.get(owner)))),
    policy: live.policy, policyAccepted: roster => accepted(roster, true), policyStatus: value => options.status?.(value, 'direct'),
    // No cached authorization fallback in direct mode. Revocation is checked
    // by a fresh, nonce-bound owner response before traffic, even if a node pin
    // is retained for a later authenticated upgrade.
    commit: options.commit,
    sendEncrypted: async (device, packet) => { guard(); await options.chat!.connectAndWait(device); guard(); await options.chat!.sendDeviceControl('packet', packet, device); guard(); }
  });
  async function publish() {
    guard(); if (!options.store) throw new Error('device_owner_required');
    const roster = await options.store.publish(); guard(); accepted(roster);
    for (const peer of options.onlinePeers?.() ?? []) if (known(peer)) void options.chat!.sendDeviceControl('roster', roster, peer).catch(() => {});
    return roster;
  }
  async function save() { await options.save({ ...options.settings(), peers: [...policies.values()] }); guard(); }
  async function project() {
    await engine.project(); guard();
    const state = await engine.inspect(); guard();
    for (const item of state.outbox) if (item.targets.some(t => t.kind === 'message' && t.status === 'received')) options.delivery?.(item.event.to, item.event.id, 'delivered');
  }
  async function access() {
    const body = await engine.refresh(); guard();
    if (!(options.owner === options.device && body.primary) && !activeMembers(body, Date.now()).some(m => memberDevice(m) === options.device)) throw new Error('device_access_revoked');
    await save();
  }
  async function wake() {
    guard(); if (cycling) return cycling;
    cycling = (async () => {
      await access();
      for (const item of options.queued?.() ?? []) { if (!known(item.to)) continue; try { await engine.send(item.to, item.text, item.id); } catch { guard(); } }
      for (const item of options.copies?.() ?? []) {
        try {
          if (item.kind === 'own' && !item.incoming) await engine.sync(item.peer, item.text, item.id, item.timestamp);
          else await engine.send(item.incoming ? options.owner : item.peer, item.text, item.id, item.incoming ? Date.now() : item.timestamp);
          guard(); await options.copied?.(item);
        } catch { guard(); options.status?.('waiting', 'copy'); }
      }
      await engine.flush(); await project(); await save();
    })().finally(() => cycling = null); return cycling;
  }
  const stop = async () => { if (closed) return; closed = true; clearTimeout(timer); offControl(); offPeers(); live.close(); engine.close(); options.store?.close(); await Promise.allSettled([cycling, ...incoming]); records.close(); };
  try {
    for (const roster of options.settings().peers) {
      if (!known(roster.record.author)) continue;
      await verifyMembership(roster, { owner: roster.record.author, sequence: 0, digest: null, revoked: [] }, { ...environment, now: () => roster.record.createdAt }); accepted(roster);
    }
    if (options.store) { await options.store.setPrimaryEnabled(true, true); await publish(); }
    // Opening local history does not require an online owner. Sending/receiving
    // remains gated by access(), never by the mere presence of a certificate.
    await project(); guard();
    offPeers = options.chat.onPeerChange((peer, event) => {
      if (closed || event !== 'joined' || !options.store || !known(peer.address)) return;
      void publish().then(roster => options.chat!.sendDeviceControl('roster', roster, peer.address)).catch(() => {});
    });
    offControl = options.chat.onDeviceControl((peer, kind, value) => {
      if (closed) return;
      if (kind === 'roster') {
        const roster = value as SignedObject;
        if (roster?.record?.author !== peer || !known(peer) || policies.size >= 50 && !policies.has(peer)) return;
        void verifyMembership(roster, { owner: peer, sequence: 0, digest: null, revoked: [] }, { ...environment, now: () => roster.record.createdAt })
          .then(() => { guard(); accepted(roster); return save(); }).catch(() => {}); return;
      }
      if (kind !== 'packet' || typeof value !== 'string' || incoming.size >= 16) return;
      // Do not block this peer's authenticated receive queue while waiting for
      // its policy reply; CAS still serializes/deduplicates durable commits.
      const task = engine.receive(peer, value).then(project).then(save).catch(() => { if (!closed) options.status?.('waiting', 'direct'); }); incoming.add(task); void task.finally(() => incoming.delete(task));
    });
  } catch (error) { await stop(); throw error; }
  return Object.freeze({ mode: 'direct' as const, store: options.store, publish, wake, stop,
    async mirror(to: string, text: string, id: string, timestamp: number) {
      guard(); if (!options.store || !(policies.get(options.owner)?.record.body as unknown as MembershipBody)?.devices.length) return;
      await engine.sync(to, text, id, timestamp); await engine.flush(); await save();
    },
    async invitation(nickname = '', pairing?: PairingChannel) { guard(); if (!options.store) throw new Error('device_owner_required'); return createDeviceInvitation(null, nickname, options.identity, environment, pairing); },
    async canSend(to: string) {
      guard(); if (!known(to)) return false;
      // Ordinary primary-to-legacy chats must not wait for a protocol the old
      // client cannot speak. A linked sender always needs explicit policy.
      if (options.store && !requiresDeviceDelivery(policies.get(to))) { void options.chat!.connect(to).catch(() => {}); return false; }
      await access(); await engine.refresh(to); return true;
    },
    async send(to: string, text: string, id: string) { guard(); await engine.send(to, text, id); await engine.flush(); await project(); await save(); },
    start() { const tick = async () => { if (closed) return; try { await wake(); } catch { if (!closed) options.status?.('waiting', 'direct'); } if (!closed) timer = setTimeout(tick, 10000); }; void tick(); }
  });
}
