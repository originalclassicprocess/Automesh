import type { PendingDeviceVault } from './pending-vault';
import type { DirectoryAuthority, MembershipBody } from './membership';
import { requireDeviceAuthority } from './startup';
import { signedNodeRequest } from '../node/client';
import { verifyDirectoryReply } from './directory-client';
import { webCryptoEnvironment } from '../core/ports';
import type { DirectoryReply } from './directory-client';
import { DEVICE_APPROVAL_TYPE, verifyDeviceApproval } from './approval';

// Reads public signed authorization only. It cannot approve itself or transfer
// the owner's root key. The user's comparison confirmation happens on the owner.
export async function pollDeviceApproval(vault: PendingDeviceVault, owner: string, authority: DirectoryAuthority,
  code: string, signal: AbortSignal, request: typeof signedNodeRequest = signedNodeRequest) {
  const nonce = [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join('');
  const reply = await request(authority.url, authority.nodeId, vault.signer, vault.deviceId, '/devices/policy', { owner, nonce }, signal) as DirectoryReply;
  const verified = await verifyDirectoryReply(reply, owner, nonce, { owner, sequence: 0, digest: null, revoked: [] }, webCryptoEnvironment());
  requireDeviceAuthority(authority, (verified.body as MembershipBody).directory!);
  const member = verified.body.devices.find(m => {
    const b = m.certificate.record.body as Record<string, unknown>;
    return b.device === vault.deviceId && b.requestId === vault.request.record.id;
  });
  if (!member) return null;
  return verifyDeviceApproval({ type: DEVICE_APPROVAL_TYPE, certificate: member.certificate, membership: verified.roster },
    vault.request, owner, code, webCryptoEnvironment());
}
