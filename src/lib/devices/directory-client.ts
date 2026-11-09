import type { IdentityProvider } from '../identity/identity';
import { signedNodeRequest, homeNodeUrl } from '../node/client';
import { verifyCourier } from '../node/courier-crypto';
import { accountIdFromPublicKey } from '../addressing/account-id.js';
import { canonicalJson } from '../core/canonical';
import type { CoreEnvironment } from '../core/ports';
import type { SignedObject } from '../core/objects';
import { verifyMembership, membershipDigest, type DirectoryAuthority, type MembershipAnchor } from './membership';
export type DirectoryReply = { roster: SignedObject; checkpoint: { body: { protocol: string; nodeId: string; owner: string;
  sequence: number; digest: string; nonce: string; issuedAt: number; expiresAt: number }; publicKey: string; signature: string } };
export async function verifyDirectoryReply(value: unknown, owner: string, nonce: string, anchor: MembershipAnchor, environment: CoreEnvironment) {
  canonicalJson(value); // Bound/validate before cloning; courier v1 signs JSON key order.
  const reply = JSON.parse(JSON.stringify(value)) as DirectoryReply;
  const verified = await verifyMembership(reply.roster, anchor, environment), authority = verified.body.directory;
  if (!authority || reply.checkpoint?.publicKey !== authority.publicKey || !/^[a-f0-9]{64}$/.test(nonce)) throw new Error('device_checkpoint_invalid');
  const bytes = Uint8Array.from(authority.publicKey.match(/../g)!, p => parseInt(p, 16));
  await verifyCourier(reply.checkpoint, 'device-checkpoint-v2', await accountIdFromPublicKey(bytes));
  const body = reply.checkpoint.body, now = environment.now();
  if (body.protocol !== 'automesh-device-directory-v2' || body.nodeId !== authority.nodeId || body.owner !== owner || body.nonce !== nonce ||
    body.sequence !== verified.anchor.sequence || body.digest !== await membershipDigest(reply.roster, environment) ||
    !Number.isSafeInteger(body.issuedAt) || body.issuedAt < 0 || !Number.isSafeInteger(body.expiresAt) || body.issuedAt > now + 30000 ||
    body.expiresAt <= now || body.expiresAt > body.issuedAt + 30000) throw new Error('device_checkpoint_invalid');
  return verified;
}
export function createDirectoryClient(options: { device: string; identity: IdentityProvider; guard(): void;
  authorities(): Record<string, DirectoryAuthority>; request?: typeof signedNodeRequest }) {
  const controller = new AbortController();
  const request = async (authority: DirectoryAuthority, path: string, body: unknown) => {
    options.guard(); if (controller.signal.aborted) throw new Error('device_directory_closed');
    const abort = new AbortController(), cancel = () => abort.abort();
    controller.signal.addEventListener('abort', cancel, { once: true }); const timeout = setTimeout(cancel, 12000);
    try {
      const result = await (options.request ?? signedNodeRequest)(homeNodeUrl(authority.url), authority.nodeId, options.identity,
        options.device, path, body, abort.signal); options.guard(); return result;
    } finally { clearTimeout(timeout); controller.signal.removeEventListener('abort', cancel); }
  };
  return Object.freeze({ request,
    policy(owner: string, nonce: string) {
      const authority = options.authorities()[owner]; if (!authority) throw new Error('device_directory_unknown');
      return request(authority, '/devices/policy', { owner, nonce });
    }, close() { controller.abort(); }
  });
}
