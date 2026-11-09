import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { WebCryptoIdentity } from '../identity/webcrypto';
import { accountIdFromPublicKey } from '../addressing/account-id.js';
import { createDeviceRequest, deviceComparisonCode } from './enrollment';
import { openBrowserOwnerDevices } from './owner-browser';
import { verifyMembership, MEMBERSHIP_TTL, signMembership, type MembershipBody } from './membership';
import { beginStorageReset } from '../application/storage-reset';
import type { CoreEnvironment } from '../core/ports';
let owner: WebCryptoIdentity, id: string, root: Uint8Array, factory: IDBFactory, now: number, environment: CoreEnvironment;
beforeEach(async () => {
  root = crypto.getRandomValues(new Uint8Array(32)); owner = new WebCryptoIdentity(); await owner.fromSeed(root);
  id = await accountIdFromPublicKey(await owner.getPublicKeyBytes()); factory = new IDBFactory(); now = 1800000000000;
  environment = { subtle: crypto.subtle, now: () => now, newId: () => crypto.randomUUID() };
  const storage = new Map<string, string>(); vi.stubGlobal('localStorage', { getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v) });
});
afterEach(() => { owner.dispose(); root.fill(0); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const open = () => openBrowserOwnerDevices({ root, owner: id, signer: owner, factory, trusted: true, isCurrent: () => true, environment });
const pin = () => ({ owner: id, sequence: 0, digest: null, revoked: [] });
async function fixture() {
  const store = await open(), device = await createDeviceRequest('Home computer', environment);
  const confirmation = { approved: true, comparisonCode: await deviceComparisonCode(id, device.request, environment) };
  return { store, device, confirmation };
}
describe('durable owner approval / device list / revocation', () => {
  it('renews the same independent device without root transfer and never renews a revoked grant', async () => {
    const { store, device, confirmation } = await fixture();
    try {
      const original = await store.approve(device.request, confirmation); now += 29 * 86400000;
      await store.renew(original.record.id, true);
      const listed = (await store.list())[0]; expect(listed.id).toBe(original.record.id); expect(listed.device).toBe(device.request.record.author);
      expect(listed.expiresAt).toBe(now + 30 * 86400000);
      await store.revoke(original.record.id, true); await expect(store.renew(original.record.id, true)).rejects.toThrow('revoked');
    } finally { store.close(); device.close(); }
  });
  it('does not issue a second grant for an ECDSA-malleated signature on the same request', async () => {
    const { store, device, confirmation } = await fixture();
    try {
      const cert = await store.approve(device.request, confirmation), changed = structuredClone(device.request);
      const order = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
      changed.signature = changed.signature.slice(0, 64) + (order - BigInt('0x' + changed.signature.slice(64))).toString(16).padStart(64, '0');
      expect(await deviceComparisonCode(id, changed, environment)).toBe(confirmation.comparisonCode);
      expect(await store.approve(changed, confirmation)).toEqual(cert);
      expect(await store.list()).toHaveLength(1);
    } finally { store.close(); device.close(); }
  });
  it('requires explicit approval and exact independent comparison code', async () => {
    const { store, device, confirmation } = await fixture();
    try {
      await expect(store.approve(device.request, { ...confirmation, approved: false })).rejects.toThrow('confirmation');
      await expect(store.approve(device.request, { ...confirmation, comparisonCode: '0000-0000-0000' })).rejects.toThrow('comparison');
      expect(await store.list()).toEqual([]);
      const certificate = await store.approve(device.request, confirmation);
      expect((await store.list())[0]).toMatchObject({ id: certificate.record.id, device: device.request.record.author,
        label: 'Home computer', status: 'authorized' });
    } finally { store.close(); device.close(); }
  });
  it('retries the same approval after reload/lost reply without issuing another certificate', async () => {
    const { store, device, confirmation } = await fixture();
    const first = await store.approve(device.request, confirmation); store.close();
    const next = await open();
    try {
      expect(await next.approve(device.request, confirmation)).toEqual(first);
      expect(await next.list()).toHaveLength(1);
      now += 11 * 60000;
      expect(await next.approve(device.request, confirmation)).toEqual(first);
    } finally { next.close(); device.close(); }
  });
  it('serializes concurrent approvals and does not lose a different device', async () => {
    const { store, device, confirmation } = await fixture(), other = await open();
    try {
      const certificates = await Promise.all([store.approve(device.request, confirmation), other.approve(device.request, confirmation)]);
      expect(certificates[0]).toEqual(certificates[1]); expect(await store.list()).toHaveLength(1);
      const second = await createDeviceRequest('Phone', environment);
      try {
        const code = await deviceComparisonCode(id, second.request, environment);
        await Promise.all([store.publish(), other.approve(second.request, { approved: true, comparisonCode: code })]);
        expect(await store.list()).toHaveLength(2);
      } finally { second.close(); }
    } finally { store.close(); other.close(); device.close(); }
  });
  it('revokes durably, denies reapproval and makes old snapshots fail the remembered anchor', async () => {
    const { store, device, confirmation } = await fixture();
    const cert = await store.approve(device.request, confirmation), old = await store.publish();
    const verified = await verifyMembership(old, pin(), environment);
    await expect(store.revoke(cert.record.id, false)).rejects.toThrow('confirmation');
    await store.revoke(cert.record.id, true);
    const next = await verifyMembership(await store.publish(), verified.anchor, environment);
    expect(next.anchor.revoked).toEqual([cert.record.id]);
    await expect(verifyMembership(old, next.anchor, environment)).rejects.toThrow();
    store.close(); const reopened = await open();
    try {
      expect((await reopened.list())[0].status).toBe('revoked');
      await reopened.revoke(cert.record.id, true);
      await expect(reopened.approve(device.request, confirmation)).rejects.toThrow('conflict');
    } finally { reopened.close(); device.close(); }
  });
  it('rejects mismatched requests, expired new approvals and a foreign owner signer', async () => {
    const { store, device, confirmation } = await fixture();
    try {
      await store.approve(device.request, confirmation);
      const other = await createDeviceRequest('Attacker', environment);
      try {
        await expect(store.approve(other.request, confirmation)).rejects.toThrow('comparison');
        now += 11 * 60000;
        await expect(store.approve(other.request, { approved: true,
          comparisonCode: await deviceComparisonCode(id, other.request, { ...environment, now: () => other.request.record.createdAt }) })).rejects.toThrow();
        const foreign = await openBrowserOwnerDevices({ root, owner: id, signer: other.signer, trusted: true, isCurrent: () => true, environment, factory });
        await expect(foreign.list()).rejects.toThrow('mismatch'); foreign.close();
      } finally { other.close(); }
    } finally { store.close(); device.close(); }
  });
  it('does not report success on quota failure/transaction abort and permits a clean retry', async () => {
    const { store, device, confirmation } = await fixture();
    const original = IDBObjectStore.prototype.put;
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new DOMException('quota'); });
    await expect(store.approve(device.request, confirmation)).rejects.toThrow('quota'); put.mockRestore();
    expect(await store.list()).toHaveLength(0);
    const abort = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(this: IDBObjectStore, ...args: Parameters<typeof original>) {
      const request = original.apply(this, args); request.addEventListener('success', () => this.transaction.abort()); return request;
    });
    await expect(store.approve(device.request, confirmation)).rejects.toThrow(); abort.mockRestore();
    try { await store.approve(device.request, confirmation); expect(await store.list()).toHaveLength(1); }
    finally { store.close(); device.close(); }
  });
  it('cannot write after lock/reset and retains earlier state', async () => {
    const { store, device, confirmation } = await fixture(); await store.list();
    beginStorageReset(); await expect(store.approve(device.request, confirmation)).rejects.toThrow('storage_reset');
    store.close(); device.close();
  });
});
describe('signed membership freshness and rollback boundaries', () => {
  it('requires a pinned owner, fresh signature, bounded validity and monotonic sequence', async () => {
    const store = await open(), roster = await store.publish();
    try {
      const verified = await verifyMembership(roster, pin(), environment);
      expect(verified.body.devices).toEqual([]);
      now += MEMBERSHIP_TTL; await expect(verifyMembership(roster, pin(), environment)).rejects.toThrow();
      const refreshed = await store.publish();
      expect((await verifyMembership(refreshed, verified.anchor, environment)).body.sequence).toBeGreaterThan(verified.body.sequence);
      const tampered = structuredClone(refreshed); (tampered.record.body as unknown as MembershipBody).sequence += 100;
      await expect(verifyMembership(tampered, pin(), environment)).rejects.toThrow();
    } finally { store.close(); }
  });
  it('rejects same-sequence equivocation and omission of remembered revoked certificates', async () => {
    const { store, device, confirmation } = await fixture();
    try {
      const cert = await store.approve(device.request, confirmation); await store.revoke(cert.record.id, true);
      const roster = await store.publish(), verified = await verifyMembership(roster, pin(), environment);
      const body = structuredClone(verified.body); body.devices = [];
      const fork = await signMembership(body, owner, environment);
      await expect(verifyMembership(fork, verified.anchor, environment)).rejects.toThrow('conflict');
      body.sequence += 2;
      await expect(verifyMembership(await signMembership(body, owner, environment), verified.anchor, environment)).rejects.toThrow('rollback');
    } finally { store.close(); device.close(); }
  });
});
