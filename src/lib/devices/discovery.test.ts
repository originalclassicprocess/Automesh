import { afterEach, expect, it, vi } from 'vitest';
import { WebCryptoIdentity } from '../identity/webcrypto';
import { accountIdFromPublicKey } from '../addressing/account-id.js';
import { webCryptoEnvironment } from '../core/ports';
import { acceptDeviceAdvertisement, installDeviceDiscovery } from './discovery';
import { signMembership, membershipDigest, MEMBERSHIP_TYPE, type MembershipBody } from './membership';
import type { ChatService } from '../chat/ChatService';
import type { SignedObject } from '../core/objects';

const signers: WebCryptoIdentity[] = [];
afterEach(() => { for (const signer of signers.splice(0)) signer.dispose(); });
async function fixture() {
  const signer = new WebCryptoIdentity(); signers.push(signer);
  const seed = crypto.getRandomValues(new Uint8Array(32));
  try { await signer.fromSeed(seed); } finally { seed.fill(0); }
  const peer = await accountIdFromPublicKey(await signer.getPublicKeyBytes()), env = webCryptoEnvironment();
  const body: MembershipBody = { type: MEMBERSHIP_TYPE, sequence: 1, previous: null, epoch: 0, primary: true, devices: [] };
  const first = await signMembership(body, signer, env);
  const next = await signMembership({ ...body, sequence: 2, previous: await membershipDigest(first, env) }, signer, env);
  return { signer, peer, env, body, first, next };
}
it('accepts only a fresh signed roster from its exact authenticated physical owner', async () => {
  const f = await fixture();
  expect(await acceptDeviceAdvertisement(f.peer, f.next, f.first)).toEqual(f.next);
  const other = await fixture();
  await expect(acceptDeviceAdvertisement(other.peer, f.first)).rejects.toThrow('sender');
  const forged = structuredClone(f.first); forged.record.body = { ...f.body, primary: false } as never;
  await expect(acceptDeviceAdvertisement(f.peer, forged)).rejects.toThrow();
  const expired = await signMembership(f.body, f.signer, { ...f.env, now: () => Date.now() - 600000 });
  await expect(acceptDeviceAdvertisement(f.peer, expired)).rejects.toThrow();
});
it('does not accept rollback, equal-sequence forks or broken successor links', async () => {
  const f = await fixture();
  await expect(acceptDeviceAdvertisement(f.peer, f.first, f.next)).rejects.toThrow();
  const fork = await signMembership({ ...f.body, primary: false }, f.signer, f.env);
  await expect(acceptDeviceAdvertisement(f.peer, fork, f.first)).rejects.toThrow();
  const broken = await signMembership({ ...f.body, sequence: 2, previous: '0'.repeat(64) }, f.signer, f.env);
  await expect(acceptDeviceAdvertisement(f.peer, broken, f.first)).rejects.toThrow();
});
it('detaches discovery from the peer receive queue and ignores unaccepted contacts and stale sessions', async () => {
  const f = await fixture(); let listener!: (peer: string, kind: string, value: unknown) => unknown;
  let current = true, allowed = false; const accepted = vi.fn(async (_: SignedObject) => {}), off = vi.fn();
  const chat = { onDeviceControl: (handler: typeof listener) => { listener = handler; return off; } } as unknown as ChatService;
  const close = installDeviceDiscovery({ chat, current: () => current, allowed: () => allowed, previous: () => undefined, accepted });
  expect(listener(f.peer, 'roster', f.first)).toBeUndefined(); expect(accepted).not.toHaveBeenCalled();
  allowed = true; expect(listener(f.peer, 'roster', f.first)).toBeUndefined();
  await vi.waitFor(() => expect(accepted).toHaveBeenCalledTimes(1));
  listener(f.peer, 'packet', f.next); expect(accepted).toHaveBeenCalledTimes(1);
  listener(f.peer, 'roster', f.next); current = false;
  await new Promise(resolve => setTimeout(resolve, 30)); expect(accepted).toHaveBeenCalledTimes(1);
  close(); expect(off).toHaveBeenCalledOnce();
  current = true; listener(f.peer, 'roster', f.next);
  await new Promise(resolve => setTimeout(resolve, 30)); expect(accepted).toHaveBeenCalledTimes(1);
});
