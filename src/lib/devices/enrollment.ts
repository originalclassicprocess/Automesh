// Independent-device preview; ordinary v1 identity validators stay unchanged.
// Device keys are random and independent; no mnemonic/root secret is exported.
import { WebCryptoIdentity } from '$lib/identity/webcrypto';
import type { IdentityProvider } from '$lib/identity/identity';
import { canonicalJson, type JsonValue } from '$lib/core/canonical';
import { signObject, verifyObject, UUID_PATTERN, type SignedObject } from '$lib/core/objects';
import { checkedTime, type CoreEnvironment, type ReplayStore } from '$lib/core/ports';
import { accountIdFromPublicKey } from '$lib/addressing/account-id.js';
import { isValidAccountId } from '$lib/addressing/bech32m.js';

const REQUEST_TYPE = 'automesh-device-request-prototype-v1';
const CERTIFICATE_TYPE = 'automesh-device-certificate-prototype-v1';
const PROOF_TYPE = 'automesh-device-proof-prototype-v1';
const TEN_MINUTES = 10 * 60000, MAX_LIFETIME = 30 * 86400000;
const hex = (value: Uint8Array) => [...value].map(b => b.toString(16).padStart(2,'0')).join('');
const bytes = (value: string) => Uint8Array.from(value.match(/../g)!, b => parseInt(b,16));
const exact = (value: object, keys: string[]) => Object.keys(value).sort().join(',') === keys.sort().join(',');
const nonce = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const fail = (): never => { throw new Error('device_enrollment_denied'); };
const json = (value: unknown) => value as JsonValue;
async function digest(value: unknown, environment: CoreEnvironment): Promise<string> {
  // Bind semantic signed content, not ECDSA's malleable signature encoding.
  const signed = value as SignedObject;
  const input = new TextEncoder().encode(canonicalJson({ record: signed.record, publicKey: signed.publicKey }));
  return hex(new Uint8Array(await environment.subtle.digest('SHA-256',input)));
}

export async function deviceRequestDigest(value: unknown, environment: CoreEnvironment): Promise<string> {
  return digest(await verifyDeviceRequest(value, environment), environment);
}

export async function deviceComparisonCode(owner: string, value: unknown, environment: CoreEnvironment): Promise<string> {
  if (!isValidAccountId(owner)) fail();
  const request = await verifyDeviceRequest(value, environment);
  const input = new TextEncoder().encode(canonicalJson(['Automesh device comparison prototype v1', owner, await digest(request, environment)]));
  return hex(new Uint8Array(await environment.subtle.digest('SHA-256', input))).slice(0, 12).toUpperCase().match(/.{4}/g)!.join('-');
}
function bounded(record: SignedObject['record'], maximum: number, environment: CoreEnvironment) {
  const now = checkedTime(environment.now);
  if (record.expiresAt === null || record.createdAt > now || record.expiresAt <= now ||
    record.expiresAt - record.createdAt > maximum) fail();
}

export async function createDeviceRequest(label: string, environment: CoreEnvironment) {
  const signer = new WebCryptoIdentity();
  try {
    await signer.create();
    const request = await createDeviceRequestForSigner(label, signer, environment);
    return Object.freeze({request, signer, close:()=>signer.dispose()});
  } catch (error) { signer.dispose(); throw error; }
}

// Allows a locally persisted, independent DEVICE key to resume after reload.
// The caller must never supply an owner's/root signer to a new-device flow.
export async function createDeviceRequestForSigner(label: string, signer: IdentityProvider, environment: CoreEnvironment) {
  if (typeof label !== 'string' || label.trim() !== label || !label || label.length > 64 || /[\u0000-\u001f\u007f]/.test(label)) fail();
  return signObject({ kind:'document',audience:[],expiresAt:checkedTime(environment.now)+TEN_MINUTES,
    body:json({type:REQUEST_TYPE,label,nonce:hex(crypto.getRandomValues(new Uint8Array(32)))}) },signer,environment);
}

export async function verifyDeviceRequest(value: unknown, environment: CoreEnvironment): Promise<SignedObject> {
  const request = await verifyObject(value,environment), body = request.record.body as Record<string,unknown>;
  bounded(request.record,TEN_MINUTES,environment);
  if (request.record.kind !== 'document' || request.record.audience.length || !body ||
    !exact(body,['type','label','nonce']) || body.type !== REQUEST_TYPE || typeof body.label !== 'string' ||
    !body.label || body.label.trim() !== body.label || body.label.length > 64 || /[\u0000-\u001f\u007f]/.test(body.label) || !nonce(body.nonce)) fail();
  return request;
}

