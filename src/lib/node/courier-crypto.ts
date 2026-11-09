import { Aes256Gcm, CipherSuite, DhkemP256HkdfSha256, HkdfSha256 } from '@hpke/core';
import type { IdentityProvider } from '$lib/identity/identity';
import { accountIdFromPublicKey } from '$lib/addressing/account-id.js';
import { importPublicKey, verify } from '$lib/message/envelope';
import { base64, unbase64, cipherDigest, keyId, type Signed } from './offline-crypto';
import { COURIER_PROTOCOL, COURIER_TTL, COURIER_MAX_PACKET, courierBytes, courierId, validateCourierJob } from './courier-protocol.js';
import type { Attachment } from './attachment-crypto';
import { ATTACHMENT_CAPABILITY_CEILING } from './attachment-protocol.js';
import { validateCourierRoute } from './courier-route.js';
import {validateKeySource,validateKeyLifetime,validateAllocation} from './courier-prekeys.js';
import {isValidAccountId} from '$lib/addressing/bech32m.js';
import {validateRecipientGrant} from './recipient-inbox.js';
import {importP256Private} from './p256-private';
const suite = new CipherSuite({ kem: new DhkemP256HkdfSha256(), kdf: new HkdfSha256(), aead: new Aes256Gcm() });
const hex = (v: Uint8Array) => [...v].map(x => x.toString(16).padStart(2, '0')).join('');
const raw = (v: string) => Uint8Array.from(v.match(/../g)!, x => parseInt(x, 16));
export type CourierKey = { id: string; publicKey: string; privateKey: string; peer: string; expiresAt: number;
  publishUntil?:number; retired?:true; directory?:{url:string;nodeId:string}; issuedAt?:number };
export type KeySource={url:string;nodeId:string};
export type PrekeyCertificate=Signed<{protocol:string;from:string;to:string;id:string;publicKey:string;issuedAt:number;
  acceptUntil:number;retainUntil:number;deliveryTtlMs:number;node:KeySource}>;
export type PrekeyAllocation={protocol:string;reservation:string;key:PrekeyCertificate;allocatedAt:number;expiresAt:number;route?:CourierRoute};
export type CourierRoute = Signed<{ protocol: string; from: string; to: string; kind?: 'signaling'; nodeAddress?: string; nodeId?: string;
  signalingUrl: string; issuedAt: number; expiresAt: number }>;
export type RecipientGrant=Signed<{protocol:string;from:string;to:string;courier:string;nodeId:string;issuedAt:number;expiresAt:number}>;
export type QueueSource=KeySource&{address:string;grant:RecipientGrant};
export function validateQueueSource(value:unknown,from:string,to:string,allowExpired=false):QueueSource{
  if(!value||typeof value!=='object')throw Error('invalid_courier_source');
  const source=value as QueueSource;validateKeySource({url:source.url,nodeId:source.nodeId});
  if(!isValidAccountId(source.address)||source.grant?.body?.from!==from)throw Error('invalid_courier_source');
  validateRecipientGrant(source.grant,source.address,source.nodeId,to,allowExpired?Math.min(Date.now(),source.grant.body.expiresAt-1):Date.now());
  return source;
}
export type CourierBundle = Signed<{ protocol: string; from: string; to: string; expiresAt: number; keys: { id: string; publicKey: string }[];
  deliveryTtlMs?:number;retainUntil?:number;consumedKeys?:string[];requestKeys?:boolean;keySource?:KeySource;senderQueue?:QueueSource;attachmentProtocol?: string; maxFileBytes?: number; route?: CourierRoute }>;
