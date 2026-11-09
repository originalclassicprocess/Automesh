// Opt-in logical-account fan-out over authenticated ENCRYPTED device channels.
// Never wire sendEncrypted/receive to raw signaling or an unauthenticated node.
import { canonicalJson } from '../core/canonical';
import { UUID_PATTERN } from '../core/objects';
import { checkedTime, type CoreEnvironment } from '../core/ports';
import { validateSealedCoreRecord, type CoreRecordStore, type SealedCoreRecord } from '../core/durable-state';
import { isValidAccountId } from '../addressing/bech32m.js';
import { verifyMembership, activeMembers, memberDevice, type MembershipAnchor, type MembershipBody } from './membership';
import type { SignedObject } from '../core/objects';
import { verifyDirectoryReply } from './directory-client';
import { verifyOwnerPolicy } from './owner-policy';

export const DEVICE_DELIVERY_PROTOCOL = 'automesh-multidevice-prototype-v1';
const MAX_ITEMS = 128, MAX_JOURNAL = 1024 * 1024, MAX_TEXT = 4096;
export type DeviceEvent = { id: string; from: string; to: string; authorDevice: string; timestamp: number; text: string };
type Target = { owner: string; device: string; kind: 'message' | 'sync'; status: 'pending' | 'received' | 'revoked' };
type Outgoing = { event: DeviceEvent; digest: string; targets: Target[] };
type Incoming = { event: DeviceEvent; digest: string; kind: 'message' | 'sync'; projected?: true };
type State = { schema: 1; lastNow: number; anchors: MembershipAnchor[]; outbox: Outgoing[]; inbox: Incoming[]; policies?: SignedObject[] };
type Packet = { protocol: typeof DEVICE_DELIVERY_PROTOCOL; kind: 'message' | 'sync'; toDevice: string; event: DeviceEvent; digest: string } |
  { protocol: typeof DEVICE_DELIVERY_PROTOCOL; kind: 'ack'; toDevice: string; from: string; fromDevice: string; id: string; digest: string };