// First iteration: only the owner can issue a non-delegating messaging grant.
// No manage/recovery right and no arbitrary signed data from the QR request.
export async function approveDeviceRequest(value: unknown, ownerSigner: IdentityProvider, options: {
  owner: string; epoch: number; expiresAt: number; approved: boolean;
}, environment: CoreEnvironment, replay: ReplayStore): Promise<SignedObject> {
  const {owner,epoch,expiresAt,approved} = options, now = checkedTime(environment.now);
  if (approved !== true || !isValidAccountId(owner) || !Number.isSafeInteger(epoch) || epoch<0 ||
    !Number.isSafeInteger(expiresAt) || expiresAt<=now || expiresAt>now+MAX_LIFETIME) fail();
  if (await accountIdFromPublicKey(await ownerSigner.getPublicKeyBytes(),environment.subtle)!==owner) fail();
  const request = await verifyDeviceRequest(value,environment), requestHash = await digest(request,environment);
  const certificate = await signObject({kind:'document',audience:[request.record.author],expiresAt,
    body:json({type:CERTIFICATE_TYPE,device:request.record.author,devicePublicKey:request.publicKey,
      requestId:request.record.id,requestHash,label:(request.record.body as Record<string,unknown>).label,
      epoch,permission:'messages',canDelegate:false})},ownerSigner,environment);
  bounded(request.record,TEN_MINUTES,environment);
  if (!await replay.claim(`device-request:${owner}:${requestHash}`,request.record.expiresAt!,checkedTime(environment.now))) fail();
  return certificate;
}

export type DevicePermissionContext = { owner: string; device: string; epoch: number;
  // Local trusted policy, NEVER supplied by a certificate's own claimed epoch.
  isRevoked(owner: string, certificateId: string): Promise<boolean> };

export async function verifyDeviceCertificate(value: unknown, context: DevicePermissionContext,
  environment: CoreEnvironment): Promise<SignedObject> {
  const {owner,device,epoch,isRevoked} = context;
  if (!isValidAccountId(owner) || !isValidAccountId(device) || !Number.isSafeInteger(epoch) || epoch<0 || typeof isRevoked!=='function') fail();
  const certificate = await verifyObject(value,environment), body = certificate.record.body as Record<string,unknown>;
  bounded(certificate.record,MAX_LIFETIME,environment);
  if (certificate.record.kind!=='document' || certificate.record.author!==owner || certificate.record.audience.length!==1 ||
    certificate.record.audience[0]!==device || !body || !exact(body,['type','device','devicePublicKey','requestId','requestHash','label','epoch','permission','canDelegate']) ||
    body.type!==CERTIFICATE_TYPE || body.device!==device || body.epoch!==epoch || body.permission!=='messages' || body.canDelegate!==false ||
    typeof body.devicePublicKey!=='string' || !/^04[a-f0-9]{128}$/.test(body.devicePublicKey) ||
    typeof body.requestId!=='string' || !UUID_PATTERN.test(body.requestId) || !nonce(body.requestHash) ||
    typeof body.label!=='string' || body.label.length<1 || body.label.length>64 || /[\u0000-\u001f\u007f]/.test(body.label) ||
    await accountIdFromPublicKey(bytes(body.devicePublicKey),environment.subtle)!==device) fail();
  if (await isRevoked(owner,certificate.record.id)!==false) fail();
  bounded(certificate.record,MAX_LIFETIME,environment); return certificate;
}

export async function createDeviceProof(certificate: SignedObject, signer: IdentityProvider, recipient: string,
  challenge: string, environment: CoreEnvironment): Promise<SignedObject> {
  if (!isValidAccountId(recipient) || !nonce(challenge)) fail();
  return signObject({kind:'document',audience:[recipient],expiresAt:checkedTime(environment.now)+60000,
    body:json({type:PROOF_TYPE,certificateHash:await digest(certificate,environment),challenge})},signer,environment);
}

export async function verifyDeviceProof(value: unknown, certificate: unknown, context: DevicePermissionContext & {
  recipient: string; challenge: string;
}, environment: CoreEnvironment, replay: ReplayStore): Promise<void> {
  const snapshot = { ...context };
  if (!isValidAccountId(snapshot.recipient) || !nonce(snapshot.challenge)) fail();
  const grant = await verifyDeviceCertificate(certificate,snapshot,environment);
  const proof = await verifyObject(value,environment), body = proof.record.body as Record<string,unknown>;
  bounded(proof.record,60000,environment);
  if (proof.record.kind!=='document' || proof.record.author!==snapshot.device || proof.record.audience.length!==1 ||
    proof.record.audience[0]!==snapshot.recipient || !body || !exact(body,['type','certificateHash','challenge']) ||
    body.type!==PROOF_TYPE || body.challenge!==snapshot.challenge || body.certificateHash!==await digest(grant,environment)) fail();
  // Revocation may change while signature verification is in flight.
  await verifyDeviceCertificate(grant,snapshot,environment); bounded(proof.record,60000,environment);
  if (!await replay.claim(`device-proof:${snapshot.recipient}:${snapshot.device}:${snapshot.challenge}`,proof.record.expiresAt!,checkedTime(environment.now))) fail();
}
