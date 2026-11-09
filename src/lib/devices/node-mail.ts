import type { IdentityProvider } from '../identity/identity';
import type { SignedObject } from '../core/objects';
import type { CoreRecordStore } from '../core/durable-state';
import type { DirectoryAuthority } from './membership';
import { encryptedDeviceJournal } from './journal';
import { newDevicePrekey, openDeviceMail, sealDeviceMail, signDevice, type DeviceMail, type DevicePrekey, type DevicePrekeys, type DeviceSigned } from './node-mail-crypto';
import { cipherDigest, unbase64, base64 } from '../node/offline-crypto';
import { canonicalJson } from '../core/canonical';
import { verifyDeviceTransport, DEVICE_DIRECTORY, DEVICE_MAIL_TTL } from '../../../nodes/packages/protocol/src/devices.js';
type Pending = { target: string; targetOwner: string; eventId: string; kind: string; packet: string; mail: DeviceSigned<DeviceMail>; uploaded: boolean; received: boolean };
type Receipt = { id: string; expiresAt: number; signed: DeviceSigned<any>; confirmed: boolean };
type State = { schema: 2; keys: DevicePrekey[]; bundles: DeviceSigned<DevicePrekeys>[]; pending: Pending[]; receipts: Receipt[] };
export function createDeviceNodeMail(options: { owner: string; device: string; identity: IdentityProvider; key: CryptoKey; records: CoreRecordStore;
  authority(): DirectoryAuthority; policy(owner: string): SignedObject | undefined; guard(): void;
  ownerForDevice?(device: string): string | undefined;
  acceptPolicy?(physicalPeer: string, owner: string, roster: unknown): Promise<void>;
  request(authority: DirectoryAuthority, path: string, body: unknown): Promise<unknown>;
  receive(physicalPeer: string, packet: string): Promise<void>;
  stored?(eventId: string, targetDevice: string): void; error?(): void }) {
  let active = true, chain: Promise<unknown> = Promise.resolve(), timer: ReturnType<typeof setTimeout> | undefined;
  let receiving: { envelope: any; mail: DeviceSigned<DeviceMail>; acknowledged: boolean } | null = null;
  const published = new Set<string>();
  const guard = () => { if (!active) throw new Error('device_mail_closed'); options.guard(); };
  const journal = encryptedDeviceJournal<State>({ scope: options.device, purpose: 'offline-mail', key: options.key, records: options.records,
    initial: () => ({ schema: 2, keys: [], bundles: [], pending: [], receipts: [] }), guard,
    validate(state) {
      if (state?.schema !== 2 || !Array.isArray(state.keys) || state.keys.length > 512 || !Array.isArray(state.bundles) || state.bundles.length > 16 ||
        !Array.isArray(state.pending) || state.pending.length > 128 || !Array.isArray(state.receipts) || state.receipts.length > 256) throw new Error('device_mail_state');
    } });
  const serial = <T>(work: () => Promise<T>) => { const next = chain.then(async () => { guard(); return work(); }); chain = next.catch(() => {}); return next; };
  async function ensureKeys() {
    const authority = options.authority(), now = Date.now(); let state = await journal.read();
    if (state.keys.filter(k => k.expiresAt > now + 3600000).length < 8) {
      if (state.keys.length + 16 > 512) throw new Error('device_keys_capacity');
      const keys: DevicePrekey[] = [];
      for (let i = 0; i < 16; i++) { keys.push(await newDevicePrekey(now + DEVICE_MAIL_TTL)); guard(); }
      const bundle = await signDevice('prekeys', { protocol: DEVICE_DIRECTORY, owner: options.owner, device: options.device,
        nodeId: authority.nodeId, expiresAt: now + DEVICE_MAIL_TTL, keys: keys.map(({ id, publicKey }) => ({ id, publicKey })) }, options.identity); guard();
      await journal.change(saved => { saved.keys.push(...keys); saved.bundles.push(bundle); });
      state = await journal.read();
    }
    for (const bundle of state.bundles) {
      const id = bundle.body.keys[0].id;
      if (published.has(id)) continue;
      await options.request(authority, '/devices/keys', { owner: options.owner, bundle }); guard(); published.add(id);
    }
  }
  async function acknowledge(packet: string) {
    if (!receiving) throw new Error('device_receipt_context');
    const { envelope, mail } = receiving, authority = options.authority();
    const receipt = await signDevice('receipt', { nodeId: authority.nodeId, device: options.device, sender: mail.body.from,
      id: mail.body.id, digest: await cipherDigest(envelope.ciphertext), ack: packet }, options.identity); guard();
    await journal.change(saved => {
      if (!saved.receipts.some(r => r.id === mail.body.id)) {
        // A confirmed outer ACK is already durable at the node: its mailbox
        // retains the tombstone/receipt and cannot list this envelope again.
        // Never evict an ACK that the node has not yet confirmed.
        if (saved.receipts.length >= 256) {
          const oldest = saved.receipts.findIndex(value => value.confirmed);
          if (oldest < 0) throw new Error('device_receipts_capacity');
          saved.receipts.splice(oldest, 1);
        }
        saved.receipts.push({ id: mail.body.id, expiresAt: mail.body.expiresAt, signed: receipt, confirmed: false });
      }
      // History/dedup was already committed by delivery.receive. The durable
      // receipt now replaces the consumed private key before any remote ACK.
      saved.keys = saved.keys.filter(k => k.id !== mail.body.keyId);
    });
    if (receiving) receiving.acknowledged = true;
    await options.request(authority, '/devices/ack', { owner: options.owner, receipt }); guard();
    await journal.change(saved => { const item = saved.receipts.find(r => r.id === mail.body.id); if (item) item.confirmed = true; });
  }
  async function put(target: string, text: string) {
    const packet = JSON.parse(text), eventId = packet.kind === 'ack' ? packet.id : packet.event?.id;
    const targetOwner = packet.kind === 'sync' ? options.owner : packet.kind === 'ack'
      ? options.ownerForDevice?.(target) ?? [...(await journal.read()).pending].find(p => p.target === target)?.targetOwner : packet.event?.to;
    if (!targetOwner) throw new Error('device_target_unknown');
    const recipient = options.policy(targetOwner), senderPolicy = options.policy(options.owner);
    const authority = (recipient?.record.body as any)?.directory as DirectoryAuthority | undefined;
    if (!authority || !senderPolicy) throw new Error('device_policy_unavailable');
    let pending = (await journal.read()).pending.find(p => p.target === target && p.eventId === eventId && p.kind === packet.kind);
    if (pending && pending.packet !== text) throw new Error('device_mail_conflict');
    if (!pending) {
      const allocated = await options.request(authority, '/devices/allocate', { owner: targetOwner, device: target, senderOwner: options.owner, senderPolicy, eventId }) as any; guard();
      const bundle = await verifyDeviceTransport(allocated.bundle, 'prekeys', target) as DeviceSigned<DevicePrekeys>;
      if (bundle.body.protocol !== DEVICE_DIRECTORY || bundle.body.owner !== targetOwner || bundle.body.device !== target || bundle.body.nodeId !== authority.nodeId ||
        !Number.isSafeInteger(bundle.body.expiresAt) || bundle.body.expiresAt <= Date.now() || bundle.body.expiresAt > Date.now() + DEVICE_MAIL_TTL ||
        !Array.isArray(bundle.body.keys) || !bundle.body.keys.length || bundle.body.keys.length > 32 ||
        !/^[a-f0-9]{32}$/.test(allocated.key?.id) || !/^04[a-f0-9]{128}$/.test(allocated.key?.publicKey) ||
        !bundle.body.keys.some(k => k.id === allocated.key?.id && k.publicKey === allocated.key?.publicKey) || !/^[a-f0-9]{32}$/.test(allocated.allocation)) throw new Error('device_prekeys_invalid');
      const content = JSON.stringify({ protocol: 'automesh-device-mail-content-v2', packet: text, senderPolicy });
      const mail = await sealDeviceMail({ nodeId: authority.nodeId, from: options.device, fromOwner: options.owner, toOwner: targetOwner,
        toDevice: target, id: allocated.allocation, eventId, keyId: allocated.key.id, expiresAt: bundle.body.expiresAt }, allocated.key.publicKey, content, options.identity); guard();
      pending = { target, targetOwner, eventId, kind: packet.kind, packet: text, mail, uploaded: false, received: false };
      const item = pending;
      await journal.change(saved => {
        // A verified receipt already advanced the delivery journal. Keep the
        // limit for unresolved mail, not for a week's completed conversations.
        saved.pending = saved.pending.filter(value => !value.received);
        if (saved.pending.length >= 128) throw new Error('device_mail_capacity'); saved.pending.push(item);
      });
    }
    if (pending.received) return;
    const result = await options.request(authority, '/devices/put', { mail: pending.mail }) as any; guard();
    if (!['stored', 'acknowledged'].includes(result.status)) throw new Error('device_mail_not_stored');
    const id = pending.mail.body.id;
    await journal.change(saved => { const item = saved.pending.find(p => p.mail.body.id === id); if (item) item.uploaded = true; });
    options.stored?.(eventId, target);
  }
  async function poll() {
    guard(); const now = Date.now(), authority = options.authority();
    await journal.change(saved => { saved.keys = saved.keys.filter(k => k.expiresAt > now);
      saved.bundles = saved.bundles.filter(b => b.body.expiresAt > now && b.body.keys.some(key => saved.keys.some(value => value.id === key.id)));
      saved.pending = saved.pending.filter(p => !p.received && p.mail.body.expiresAt > now); saved.receipts = saved.receipts.filter(r => r.expiresAt > now); });
    await ensureKeys();
    for (const pending of (await journal.read()).pending.filter(p => !p.uploaded)) {
      try { await put(pending.target, pending.packet); } catch { guard(); options.error?.(); }
    }
    for (const receipt of (await journal.read()).receipts.filter(r => !r.confirmed)) {
      await options.request(authority, '/devices/ack', { owner: options.owner, receipt: receipt.signed }); guard();
      await journal.change(saved => { const item = saved.receipts.find(r => r.id === receipt.id); if (item) item.confirmed = true; });
    }
    const response = await options.request(authority, '/devices/list', { owner: options.owner }) as any; guard();
    if (!Array.isArray(response.envelopes) || response.envelopes.length > 10) throw new Error('device_mail_list');
    for (const envelope of response.envelopes) {
      try {
        const state = await journal.read();
        const receipt = state.receipts.find(r => r.id === envelope.id);
        if (receipt) { await options.request(authority, '/devices/ack', { owner: options.owner, receipt: receipt.signed }); continue; }
        if (typeof envelope.ciphertext !== 'string' || envelope.ciphertext.length > 128 * 1024) throw new Error('device_mail_size');
        const raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(unbase64(envelope.ciphertext))) as DeviceSigned<DeviceMail>;
        const key = state.keys.find(k => k.id === raw.body?.keyId); if (!key) throw new Error('device_prekey_missing');
        const opened = await openDeviceMail(raw, key, options.owner, options.device, authority.nodeId); guard();
        if (opened.signed.body.id !== envelope.id || opened.signed.body.from !== envelope.sender || opened.signed.body.expiresAt !== envelope.expiresAt) throw new Error('device_mail_binding');
        const content = JSON.parse(opened.packet);
        if (content?.protocol !== 'automesh-device-mail-content-v2' || typeof content.packet !== 'string' || Object.keys(content).length !== 3) throw new Error('device_mail_content');
        const packet = JSON.parse(content.packet), binding = opened.signed.body;
        if ((packet.kind === 'ack' ? packet.from !== binding.fromOwner || packet.id !== binding.eventId :
          packet.event?.from !== binding.fromOwner || packet.event?.id !== binding.eventId)) throw new Error('device_mail_binding');
        await options.acceptPolicy?.(binding.from, binding.fromOwner, content.senderPolicy); guard();
        receiving = { envelope, mail: opened.signed, acknowledged: false };
        await options.receive(opened.signed.body.from, content.packet); guard();
        // An overlay ACK itself has no ACK. Persist an outer receipt without
        // inventing another overlay packet, otherwise ACKs loop indefinitely.
        if (receiving && !receiving.acknowledged && packet.kind === 'ack') await acknowledge('');
      } catch { guard(); options.error?.(); }
      finally { receiving = null; }
    }
    for (const pending of (await journal.read()).pending.filter(p => p.uploaded && !p.received).slice(0, 20)) {
      const policy = options.policy(pending.targetOwner), targetAuthority = (policy?.record.body as any)?.directory as DirectoryAuthority;
      if (!targetAuthority) continue;
      const response = await options.request(targetAuthority, '/devices/receipts', { owner: pending.targetOwner, device: pending.target, ids: [pending.mail.body.id] }) as any; guard();
      if (!Array.isArray(response.receipts) || response.receipts.length > 1) throw new Error('device_receipts_invalid');
      for (const row of response.receipts) {
        const receipt = await verifyDeviceTransport(JSON.parse(row.receipt), 'receipt', pending.target);
        const expected = base64(new TextEncoder().encode(canonicalJson(pending.mail)));
        if (receipt.body.id !== pending.mail.body.id || receipt.body.nodeId !== targetAuthority.nodeId || receipt.body.device !== pending.target ||
          receipt.body.sender !== options.device || receipt.body.digest !== await cipherDigest(expected)) throw new Error('device_receipt_invalid');
        if (pending.kind === 'ack' ? receipt.body.ack !== '' : typeof receipt.body.ack !== 'string' || !receipt.body.ack) throw new Error('device_receipt_invalid');
        if (receipt.body.ack) await options.receive(pending.target, receipt.body.ack); guard();
        await journal.change(saved => { const item = saved.pending.find(p => p.mail.body.id === pending.mail.body.id); if (item) item.received = true; });
      }
    }
  }
  return Object.freeze({
    receivingAck(target: string, text: string) { const packet = JSON.parse(text); return !!receiving && packet.kind === 'ack' && target === receiving.mail.body.from && packet.id === receiving.mail.body.eventId; },
    sendEncrypted(target: string, text: string) {
      const packet = JSON.parse(text);
      if (receiving && packet.kind === 'ack' && target === receiving.mail.body.from && packet.id === receiving.mail.body.eventId) return acknowledge(text);
      return serial(() => put(target, text));
    }, poll: () => serial(poll),
    start() {
      const tick = async () => { if (!active) return; try { await serial(poll); } catch { if (active) options.error?.(); }
        if (active) timer = setTimeout(tick, 10000); }; void tick();
    },
    async stop() { active = false; clearTimeout(timer); await chain; journal.close(); },
    inspect: journal.read
  });
}
