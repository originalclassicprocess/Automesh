// Versioned opt-in overlay. Device addresses continue to use unmodified v1
// transport authentication; this roster authorizes a LOGICAL account mapping.
import { canonicalJson, type JsonValue } from '../core/canonical';
import { signObject, verifyObject, UUID_PATTERN, type SignedObject } from '../core/objects';
import { checkedTime, type CoreEnvironment } from '../core/ports';
import type { IdentityProvider } from '../identity/identity';
import { isValidAccountId } from '../addressing/bech32m.js';
import { verifyDeviceCertificate } from './enrollment';
import { DEVICE_DIRECTORY, DIRECTORY_LIFETIME, verifyDirectoryRoster } from '../../../nodes/packages/protocol/src/devices.js';

export const MEMBERSHIP_TYPE = 'automesh-device-membership-prototype-v1';
export const MEMBERSHIP_TTL = 5 * 60000, MAX_DEVICE_RECORDS = 16;
export type DeviceMember = { certificate: SignedObject; revokedAt: number | null };
export type DirectoryAuthority = { url: string; nodeId: string; publicKey: string };
export type MembershipBody = { type: typeof MEMBERSHIP_TYPE | typeof DEVICE_DIRECTORY; sequence: number; previous: string | null; epoch: 0;
  primary: boolean; devices: DeviceMember[]; directory?: DirectoryAuthority };
export type MembershipAnchor = { owner: string; sequence: number; digest: string | null; revoked: string[] };
const exact = (value: object, keys: string[]) => Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
const denied = (): never => { throw new Error('device_membership_denied'); };
export const memberDevice = (member: DeviceMember) => (member.certificate.record.body as Record<string, JsonValue>).device as string;
export const memberLabel = (member: DeviceMember) => (member.certificate.record.body as Record<string, JsonValue>).label as string;
export async function membershipDigest(value: SignedObject, environment: CoreEnvironment): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson({ record: value.record, publicKey: value.publicKey }));
  return [...new Uint8Array(await environment.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function signMembership(body: MembershipBody, signer: IdentityProvider, environment: CoreEnvironment) {
  return signObject({ kind: 'document', audience: [], expiresAt: checkedTime(environment.now) + (body.directory ? DIRECTORY_LIFETIME : MEMBERSHIP_TTL),
    body: body as unknown as JsonValue }, signer, environment);
}
export async function verifyMembership(value: unknown, anchor: MembershipAnchor, environment: CoreEnvironment) {
  const pin = JSON.parse(canonicalJson(anchor)) as MembershipAnchor;
  if (!exact(pin, ['owner', 'sequence', 'digest', 'revoked']) || !isValidAccountId(pin.owner) || !Number.isSafeInteger(pin.sequence) || pin.sequence < 0 ||
    (pin.sequence === 0 ? pin.digest !== null : typeof pin.digest !== 'string' || !/^[a-f0-9]{64}$/.test(pin.digest)) ||
    !Array.isArray(pin.revoked) || pin.revoked.length > MAX_DEVICE_RECORDS || pin.revoked.some(id => typeof id !== 'string' || !UUID_PATTERN.test(id)) ||
    new Set(pin.revoked).size !== pin.revoked.length || (pin.sequence === 0 && pin.revoked.length !== 0)) denied();
  const roster = await verifyObject(value, environment), body = roster.record.body as unknown as MembershipBody;
  const now = checkedTime(environment.now);
  if (body?.directory) await verifyDirectoryRoster(roster, pin.owner, now, environment.subtle);
  if (roster.record.author !== pin.owner || roster.record.kind !== 'document' || roster.record.audience.length ||
    roster.record.createdAt > now || roster.record.expiresAt === null || roster.record.expiresAt - roster.record.createdAt > (body?.directory ? DIRECTORY_LIFETIME : MEMBERSHIP_TTL) ||
    !body || !exact(body, ['type', 'sequence', 'previous', 'epoch', 'primary', 'devices', ...(body.directory ? ['directory'] : [])]) ||
    body.type !== (body.directory ? DEVICE_DIRECTORY : MEMBERSHIP_TYPE) || body.epoch !== 0 || typeof body.primary !== 'boolean' ||
    !Number.isSafeInteger(body.sequence) || body.sequence < 1 || body.sequence < pin.sequence ||
    (body.sequence === 1 ? body.previous !== null : typeof body.previous !== 'string' || !/^[a-f0-9]{64}$/.test(body.previous)) ||
    !Array.isArray(body.devices) || body.devices.length > MAX_DEVICE_RECORDS) denied();
  const digest = await membershipDigest(roster, environment);
  if (body.sequence === pin.sequence && digest !== pin.digest) throw new Error('device_membership_conflict');
  if (pin.sequence > 0 && body.sequence === pin.sequence + 1 && body.previous !== pin.digest) throw new Error('device_membership_fork');
  const ids = new Set<string>(), devices = new Set<string>(), requests = new Set<string>();
  for (const member of body.devices) {
    if (!member || !exact(member, ['certificate', 'revokedAt'])) denied();
    const cert = member.certificate, issued = cert?.record?.createdAt;
    if (!Number.isSafeInteger(issued) || issued < 0 || issued > roster.record.createdAt ||
      (member.revokedAt !== null && (!Number.isSafeInteger(member.revokedAt) || member.revokedAt < issued || member.revokedAt > roster.record.createdAt))) denied();
    const device = memberDevice(member);
    await verifyDeviceCertificate(cert, { owner: pin.owner, device, epoch: 0, isRevoked: async () => false }, { ...environment, now: () => issued });
    const request = (cert.record.body as Record<string, JsonValue>).requestId as string;
    if (ids.has(cert.record.id) || devices.has(device) || requests.has(request) || device === pin.owner) denied();
    ids.add(cert.record.id); devices.add(device); requests.add(request);
  }
  const revoked = body.devices.filter(m => m.revokedAt !== null).map(m => m.certificate.record.id);
  if (pin.revoked.some(id => !revoked.includes(id))) throw new Error('device_revocation_rollback');
  if (roster.record.expiresAt! <= checkedTime(environment.now)) denied();
  return { roster, body, anchor: { owner: pin.owner, sequence: body.sequence, digest, revoked } as MembershipAnchor };
}
export function activeMembers(body: MembershipBody, now: number) {
  return body.devices.filter(m => m.revokedAt === null && m.certificate.record.expiresAt! > now);
}
