import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { WebCryptoIdentity } from '../identity/webcrypto';
import { accountIdFromPublicKey } from '../addressing/account-id.js';
import { createDeviceRequest, deviceComparisonCode } from './enrollment';
import { openBrowserOwnerDevices } from './owner-browser';
import { createDeviceDelivery } from './delivery';
import type { CoreRecordStore, SealedCoreRecord } from '../core/durable-state';
import type { CoreEnvironment } from '../core/ports';
import type { SignedObject } from '../core/objects';

type Delivery = ReturnType<typeof createDeviceDelivery>;
let env: CoreEnvironment, now: number, factory: IDBFactory;
let directory: Map<string, SignedObject>, endpoints: Map<string, Delivery>, offline: Set<string>, owners: WebCryptoIdentity[], engines: Delivery[];
let loseAck: boolean;
beforeEach(() => {
  now = 1800000000000; env = { subtle: crypto.subtle, now: () => now, newId: () => crypto.randomUUID() };
  factory = new IDBFactory(); directory = new Map(); endpoints = new Map(); offline = new Set(); owners = []; engines = []; loseAck = false;
  vi.stubGlobal('localStorage', { getItem: () => null });
});
afterEach(() => { for (const engine of engines) engine.close(); for (const signer of owners) signer.dispose(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function account(label: string) {
  const root = crypto.getRandomValues(new Uint8Array(32)), signer = new WebCryptoIdentity(); await signer.fromSeed(root); owners.push(signer);
  const owner = await accountIdFromPublicKey(await signer.getPublicKeyBytes());
  const store = await openBrowserOwnerDevices({ root, owner, signer, trusted: true, factory, isCurrent: () => true, environment: env }); root.fill(0);
  await store.setPrimaryEnabled(true, true);
  const device = await createDeviceRequest(label, env);
  const cert = await store.approve(device.request, { approved: true, comparisonCode: await deviceComparisonCode(owner, device.request, env) });
  device.close(); directory.set(owner, await store.publish());
  return { owner, store, device: cert.record.audience[0], cert };
}
async function endpoint(owner: string, device: string) {
  const saved = new Map<string, SealedCoreRecord>();
  const records: CoreRecordStore = { async read(scope) { const row = saved.get(scope); return row && structuredClone(row); },
    async compareAndSwap(scope, rev, next) { if ((saved.get(scope)?.revision ?? null) !== rev) return false; saved.set(scope, structuredClone(next)); return true; } };
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const opts = { owner, device, key, records, environment: env, guard: () => {},
    policy: async (id: string) => { const roster = directory.get(id); if (!roster) throw new Error('policy_offline'); return roster; },
    sendEncrypted: async (target: string, text: string) => {
      if (offline.has(target) || !endpoints.has(target)) throw new Error('offline');
      if (loseAck && JSON.parse(text).kind === 'ack') throw new Error('lost_ack');
      await endpoints.get(target)!.receive(device, text);
    } };
  let engine = createDeviceDelivery(opts); endpoints.set(device, engine); engines.push(engine);
  return { get engine() { return engine; }, saved, records, opts,
    reopen() { engine.close(); engine = createDeviceDelivery(opts); endpoints.set(device, engine); engines.push(engine); return engine; } };
}
async function network() {
  const a = await account('Alice laptop'), b = await account('Bob phone');
  const source = await endpoint(a.owner, a.owner), mirror = await endpoint(a.owner, a.device);
  const primary = await endpoint(b.owner, b.owner), secondary = await endpoint(b.owner, b.device);
  return { a, b, source, mirror, primary, secondary };
}
describe('per-device delivery / dedup / durable acknowledgements', () => {
  it('extends an own-copy job with independently authorized peer devices without duplicate targets', async () => {
    const n = await network();
    try {
      const id = await n.source.engine.sync(n.b.owner, 'Two independent copies');
      await n.source.engine.send(n.b.owner, 'Two independent copies', id);
      await n.source.engine.send(n.b.owner, 'Two independent copies', id);
      const row = (await n.source.engine.inspect()).outbox[0];
      expect(row.targets).toHaveLength(3); expect(new Set(row.targets.map(target => target.kind + target.device)).size).toBe(3);
      await n.source.engine.flush(); expect((await n.secondary.engine.inspect()).inbox).toHaveLength(1);
    } finally { n.a.store.close(); n.b.store.close(); }
  });
  it('compacts only committed/acknowledged journals beyond 128 messages', async () => {
    const n = await network();
    try {
      for (let index = 0; index < 130; index++) { await n.source.engine.send(n.b.owner, `History ${index}`); await n.source.engine.flush(); }
      expect((await n.source.engine.inspect()).outbox).toHaveLength(128);
      const inbox = (await n.secondary.engine.inspect()).inbox;
      expect(inbox).toHaveLength(128); expect(inbox.at(-1)?.event.text).toBe('History 129');
    } finally { n.a.store.close(); n.b.store.close(); }
  }, 45000);
  it('mirrors an ordinary primary chat without requiring the foreign owner online or delivering to it', async () => {
    const n = await network(); const foreign = directory.get(n.b.owner); directory.delete(n.b.owner);
    try {
      const id = await n.source.engine.sync(n.b.owner,'Ordinary root chat'); await n.source.engine.flush();
      expect((await n.mirror.engine.inspect()).inbox[0]).toMatchObject({kind:'sync',event:{id,to:n.b.owner}});
      expect((await n.primary.engine.inspect()).inbox).toHaveLength(0);
      expect((await n.secondary.engine.inspect()).inbox).toHaveLength(0);
      await expect(n.mirror.engine.sync(n.b.owner,'Cannot bypass linked rights')).rejects.toThrow();
      await n.source.engine.sync(n.b.owner,'Ordinary root chat',id);
      expect((await n.source.engine.inspect()).outbox).toHaveLength(1);
    } finally { if(foreign)directory.set(n.b.owner,foreign);n.a.store.close();n.b.store.close(); }
  });
  it('rejects forged physical senders and changed content, and ACKs only the specific receiving device', async () => {
    const n = await network(), captured: Array<{ to: string; packet: string }> = [];
    const send = vi.spyOn(n.source.opts, 'sendEncrypted').mockImplementation(async (to, packet) => { captured.push({ to, packet }); });
    try {
      const id = await n.source.engine.send(n.b.owner, 'Authenticated devices only'); await n.source.engine.flush();
      const wire = captured.find(frame => frame.to === n.b.device)!.packet;
      await expect(n.secondary.engine.receive(n.b.owner, wire)).rejects.toThrow();
      const changed = JSON.parse(wire); changed.event.text = 'Changed content';
      await expect(n.secondary.engine.receive(n.a.owner, JSON.stringify(changed))).rejects.toThrow();
      const outbox = (await n.source.engine.inspect()).outbox[0];
      const ack = { protocol: 'automesh-multidevice-prototype-v1', kind: 'ack', toDevice: n.a.owner,
        from: n.b.owner, fromDevice: n.b.device, id, digest: outbox.digest };
      await expect(n.source.engine.receive(n.b.owner, JSON.stringify(ack))).rejects.toThrow();
      ack.fromDevice = n.b.owner; await n.source.engine.receive(n.b.owner, JSON.stringify(ack));
      const targets = (await n.source.engine.inspect()).outbox[0].targets;
      expect(targets.find(t => t.device === n.b.owner)!.status).toBe('received');
      expect(targets.find(t => t.device === n.b.device)!.status).toBe('pending');
      expect((await n.secondary.engine.inspect()).inbox).toHaveLength(0);
    } finally { send.mockRestore(); n.a.store.close(); n.b.store.close(); }
  });
  it('fans out to both recipient devices and syncs outgoing history to own second device', async () => {
    const n = await network();
    try {
      const id = await n.source.engine.send(n.b.owner, 'Private multi-device text');
      expect((await n.source.engine.inspect()).outbox[0].targets.every(t => t.status === 'pending')).toBe(true);
      await n.source.engine.flush();
      for (const receiver of [n.primary, n.secondary]) expect((await receiver.engine.inspect()).inbox[0]).toMatchObject({ kind: 'message', event: { id, text: 'Private multi-device text' } });
      expect((await n.mirror.engine.inspect()).inbox[0]).toMatchObject({ kind: 'sync', event: { id, to: n.b.owner } });
      expect((await n.source.engine.inspect()).outbox[0].targets.every(t => t.status === 'received')).toBe(true);
      for (const record of n.source.saved.values()) expect(new TextDecoder().decode(record.cipher)).not.toContain('Private multi-device text');
    } finally { n.a.store.close(); n.b.store.close(); }
  });
  it('does not let one offline device block the rest; survives restart and retries just pending targets', async () => {
    const n = await network();
    try {
      offline.add(n.b.device); const id = await n.source.engine.send(n.b.owner, 'Later device'); await n.source.engine.flush();
      let targets = (await n.source.engine.inspect()).outbox[0].targets;
      expect(targets.filter(t => t.status === 'received')).toHaveLength(2); expect(targets.filter(t => t.status === 'pending')).toHaveLength(1);
      n.source.reopen(); offline.delete(n.b.device); await n.source.engine.flush();
      targets = (await n.source.engine.inspect()).outbox[0].targets; expect(targets.every(t => t.status === 'received')).toBe(true);
      expect((await n.secondary.engine.inspect()).inbox[0].event.id).toBe(id); expect((await n.primary.engine.inspect()).inbox).toHaveLength(1);
      now += 1000; await n.source.engine.send(n.b.owner, 'Later device', id);
      expect((await n.source.engine.inspect()).outbox).toHaveLength(1);
      await expect(n.source.engine.send(n.b.owner, 'Changed message', id)).rejects.toThrow('conflict');
    } finally { n.a.store.close(); n.b.store.close(); }
  });
  it('resends after a lost ACK, without duplicate history; does not claim delivery before durable commit', async () => {
    const n = await network();
    try {
      loseAck = true; await n.source.engine.send(n.b.owner, 'Retry safely'); await n.source.engine.flush();
      expect((await n.source.engine.inspect()).outbox[0].targets.every(t => t.status === 'pending')).toBe(true);
      expect((await n.secondary.engine.inspect()).inbox).toHaveLength(1);
      loseAck = false; n.secondary.reopen(); await n.source.engine.flush();
      expect((await n.secondary.engine.inspect()).inbox).toHaveLength(1);
      expect((await n.source.engine.inspect()).outbox[0].targets.every(t => t.status === 'received')).toBe(true);
    } finally { n.a.store.close(); n.b.store.close(); }
  });
  it('does not ACK if the receive transaction fails; retry after storage recovery works', async () => {
    const n = await network();
    try {
      const write = vi.spyOn(n.secondary.records, 'compareAndSwap').mockRejectedValue(new Error('quota'));
      await n.source.engine.send(n.b.owner, 'Disk recovery'); await n.source.engine.flush();
      expect((await n.source.engine.inspect()).outbox[0].targets.find(t => t.device === n.b.device)!.status).toBe('pending');
      expect((await n.secondary.engine.inspect()).inbox).toHaveLength(0); write.mockRestore(); await n.source.engine.flush();
      expect((await n.secondary.engine.inspect()).inbox).toHaveLength(1);
    } finally { n.a.store.close(); n.b.store.close(); }
  });
  it('stops queued deliveries to a revoked device and refuses delivery by an already revoked sender', async () => {
    const n = await network();
    try {
      offline.add(n.b.device); await n.source.engine.send(n.b.owner, 'Do not deliver after revocation'); await n.source.engine.flush();
      await n.b.store.revoke(n.b.cert.record.id, true); directory.set(n.b.owner, await n.b.store.publish());
      offline.delete(n.b.device); await n.source.engine.flush();
      expect((await n.source.engine.inspect()).outbox[0].targets.find(t => t.device === n.b.device)!.status).toBe('revoked');
      expect((await n.secondary.engine.inspect()).inbox).toHaveLength(0);
      await expect(n.secondary.engine.send(n.a.owner, 'Revoked sender')).rejects.toThrow('denied');
    } finally { n.a.store.close(); n.b.store.close(); }
  });
  it('fails closed on stale or rolled-back membership instead of silently using an old permission', async () => {
    const n = await network();
    try {
      await n.source.engine.send(n.b.owner, 'Bounded policy'); const old = directory.get(n.b.owner)!;
      await n.b.store.revoke(n.b.cert.record.id, true); directory.set(n.b.owner, await n.b.store.publish()); await n.source.engine.flush();
      directory.set(n.b.owner, old); await expect(n.source.engine.send(n.b.owner, 'Rollback')).rejects.toThrow();
      now += 6 * 60000; await expect(n.source.engine.send(n.b.owner, 'Expired roster')).rejects.toThrow();
    } finally { n.a.store.close(); n.b.store.close(); }
  });
});
