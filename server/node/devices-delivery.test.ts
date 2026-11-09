import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebCryptoIdentity } from '../../src/lib/identity/webcrypto';
import { accountIdFromPublicKey } from '../../src/lib/addressing/account-id.js';
import { webCryptoEnvironment } from '../../src/lib/core/ports';
import { createOwnerDeviceStore } from '../../src/lib/devices/owner-store';
import { createDeviceRequest, deviceComparisonCode } from '../../src/lib/devices/enrollment';
import { createDeviceDelivery } from '../../src/lib/devices/delivery';
import { createDeviceNodeMail } from '../../src/lib/devices/node-mail';
import { verifyDirectoryReply } from '../../src/lib/devices/directory-client';
import { signCourier } from '../../src/lib/node/courier-crypto';
import { DeviceDirectory } from '../../nodes/packages/runtime/src/devices.js';
import { deviceCanonical } from '../../nodes/packages/protocol/src/devices.js';
import { canonicalJson } from '../../src/lib/core/canonical';
import type { CoreRecordStore, SealedCoreRecord } from '../../src/lib/core/durable-state';
import type { SignedObject } from '../../src/lib/core/objects';

const cleanups: Array<() => unknown> = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); vi.restoreAllMocks(); });
function records(): CoreRecordStore {
  const data = new Map<string, SealedCoreRecord>();
  return { read: async id => structuredClone(data.get(id)), compareAndSwap: async (id, revision, next) => {
    if ((data.get(id)?.revision ?? null) !== revision) return false; data.set(id, structuredClone(next)); return true;
  } };
}
const key = () => crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
async function fixture() {
  const environment = webCryptoEnvironment(), nodeSigner = new WebCryptoIdentity(); await nodeSigner.create(); cleanups.push(() => nodeSigner.dispose());
  const directory = await mkdtemp(join(tmpdir(), 'automesh-device-mail-')); cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const authority = { url: 'https://node.example', nodeId: 'a'.repeat(32), publicKey: Buffer.from(await nodeSigner.getPublicKeyBytes()).toString('hex') };
  const policies = new Map<string, SignedObject>();
  const nodeOptions = { ...authority, now: Date.now, maxBytes: 64 * 1024 * 1024, maxMessages: 1000, isOwner: (owner: string) => policies.has(owner),
    allowed: () => true, sign: (purpose: string, body: unknown) => signCourier(purpose, body, nodeSigner), availableBytes: () => 64 * 1024 * 1024 };
  let node = await new DeviceDirectory(directory, nodeOptions).initialize(), loseAck = false;
  async function account(label: string) {
    const signer = new WebCryptoIdentity(); await signer.create(); cleanups.push(() => signer.dispose());
    const owner = await accountIdFromPublicKey(await signer.getPublicKeyBytes());
    const store = createOwnerDeviceStore({ owner, signer, key: await key(), records: records(), environment, guard() {} }); cleanups.push(() => store.close());
    await store.bindDirectory(authority, true); await store.setPrimaryEnabled(true, true);
    const phone = await createDeviceRequest(label, environment); cleanups.push(() => phone.close());
    const certificate = await store.approve(phone.request, { approved: true, comparisonCode: await deviceComparisonCode(owner, phone.request, environment) });
    async function publish() { const roster = await store.publish(); policies.set(owner, roster); await node.handle('/devices/publish', { address: owner }, { roster }); return roster; }
    await publish(); return { owner, signer, store, phone, certificate, publish };
  }
  async function endpoint(owner: string, identity: WebCryptoIdentity | typeof a.phone.signer, device: string) {
    const storage = await key(), mailRecords = records(), deliveryRecords = records(), visible: string[] = [], errors: unknown[] = [];
    let engine: ReturnType<typeof createDeviceDelivery>, mail: ReturnType<typeof createDeviceNodeMail>, offlinePolicy = false, allowCached = false;
    const request = async (_: unknown, path: string, body: unknown) => {
      if (path === '/devices/policy' && offlinePolicy) throw new Error('network_offline');
      const result = await node.handle(path, { address: device }, body);
      if (path === '/devices/ack' && loseAck) { loseAck = false; throw new Error('lost_ack_response'); } return result;
    };
    const open = () => {
      engine = createDeviceDelivery({ owner, device, key: storage, records: deliveryRecords, environment, guard() {},
        policy: (owner, nonce) => request(authority, '/devices/policy', { owner, nonce }),
        allowCachedPolicy: () => allowCached,
        commit: async event => { if (!visible.includes(event.text)) visible.push(event.text); },
        sendEncrypted: (target, packet) => mail.sendEncrypted(target, packet) });
      mail = createDeviceNodeMail({ owner, device, identity, key: storage, records: mailRecords, authority: () => authority,
        policy: id => policies.get(id), ownerForDevice: target => [...policies].find(([id, roster]) => id === target || (roster.record.body as any).devices.some((m: any) => m.certificate.record.body.device === target))?.[0],
        guard() {}, request, receive: (peer, packet) => engine.receive(peer, packet), error: () => errors.push('mail') });
      cleanups.push(async () => { engine.close(); await mail.stop(); });
    };
    open();
    return { get engine() { return engine; }, get mail() { return mail; }, visible, errors,
      policyOffline(value: boolean) { offlinePolicy = value; }, allowCached(value: boolean) { allowCached = value; },
      async restart() { engine.close(); await mail.stop(); open(); }, async stop() { engine.close(); await mail.stop(); } };
  }
  const a = await account('Alice independent phone'), b = await account('Bob independent phone');
  return { a, b, endpoint, policies, authority, environment, directory, get node() { return node; },
    loseNextAck() { loseAck = true; },
    async restartNode() { node = await new DeviceDirectory(directory, nodeOptions).initialize(); } };
}
describe('real disk-backed encrypted per-device node delivery', () => {
  it('receives while sender AND first owner device are closed; preserves independent receipts through node/client restart', async () => {
    const f = await fixture(), sender = await f.endpoint(f.a.owner, f.a.signer, f.a.owner), recipient = await f.endpoint(f.b.owner, f.b.phone.signer, f.b.phone.request.record.author);
    await recipient.mail.poll(); await sender.mail.poll();
    await sender.engine.send(f.b.owner, 'Only the independent recipient comes online'); await sender.engine.flush();
    expect(recipient.visible).toEqual([]);
    await sender.stop(); f.b.signer.dispose(); // No owner signer can participate in receiving.
    await f.restartNode(); await recipient.restart(); await recipient.mail.poll();
    expect(recipient.visible).toEqual(['Only the independent recipient comes online']); expect(recipient.errors).toEqual([]);
    await recipient.mail.poll(); expect(recipient.visible).toHaveLength(1);
    await sender.restart(); await sender.mail.poll();
    const target = (await sender.engine.inspect()).outbox[0].targets.find(t => t.device === f.b.phone.request.record.author);
    expect(target?.status).toBe('received');
    for (const name of await readdir(join(f.directory, 'devices-v2'))) if (name.endsWith('.json')) {
      const text = await readFile(join(f.directory, 'devices-v2', name), 'utf8');
      expect(text).not.toContain('Only the independent'); expect(text).not.toContain('privateKey');
    }
  });
  it('fails closed on a revoked device and rejects directory rollback', async () => {
    const f = await fixture(), sender = await f.endpoint(f.a.owner, f.a.signer, f.a.owner), recipient = await f.endpoint(f.b.owner, f.b.phone.signer, f.b.phone.request.record.author);
    await recipient.mail.poll(); await sender.mail.poll();
    await sender.engine.send(f.b.owner, 'Revoked recipients must not pull this'); await sender.engine.flush();
    const old = f.policies.get(f.b.owner)!;
    await f.b.store.revoke(f.b.certificate.record.id, true); await f.b.publish();
    await expect(recipient.mail.poll()).rejects.toThrow('device_denied'); expect(recipient.visible).toEqual([]);
    await expect(f.node.handle('/devices/publish', { address: f.b.owner }, { roster: old })).rejects.toThrow('conflict');
    await expect(f.node.handle('/devices/receipts', { address: f.a.owner }, { owner: f.b.owner, device: f.a.owner, ids: [] })).rejects.toThrow();
  });
  it('does not acknowledge lost/failed history writes; retries lost node ACK without duplicate history', async () => {
    const f = await fixture(), sender = await f.endpoint(f.a.owner, f.a.signer, f.a.owner), recipient = await f.endpoint(f.b.owner, f.b.phone.signer, f.b.phone.request.record.author);
    await recipient.mail.poll(); await sender.mail.poll(); await sender.engine.send(f.b.owner, 'A lost receipt is not a lost message'); await sender.engine.flush();
    f.loseNextAck(); await recipient.mail.poll(); expect(recipient.visible).toHaveLength(1);
    await recipient.restart(); await recipient.mail.poll(); await sender.mail.poll();
    expect(recipient.visible).toHaveLength(1);
    expect((await sender.engine.inspect()).outbox[0].targets.find(t => t.device === f.b.phone.request.record.author)?.status).toBe('received');
  });
  it('strict mode waits for fresh policy; cached delivery requires explicit opt-in and a previously verified cache', async () => {
    const f = await fixture(), sender = await f.endpoint(f.a.owner, f.a.signer, f.a.owner), recipient = await f.endpoint(f.b.owner, f.b.phone.signer, f.b.phone.request.record.author);
    await recipient.mail.poll(); await recipient.engine.refresh(); await recipient.engine.refresh(f.a.owner); await sender.mail.poll();
    await sender.engine.send(f.b.owner, 'Explicit cached policy only'); await sender.engine.flush();
    recipient.policyOffline(true); await recipient.mail.poll(); expect(recipient.visible).toEqual([]);
    recipient.allowCached(true); await recipient.mail.poll(); expect(recipient.visible).toEqual(['Explicit cached policy only']);
  });
  it('pins fresh nonce/checkpoint and canonical bytes; a retained roster alone is not freshness', async () => {
    const f = await fixture(), nonce = 'b'.repeat(64), pin = { owner: f.a.owner, sequence: 0, digest: null, revoked: [] };
    const reply = await f.node.handle('/devices/policy', { address: f.b.owner }, { owner: f.a.owner, nonce });
    await expect(verifyDirectoryReply(reply, f.a.owner, nonce, pin, f.environment)).resolves.toBeTruthy();
    await expect(verifyDirectoryReply(reply, f.a.owner, 'c'.repeat(64), pin, f.environment)).rejects.toThrow();
    await expect(verifyDirectoryReply(reply, f.b.owner, nonce, { ...pin, owner: f.b.owner }, f.environment)).rejects.toThrow();
    for (const value of [{ '2': 'b', '10': 'a', z: ['😀', -0, { a: true }] }, reply]) expect(deviceCanonical(value)).toBe(canonicalJson(value));
  });
});