const encoder = new TextEncoder(), hex = (bytes: Uint8Array) => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
const denied = (): never => { throw new Error('device_delivery_denied'); };
const exact = (value: object, keys: string[]) => Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
function validateEvent(value: DeviceEvent) {
  if (!value || !exact(value, ['id', 'from', 'to', 'authorDevice', 'timestamp', 'text']) || !UUID_PATTERN.test(value.id) ||
    !isValidAccountId(value.from) || !isValidAccountId(value.to) || !isValidAccountId(value.authorDevice) ||
    !Number.isSafeInteger(value.timestamp) || value.timestamp < 0 || typeof value.text !== 'string' ||
    !value.text || encoder.encode(value.text).length > MAX_TEXT) denied();
}
function validateState(state: State) {
  if (!state || !exact(state, ['schema', 'lastNow', 'anchors', 'outbox', 'inbox', ...(state.policies ? ['policies'] : [])]) || state.schema !== 1 ||
    !Number.isSafeInteger(state.lastNow) || state.lastNow < 0 || !Array.isArray(state.anchors) || state.anchors.length > 64 ||
    !Array.isArray(state.outbox) || !Array.isArray(state.inbox) || state.outbox.length > MAX_ITEMS || state.inbox.length > MAX_ITEMS ||
    (state.policies !== undefined && (!Array.isArray(state.policies) || state.policies.length > 64))) denied();
  for (const item of state.inbox) { validateEvent(item.event); if (!/^[a-f0-9]{64}$/.test(item.digest) || !['message', 'sync'].includes(item.kind) || item.projected !== undefined && item.projected !== true) denied(); }
  for (const item of state.outbox) {
    validateEvent(item.event);
    if (!/^[a-f0-9]{64}$/.test(item.digest) || !Array.isArray(item.targets) || item.targets.length > 34) denied();
    for (const t of item.targets) if (!isValidAccountId(t.owner) || !isValidAccountId(t.device) || !['message', 'sync'].includes(t.kind) ||
      !['pending', 'received', 'revoked'].includes(t.status)) denied();
  }
}
export function createDeviceDelivery(options: { owner: string; device: string; key: CryptoKey; records: CoreRecordStore;
  environment: CoreEnvironment; guard(): void;
  // Must fetch a fresh signed roster for this EXACT pinned logical account.
  policy(owner: string, nonce: string): Promise<unknown>;
  allowCachedPolicy?(): boolean;
  policyStatus?(status: 'fresh' | 'cached' | 'waiting'): void;
  policyAccepted?(roster: SignedObject): void;
  attemptTarget?(owner: string, kind: 'message' | 'sync', id: string, target: string): boolean;
  commit?(event: DeviceEvent, kind: 'message' | 'sync'): Promise<void>;
  sendEncrypted(device: string, packet: string): Promise<void> }) {
  const { owner, device, records } = options, env = { ...options.environment };
  let key: CryptoKey | null = options.key, flushing = false;
  if (!isValidAccountId(owner) || !isValidAccountId(device) || key.type !== 'secret' || key.extractable || key.algorithm.name !== 'AES-GCM' ||
    (key.algorithm as AesKeyAlgorithm).length !== 256 || !key.usages.includes('encrypt') || !key.usages.includes('decrypt')) denied();
  const guard = () => { if (!key) throw new Error('device_delivery_closed'); options.guard(); };
  const aad = (revision: number) => encoder.encode(JSON.stringify(['Automesh device delivery journal prototype v1', owner, device, revision]));
  async function load() {
    guard(); const saved = await records.read(device); guard();
    if (!saved) return { revision: null, state: { schema: 1, lastNow: 0, anchors: [], outbox: [], inbox: [], policies: [] } as State };
    validateSealedCoreRecord(saved); if (saved.cipher.byteLength > MAX_JOURNAL + 16) denied();
    const plain = new Uint8Array(await env.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(saved.iv), additionalData: aad(saved.revision) },
      key!, saved.cipher.slice(0)));
    try { guard(); const state: State = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain)); validateState(state); return { revision: saved.revision, state }; }
    finally { plain.fill(0); }
  }
  async function change<T>(work: (state: State, now: number) => Promise<T>) {
    for (let retry = 0; retry < 16; retry++) {
      const { state, revision } = await load(), now = Math.max(state.lastNow, checkedTime(env.now));
      state.lastNow = now; const result = await work(state, now); guard(); validateState(state);
      const plain = encoder.encode(JSON.stringify(state)); if (plain.length > MAX_JOURNAL) { plain.fill(0); throw new Error('device_delivery_capacity'); }
      const nextRevision = (revision ?? 0) + 1;
      if (!Number.isSafeInteger(nextRevision)) denied();
      const iv = crypto.getRandomValues(new Uint8Array(12)); let next: SealedCoreRecord;
      try { next = { schema: 1, revision: nextRevision, iv, cipher: await env.subtle.encrypt({ name: 'AES-GCM', iv,
        additionalData: aad(nextRevision) }, key!, plain) }; } finally { plain.fill(0); }
      guard(); if (await records.compareAndSwap(device, revision, next)) { guard(); return result; }
    }
    throw new Error('device_delivery_contention');
  }
  async function digest(event: DeviceEvent) { return hex(new Uint8Array(await env.subtle.digest('SHA-256', encoder.encode(canonicalJson(event))))); }
  async function policy(account: string, state: State, now: number) {
    const anchor = state.anchors.find(a => a.owner === account) ?? { owner: account, sequence: 0, digest: null, revoked: [] };
    const nonce = hex(crypto.getRandomValues(new Uint8Array(32))), clock = { ...env, now: () => Math.max(now, checkedTime(env.now)) };
    let candidate: unknown, cached = false;
    try { candidate = await options.policy(account, nonce); }
    catch (error) {
      if (options.allowCachedPolicy?.() !== true) { options.policyStatus?.('waiting'); throw error; }
      candidate = state.policies?.find(p => p.record.author === account); cached = true;
      if (!candidate) { options.policyStatus?.('waiting'); throw error; }
    }
    const wrapper = candidate as { roster?: SignedObject; checkpoint?: unknown };
    const verified = wrapper?.roster && Object.hasOwn(wrapper, 'ownerProof') ? await verifyOwnerPolicy(candidate, account, device, nonce, anchor, clock) : wrapper?.roster ? await verifyDirectoryReply(candidate, account, nonce, anchor, clock)
      : await verifyMembership(candidate, anchor, clock);
    if (verified.body.directory && !wrapper?.roster && !cached) throw new Error('device_checkpoint_required');
    guard(); options.policyAccepted?.(verified.roster); options.policyStatus?.(cached ? 'cached' : 'fresh');
    const policies = state.policies ??= [], index = policies.findIndex(p => p.record.author === account);
    if (index >= 0) policies[index] = verified.roster;
    else { if (policies.length >= 64) throw new Error('device_policy_capacity'); policies.push(verified.roster); }
    const position = state.anchors.findIndex(a => a.owner === account);
    if (position < 0) { if (state.anchors.length >= 64) throw new Error('device_policy_capacity'); state.anchors.push(verified.anchor); }
    else state.anchors[position] = verified.anchor;
    return verified.body;
  }
  const endpoints = (account: string, body: MembershipBody, now: number) => [...(body.primary ? [account] : []), ...activeMembers(body, now).map(memberDevice)];
  async function permitted(account: string, endpoint: string, state: State, now: number) {
    return endpoints(account, await policy(account, state, now), now).includes(endpoint);
  }
  function makeRoom(state: State, collection: 'inbox' | 'outbox') {
    const items = state[collection];
    if (items.length < MAX_ITEMS) return;
    const index = collection === 'inbox'
      ? state.inbox.findIndex(item => item.projected === true)
      : state.outbox.findIndex(item => item.targets.every(target => target.status !== 'pending'));
    if (index < 0) throw new Error('device_delivery_capacity');
    items.splice(index, 1);
  }
  async function projectEntry(item: Incoming) {
    if (item.projected) return;
    await options.commit?.(item.event, item.kind); guard();
    await change(async state => {
      const saved = state.inbox.find(value => value.event.from === item.event.from && value.event.id === item.event.id);
      if (saved && saved.digest === item.digest) saved.projected = true;
    });
  }
  async function flush() {
    guard(); if (flushing) return; flushing = true;
    try {
      const snapshot = (await load()).state.outbox;
      for (const outgoing of snapshot) for (const target of outgoing.targets.filter(t => t.status === 'pending')) {
        if (options.attemptTarget?.(target.owner,target.kind,outgoing.event.id,target.device) === false) continue;
        // Network I/O is outside CAS callbacks: contention must never repeat it.
        let allowed = false;
        try { allowed = await change(async (state, now) => {
          if (!await permitted(owner, device, state, now)) denied();
          const allowed = await permitted(target.owner, target.device, state, now);
          const saved = state.outbox.find(o => o.event.id === outgoing.event.id && o.event.from === outgoing.event.from);
          const current = saved?.targets.find(t => t.device === target.device && t.kind === target.kind);
          if (!current || current.status !== 'pending') return false;
          if (!allowed) current.status = 'revoked'; return allowed;
        }); } catch { guard(); continue; } // Unavailable/stale policy: keep queued, never send.
        if (!allowed) continue;
        const packet: Packet = { protocol: DEVICE_DELIVERY_PROTOCOL, kind: target.kind, toDevice: target.device, event: outgoing.event, digest: outgoing.digest };
        try { guard(); await options.sendEncrypted(target.device, canonicalJson(packet)); guard(); }
        catch { guard(); /* One failed/offline target must not block the others. ACK controls status. */ }
      }
    } finally { flushing = false; }
  }
  return Object.freeze({
    async send(to: string, text: string, id = env.newId(), timestamp = checkedTime(env.now)) {
      const event: DeviceEvent = { id, from: owner, to, authorDevice: device, timestamp, text }; validateEvent(event);
      const hash = await digest(event); guard();
      await change(async (state, now) => {
        const old = state.outbox.find(o => o.event.id === id);
        if (old) {
          if (old.event.to !== to || old.event.text !== text || old.event.authorDevice !== device) throw new Error('device_message_conflict');
        }
        const own = await policy(owner, state, now), recipient = to === owner ? own : await policy(to, state, now);
        if (!endpoints(owner, own, now).includes(device)) denied();
        const targets: Target[] = endpoints(to, recipient, now).filter(d => d !== device).map(d => ({ owner: to, device: d, kind: 'message', status: 'pending' }));
        if (to !== owner) for (const d of endpoints(owner, own, now).filter(d => d !== device)) targets.push({ owner, device: d, kind: 'sync', status: 'pending' });
        const attempted = targets.filter(target => options.attemptTarget?.(target.owner, target.kind, id, target.device) !== false);
        if (!attempted.length) { if (old) return; throw new Error('device_no_recipients'); }
        if (old) {
          for (const target of attempted) if (!old.targets.some(value => value.device === target.device && value.kind === target.kind && value.owner === target.owner)) old.targets.push(target);
        } else { makeRoom(state, 'outbox'); state.outbox.push({ event, digest: hash, targets: attempted }); }
      });
      return id; // Saved to local outbox, NOT a delivered receipt. Call flush().
    },
    flush,
    // Copy a primary's ordinary chat to its own devices, not to the recipient.
    // This never grants foreign-account rights. Linked devices cannot use it.
    async sync(to: string, text: string, id = env.newId(), timestamp = checkedTime(env.now)) {
      if (device !== owner || to === owner) denied();
      const event: DeviceEvent = { id, from: owner, to, authorDevice: device, timestamp, text }; validateEvent(event);
      const hash = await digest(event); guard();
      await change(async (state, now) => {
        const old = state.outbox.find(o => o.event.id === id);
        if (old) { if (old.event.to !== to || old.event.text !== text || old.event.authorDevice !== device) throw new Error('device_message_conflict'); return; }
        const own = await policy(owner, state, now); if (!endpoints(owner, own, now).includes(device)) denied();
        const targets: Target[] = endpoints(owner, own, now).filter(d => d !== device).map(d => ({ owner, device: d, kind: 'sync', status: 'pending' }));
        if (!targets.length) return;
        makeRoom(state, 'outbox');
        state.outbox.push({ event, digest: hash, targets });
      });
      return id;
    },
    async receive(authenticatedPhysicalPeer: string, value: string) {
      guard(); if (!isValidAccountId(authenticatedPhysicalPeer) || typeof value !== 'string' || encoder.encode(value).length > 16384) denied();
      const packet = JSON.parse(value) as Packet; canonicalJson(packet);
      if (!packet || packet.protocol !== DEVICE_DELIVERY_PROTOCOL || packet.toDevice !== device) denied();
      if (packet.kind === 'ack') {
        if (!exact(packet, ['protocol', 'kind', 'toDevice', 'from', 'fromDevice', 'id', 'digest']) || packet.fromDevice !== authenticatedPhysicalPeer ||
          !UUID_PATTERN.test(packet.id) || !/^[a-f0-9]{64}$/.test(packet.digest)) denied();
        await change(async (state, now) => {
          if (!await permitted(owner, device, state, now) || !await permitted(packet.from, authenticatedPhysicalPeer, state, now)) denied();
          const saved = state.outbox.find(o => o.event.id === packet.id && o.digest === packet.digest);
          const target = saved?.targets.find(t => t.device === authenticatedPhysicalPeer && t.owner === packet.from);
          if (!target || target.status === 'revoked') return denied(); target.status = 'received';
        }); return;
      }
      if (!['message', 'sync'].includes(packet.kind) || !exact(packet, ['protocol', 'kind', 'toDevice', 'event', 'digest'])) denied();
      const event = packet.event; validateEvent(event);
      if (event.authorDevice !== authenticatedPhysicalPeer || event.timestamp > checkedTime(env.now) + 300000 || await digest(event) !== packet.digest) denied();
      await change(async (state, now) => {
        if (!await permitted(owner, device, state, now) || !await permitted(event.from, authenticatedPhysicalPeer, state, now)) denied();
        if (packet.kind === 'message' ? event.to !== owner : event.from !== owner || event.to === owner) denied();
        const old = state.inbox.find(i => i.event.id === event.id && i.event.from === event.from);
        if (old) { if (old.digest !== packet.digest || old.kind !== packet.kind) throw new Error('device_message_conflict'); return; }
        makeRoom(state, 'inbox');
        state.inbox.push({ event, digest: packet.digest, kind: packet.kind });
      });
      // Only after durable history+dedup commit. Lost ACK is safe: retry returns
      // another ACK without a second history item. No read-receipt is implied.
      const ack: Packet = { protocol: DEVICE_DELIVERY_PROTOCOL, kind: 'ack', toDevice: authenticatedPhysicalPeer,
        from: owner, fromDevice: device, id: event.id, digest: packet.digest };
      // The visible application history is a separate store. Do not ACK until
      // its idempotent projection is committed too; restart replays the inbox.
      const saved = (await load()).state.inbox.find(item => item.event.from === event.from && item.event.id === event.id);
      if (!saved) throw new Error('device_delivery_denied');
      await projectEntry(saved); guard();
      guard(); await options.sendEncrypted(authenticatedPhysicalPeer, canonicalJson(ack)); guard();
    },
    async refresh(account = owner) { return change(async (state, now) => policy(account, state, now)); },
    async project() { for (const item of (await load()).state.inbox) await projectEntry(item); },
    async inspect() { const state = (await load()).state; return { outbox: state.outbox, inbox: state.inbox, policies: state.policies ?? [] }; },
    close() { key = null; }
  });
}