export type CourierPacket = Signed<{ protocol: string; from: string; to: string; id: string; keyId: string; timestamp: number; expiresAt: number; enc: string; cipher: string }>;
export type CourierJob = Signed<{ protocol: string; from: string; to: string; courier: string; id: string; expiresAt: number; packet: string; lanOnly?: boolean; attachment?: Attachment; route?: CourierRoute }>;
export type CourierHop = Signed<{ protocol: string; courier: string; digest: string; id: string }>;
export type CourierReceipt = Signed<{ protocol: string; from: string; to: string; id: string; digest: string }>;
export async function signCourier<T>(purpose: string, body: T, identity: IdentityProvider): Promise<Signed<T>> {
  return { body, publicKey: hex(await identity.getPublicKeyBytes()), signature: hex(await identity.sign(courierBytes(purpose, body))) };
}
export async function verifyCourier(value: Signed<unknown>, purpose: string, address: string) {
  if (!value || !/^04[a-f0-9]{128}$/.test(value.publicKey) || !/^[a-f0-9]{128}$/.test(value.signature) ||
      await accountIdFromPublicKey(raw(value.publicKey)) !== address ||
      !await verify(courierBytes(purpose, value.body), raw(value.signature), await importPublicKey(raw(value.publicKey)))) throw new Error('invalid_courier_signature');
}
export function validateCourierBundle(bundle: CourierBundle, from: string, to: string, allowExpired=false) {
  const b = bundle?.body;
  if(b?.requestKeys!==undefined&&typeof b.requestKeys!=='boolean'||b?.consumedKeys!==undefined&&(!Array.isArray(b.consumedKeys)||b.consumedKeys.length>32||new Set(b.consumedKeys).size!==b.consumedKeys.length||b.consumedKeys.some(id=>typeof id!=='string'||!/^[a-f0-9]{32}$/.test(id))))throw Error('invalid_courier_bundle');
  if(b?.keySource!==undefined)validateKeySource(b.keySource);
  if(b?.senderQueue!==undefined)validateQueueSource(b.senderQueue,from,to,allowExpired);
  if(b?.retainUntil!==undefined||b?.deliveryTtlMs!==undefined){if(b.deliveryTtlMs!==COURIER_TTL)throw Error('invalid_courier_bundle');validateKeyLifetime(b.expiresAt,b.retainUntil,b.deliveryTtlMs);}
  if (b?.route !== undefined) validateCourierRoute(b.route, from, to,allowExpired?b.route.body.issuedAt:Date.now());
  if (b?.attachmentProtocol !== undefined && (typeof b.attachmentProtocol !== 'string' || b.attachmentProtocol.length > 64 || !Number.isSafeInteger(b.maxFileBytes) || b.maxFileBytes! < 0 || b.maxFileBytes! > ATTACHMENT_CAPABILITY_CEILING)) throw new Error('invalid_courier_bundle');
  if (!b || b.protocol !== COURIER_PROTOCOL || b.from !== from || b.to !== to || !Number.isSafeInteger(b.expiresAt) ||
      (!allowExpired&&b.expiresAt <= Date.now()) || b.expiresAt > Date.now() + COURIER_TTL || !Array.isArray(b.keys) || b.keys.length > 32 || !b.keys.length ||
      new Set(b.keys.map(k => k.id)).size !== b.keys.length || b.keys.some(k => !/^[a-f0-9]{32}$/.test(k.id) || !/^04[a-f0-9]{128}$/.test(k.publicKey))) throw new Error('invalid_courier_bundle');
  return bundle;
}
export async function generateCourierKey(peer: string, expiresAt: number, options?:{retainUntil:number;directory?:KeySource;issuedAt?:number}): Promise<CourierKey> {
  if(options)validateKeyLifetime(expiresAt,options.retainUntil);
  if(options?.directory){validateKeySource(options.directory);if(!Number.isSafeInteger(options.issuedAt)||expiresAt!==options.issuedAt!+COURIER_TTL)throw Error('invalid_prekey_lifetime');}
  const pair = await suite.kem.generateKeyPair();
  return { id: keyId(), peer, expiresAt:options?.retainUntil??expiresAt,
    ...(options?{publishUntil:expiresAt,...(options.directory?{directory:options.directory,issuedAt:options.issuedAt}: {})}:{}),publicKey: hex(new Uint8Array(await suite.kem.serializePublicKey(pair.publicKey))),
    privateKey: base64(await suite.kem.serializePrivateKey(pair.privateKey)) };
}
const contextBytes = (b: CourierPacket['body']) => courierBytes('encryption', [b.from, b.to, b.id, b.keyId, b.timestamp, b.expiresAt]);
export async function createCourierJob(identity: IdentityProvider, from: string, courier: string, bundle: CourierBundle,
  key: { id: string; publicKey: string }, id: string, timestamp: number, content: string, lanOnly = false, attachment?: Attachment): Promise<CourierJob> {
  validateCourierBundle(bundle, bundle.body.from, from); await verifyCourier(bundle, 'prekeys', bundle.body.from);
  if (!courierId(id) || !Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp > Date.now() + 300000 ||
      !bundle.body.keys.some(k => k.id === key.id && k.publicKey === key.publicKey)) throw new Error('invalid_courier_message');
  const expiresAt=bundle.body.retainUntil===undefined?bundle.body.expiresAt:Math.min(Date.now()+COURIER_TTL,bundle.body.retainUntil);
  let route = !lanOnly && !attachment ? bundle.body.route : undefined;
  if(route)await verifyCourier(route,'route',bundle.body.from);
  // Existing node route storage/freshness rules remain unchanged. A short
  // discovery advertisement must not shorten a new-format delivery deadline;
  // the controller separately syncs that advertisement as before.
  if(bundle.body.retainUntil!==undefined&&route&&route.body.expiresAt<expiresAt)route=undefined;
  return sealCourierJob(identity,from,courier,bundle.body.from,key,id,timestamp,content,route?Math.min(expiresAt,route.body.expiresAt):expiresAt,lanOnly,attachment,route);
}
export async function createAllocatedCourierJob(identity:IdentityProvider,from:string,courier:string,peer:string,allocation:PrekeyAllocation,
  id:string,timestamp:number,content:string,lanOnly=false,attachment?:Attachment):Promise<CourierJob>{
  validateAllocation(allocation,peer,from,id);await verifyCourier(allocation.key,'prekey',peer);
  return sealCourierJob(identity,from,courier,peer,allocation.key.body,id,timestamp,content,Math.min(allocation.expiresAt,Date.now()+COURIER_TTL),lanOnly,attachment);
}
async function sealCourierJob(identity:IdentityProvider,from:string,courier:string,to:string,key:{id:string;publicKey:string},id:string,timestamp:number,
  content:string,expiresAt:number,lanOnly:boolean,attachment?:Attachment,route?:CourierRoute):Promise<CourierJob>{
  if(!courierId(id)||!Number.isSafeInteger(timestamp)||timestamp<0||timestamp>Date.now()+300000)throw Error('invalid_courier_message');
  const plain = new TextEncoder().encode(content); if (plain.length > 65536) throw new Error('courier_message_too_large');
  const body = { protocol: COURIER_PROTOCOL, from, to, id, keyId: key.id, timestamp,expiresAt,enc: '', cipher: '' };
  const aad = contextBytes(body);
  try {
    const context = await suite.createSenderContext({ recipientPublicKey: await suite.kem.deserializePublicKey(raw(key.publicKey)), info: aad });
    body.enc = base64(context.enc); body.cipher = base64(await context.seal(plain, aad));
    const packet = base64(new TextEncoder().encode(JSON.stringify(await signCourier('message', body, identity))));
    return validateCourierJob(await signCourier('job', { protocol: COURIER_PROTOCOL, from, to: body.to, courier, id, expiresAt: body.expiresAt, packet,
      ...(lanOnly ? { lanOnly: true } : {}), ...(attachment ? { attachment } : {}), ...(route ? { route } : {}) }, identity), courier) as CourierJob;
  } finally { plain.fill(0); }
}
export async function openCourier(job: CourierJob, hop: CourierHop, key: CourierKey, recipient: string): Promise<CourierPacket & { content: string }> {
  validateCourierJob(job, job.body?.courier);
  if (job.body.to !== recipient || job.body.from !== key.peer || job.body.expiresAt > key.expiresAt) throw new Error('invalid_courier_recipient');
  await verifyCourier(job, 'job', job.body.from);
  const digest = await cipherDigest(job.body.packet);
  if (hop?.body?.protocol !== COURIER_PROTOCOL || hop.body.courier !== job.body.courier || hop.body.id !== job.body.id || hop.body.digest !== digest)
    throw new Error('invalid_courier_hop');
  await verifyCourier(hop, 'hop', job.body.courier);
  const packet: CourierPacket = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(unbase64(job.body.packet)));
  const b = packet.body;
  if (!b || b.protocol !== COURIER_PROTOCOL || b.from !== key.peer || b.to !== recipient || b.id !== job.body.id || b.keyId !== key.id ||
      b.expiresAt !== job.body.expiresAt || !Number.isSafeInteger(b.timestamp) || b.timestamp < 0 || b.timestamp > Date.now() + 300000 ||
      typeof b.enc !== 'string' || b.enc.length > 256 || typeof b.cipher !== 'string' || b.cipher.length > COURIER_MAX_PACKET) throw new Error('invalid_courier_packet');
  await verifyCourier(packet, 'message', b.from);
  const secret = unbase64(key.privateKey);
  try {
    const recipientKey=await importP256Private(secret,key.publicKey);
    const context = await suite.createRecipientContext({ recipientKey, enc: unbase64(b.enc), info: contextBytes(b) })
      .catch(()=>{throw Error('courier_key_agreement_failed');});
    const plain = new Uint8Array(await context.open(unbase64(b.cipher), contextBytes(b))
      .catch(()=>{throw Error('courier_decryption_failed');}));
    try { if (plain.length > 65536) throw new Error('courier_message_too_large');
      return { ...packet, content: new TextDecoder('utf-8', { fatal: true }).decode(plain) };
    } finally { plain.fill(0); }
  } finally { secret.fill(0); }
}
