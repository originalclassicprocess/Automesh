import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { WebCryptoIdentity } from '../identity/webcrypto';
import { accountIdFromPublicKey } from '../addressing/account-id.js';
import { openBrowserOwnerDevices } from './owner-browser';
import { createPendingDeviceBrowser } from './pending-browser';
import { DEVICE_APPROVAL_TYPE } from './approval';
import { deviceComparisonCode } from './enrollment';
import type { CoreEnvironment } from '../core/ports';
import { createDeviceInvitation } from './links';
const PASSWORD = 'Public-test-device-password-2026';
let factory: IDBFactory, signer: WebCryptoIdentity, root: Uint8Array, owner: string, now: number, environment: CoreEnvironment;
beforeEach(async () => {
  factory = new IDBFactory(); root = crypto.getRandomValues(new Uint8Array(32)); signer = new WebCryptoIdentity(); await signer.fromSeed(root);
  owner = await accountIdFromPublicKey(await signer.getPublicKeyBytes()); now = 1800000000000;
  environment = { subtle: crypto.subtle, now: () => now, newId: () => crypto.randomUUID() }; vi.stubGlobal('localStorage', { getItem: () => null });
});
afterEach(() => { signer.dispose(); root.fill(0); vi.unstubAllGlobals(); });
async function fixture() {
  const admin = await openBrowserOwnerDevices({ root, owner, signer, trusted: true, isCurrent: () => true, environment, factory });
  const host = createPendingDeviceBrowser({ trusted: true, isCurrent: () => true, factory, environment });
  const vault = await host.create('Independent phone', PASSWORD), code = await deviceComparisonCode(owner, vault.request, environment);
  const certificate = await admin.approve(vault.request, { approved: true, comparisonCode: code });
  const approval = { type: DEVICE_APPROVAL_TYPE, certificate, membership: await admin.publish() };
  return { admin, host, vault, code, approval };
}
describe('seed-free device approval import', () => {
  it('replaces pending invitation context with the verified approval, keeping linked vault schema compatible', async () => {
    const f = await fixture(), deviceId = f.vault.deviceId;
    const authority = { url: 'https://node.example.test', nodeId: 'a'.repeat(32), publicKey: '04' + 'b'.repeat(128) };
    try {
      await f.admin.bindDirectory(authority, true);
      await f.vault.setInvitation(await createDeviceInvitation(authority, 'Owner', signer, environment));
      await f.vault.link({ ...f.approval, membership: await f.admin.publish() }, owner, f.code);
      expect(f.vault.invitation).toBe(null); f.host.close();
      const next = createPendingDeviceBrowser({ trusted: true, isCurrent: () => true, environment, factory });
      try { const reopened = await next.open(deviceId, PASSWORD); expect(reopened.owner).toBe(owner); expect(reopened.invitation).toBe(null); }
      finally { next.close(); }
    } finally { f.admin.close(); f.host.close(); }
  });
  it('verifies owner/request/code and persists the link with only its own local device password', async () => {
    const f = await fixture(), deviceId = f.vault.deviceId;
    try {
      await f.vault.link(f.approval, owner, f.code); expect(f.vault.owner).toBe(owner);
      expect(f.vault.approval).toEqual(f.approval); f.host.close();
      const next = createPendingDeviceBrowser({ trusted: true, isCurrent: () => true, environment, factory });
      const reopened = await next.open(deviceId, PASSWORD);
      expect(reopened.owner).toBe(owner); expect(reopened.deviceId).not.toBe(owner);
      const bytes = new TextEncoder().encode('Independent proof');
      expect(await reopened.signer.verify(bytes, await reopened.signer.sign(bytes))).toBe(true);
      await expect(reopened.cancel()).rejects.toThrow('revocation_required'); next.close();
    } finally { f.admin.close(); f.host.close(); }
  });
  it('rejects wrong owner, wrong code, another device, unknown fields and tampering', async () => {
    const f = await fixture(), other = await f.host.create('Other device', PASSWORD);
    try {
      await expect(f.vault.link(f.approval, other.deviceId, f.code)).rejects.toThrow();
      await expect(f.vault.link(f.approval, owner, '0000-0000-0000')).rejects.toThrow();
      await expect(other.link(f.approval, owner, await deviceComparisonCode(owner, other.request, environment))).rejects.toThrow();
      await expect(f.vault.link({ ...f.approval, seed: 'not accepted' }, owner, f.code)).rejects.toThrow();
      const changed = structuredClone(f.approval); changed.certificate.record.audience = [owner];
      await expect(f.vault.link(changed, owner, f.code)).rejects.toThrow();
      expect(f.vault.owner).toBe(null);
    } finally { f.admin.close(); f.host.close(); }
  });
  it('does not accept a revoked or stale policy; a fresh owner reply can complete an earlier valid approval', async () => {
    const f = await fixture();
    try {
      now += 6 * 60000; await expect(f.vault.link(f.approval, owner, f.code)).rejects.toThrow();
      await f.vault.link({ ...f.approval, membership: await f.admin.publish() }, owner, f.code);
      const other = await f.host.create('Revoked before import', PASSWORD), code = await deviceComparisonCode(owner, other.request, environment);
      const cert = await f.admin.approve(other.request, { approved: true, comparisonCode: code }); await f.admin.revoke(cert.record.id, true);
      await expect(other.link({ type: DEVICE_APPROVAL_TYPE, certificate: cert, membership: await f.admin.publish() }, owner, code)).rejects.toThrow();
    } finally { f.admin.close(); f.host.close(); }
  });
});
