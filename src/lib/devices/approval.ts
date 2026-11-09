import { canonicalJson } from '../core/canonical';
import type { SignedObject } from '../core/objects';
import type { CoreEnvironment } from '../core/ports';
import { deviceComparisonCode, deviceRequestDigest, verifyDeviceCertificate } from './enrollment';
import { verifyMembership, activeMembers, membershipDigest } from './membership';
export const DEVICE_APPROVAL_TYPE = 'automesh-device-approval-prototype-v1';
export type DeviceApproval = { type: typeof DEVICE_APPROVAL_TYPE; certificate: SignedObject; membership: SignedObject };
export async function verifyDeviceApproval(value: unknown, request: SignedObject, expectedOwner: string, comparisonCode: string, environment: CoreEnvironment) {
  const approval = JSON.parse(canonicalJson(value)) as DeviceApproval;
  if (!approval || Object.keys(approval).sort().join(',') !== 'certificate,membership,type' || approval.type !== DEVICE_APPROVAL_TYPE)
    throw new Error('device_approval_invalid');
  const issuedEnv = { ...environment, now: () => request.record.createdAt };
  if (comparisonCode !== await deviceComparisonCode(expectedOwner, request, issuedEnv)) throw new Error('device_comparison_mismatch');
  const { body } = await verifyMembership(approval.membership, { owner: expectedOwner, sequence: 0, digest: null, revoked: [] }, environment);
  const certificate = await verifyDeviceCertificate(approval.certificate, { owner: expectedOwner, device: request.record.author, epoch: 0,
    isRevoked: async () => !activeMembers(body, environment.now()).some(m => m.certificate.record.id === approval.certificate.record.id) }, environment);
  const details = certificate.record.body as Record<string, unknown>;
  const listed = body.devices.find(m => m.certificate.record.id === certificate.record.id)!;
  if (details.requestId !== request.record.id || details.requestHash !== await deviceRequestDigest(request, issuedEnv) ||
    details.devicePublicKey !== request.publicKey || certificate.record.createdAt < request.record.createdAt ||
    certificate.record.createdAt >= request.record.expiresAt! ||
    await membershipDigest(listed.certificate, environment) !== await membershipDigest(certificate, environment)) throw new Error('device_approval_mismatch');
  return approval;
}
