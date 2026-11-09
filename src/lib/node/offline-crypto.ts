// Offline HPKE is deliberately separate from the live MAE session protocol.
// Each recipient key is allocated to ONE sender and ONE envelope. No fallback.
import { Aes256Gcm, CipherSuite, DhkemP256HkdfSha256, HkdfSha256 } from '@hpke/core';
import {validateKeyLifetime} from './courier-prekeys.js';
import {importP256Private} from './p256-private';
import type { IdentityProvider } from '$lib/identity/identity';
import { accountIdFromPublicKey } from '$lib/addressing/account-id.js';
import { importPublicKey, verify } from '$lib/message/envelope';
import { homeNodeUrl } from './client';
import { MAX_MAIL_TTL_MS, MAX_ENVELOPE_BYTES } from './protocol.js';
import { MESSAGE_ID, decodeChatContent } from '$lib/chat/message-details';

const suite = new CipherSuite({ kem: new DhkemP256HkdfSha256(), kdf: new HkdfSha256(), aead: new Aes256Gcm() });
const encoder = new TextEncoder();
const bytes = (value: unknown) => encoder.encode(JSON.stringify(value));
const hex = (value: Uint8Array) => [...value].map(x => x.toString(16).padStart(2, '0')).join('');
const fromHex = (value: string) => Uint8Array.from(value.match(/../g)!, x => parseInt(x, 16));
export const keyId = () => hex(crypto.getRandomValues(new Uint8Array(16)));
export function base64(value: ArrayBuffer | Uint8Array): string {
  const input = new Uint8Array(value); let text = '';
  for (let i = 0; i < input.length; i += 4096) text += String.fromCharCode(...input.subarray(i, i + 4096));
  return btoa(text).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
export function unbase64(value: string): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('invalid_offline_encoding');
  const result = Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
  if (base64(result) !== value) throw new Error('invalid_offline_encoding'); return result;
}
export async function cipherDigest(value: string): Promise<string> { return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))); }
export type NodeAddress = { url: string; nodeId: string };
export type Prekey = { id: string; publicKey: string };
export type PrivatePrekey = Prekey & { privateKey: string; peer: string; expiresAt: number; nodeId: string;publishUntil?:number };
export type BundleBody = { version: 1; from: string; to: string; node: NodeAddress; expiresAt: number; keys: Prekey[];retainUntil?:number;deliveryTtlMs?:number };
export type Signed<T> = { body: T; publicKey: string; signature: string };
export type Bundle = Signed<BundleBody>;
export type MailBody = { version: 1; from: string; to: string; nodeId: string; keyId: string; id: string; timestamp: number; expiresAt: number; enc: string; cipher: string };
export type ReceiptBody = { version: 1; from: string; to: string; id: string; digest: string; nodeId: string };
export async function signObject<T>(body: T, purpose: string, identity: IdentityProvider): Promise<Signed<T>> {
  return { body, publicKey: hex(await identity.getPublicKeyBytes()), signature: hex(await identity.sign(bytes(['automesh-offline-v1', purpose, body]))) };
}
export async function verifyObject<T>(value: Signed<T>, purpose: string, from: string): Promise<void> {
  if (!value || !/^04[0-9a-f]{128}$/.test(value.publicKey) || !/^[0-9a-f]{128}$/.test(value.signature) ||
      await accountIdFromPublicKey(fromHex(value.publicKey)) !== from ||
      !await verify(bytes(['automesh-offline-v1', purpose, value.body]), fromHex(value.signature), await importPublicKey(fromHex(value.publicKey))))
    throw new Error('invalid_offline_signature');
}
export function validateBundle(value: Bundle, from: string, to: string, now = Date.now()): Bundle {
  const body = value?.body;
  if(body?.retainUntil!==undefined||body?.deliveryTtlMs!==undefined){if(body.deliveryTtlMs!==MAX_MAIL_TTL_MS)throw Error('invalid_prekey_bundle');validateKeyLifetime(body.expiresAt,body.retainUntil,body.deliveryTtlMs);}
  if (!body || body.version !== 1 || body.from !== from || body.to !== to || !body.node ||
      homeNodeUrl(body.node.url) !== body.node.url || !/^[a-f0-9]{32}$/.test(body.node.nodeId) ||
      !Number.isSafeInteger(body.expiresAt) || body.expiresAt <= now || body.expiresAt > now + MAX_MAIL_TTL_MS ||
      !Array.isArray(body.keys) || body.keys.length > 32 || new Set(body.keys.map(k => k.id)).size !== body.keys.length ||
      body.keys.some(k => !/^[a-f0-9]{32}$/.test(k.id) || !/^04[0-9a-f]{128}$/.test(k.publicKey))) throw new Error('invalid_prekey_bundle');
  return value;
}
export async function generatePrekey(peer: string, nodeId: string, expiresAt: number,retainUntil?:number): Promise<PrivatePrekey> {
  if(retainUntil!==undefined)validateKeyLifetime(expiresAt,retainUntil);
  const pair = await suite.kem.generateKeyPair();
  return { id: keyId(), peer, nodeId, expiresAt:retainUntil??expiresAt,...(retainUntil===undefined?{}:{publishUntil:expiresAt}),
    publicKey: hex(new Uint8Array(await suite.kem.serializePublicKey(pair.publicKey))),
    privateKey: base64(await suite.kem.serializePrivateKey(pair.privateKey)) };
}
const metadata = (body: Omit<MailBody, 'enc' | 'cipher'>) => bytes(['automesh-offline-v1', 'message',
  body.from, body.to, body.nodeId, body.keyId, body.id, body.timestamp, body.expiresAt]);
export async function sealOffline(identity: IdentityProvider, from: string, bundle: Bundle, key: Prekey,
  id: string, timestamp: number, content: string): Promise<string> {
  if (!MESSAGE_ID.test(id) || !Number.isSafeInteger(timestamp) || !decodeChatContent(content) || encoder.encode(content).length > 65536)
    throw new Error('invalid_offline_message');
  const body = { version: 1 as const, from, to: bundle.body.from, nodeId: bundle.body.node.nodeId, keyId: key.id,
    id, timestamp, expiresAt: Math.min(bundle.body.retainUntil??bundle.body.expiresAt, Date.now() + MAX_MAIL_TTL_MS) };
  const aad = metadata(body);
  const context = await suite.createSenderContext({ recipientPublicKey: await suite.kem.deserializePublicKey(fromHex(key.publicKey)), info: aad });
  const plain = encoder.encode(content);
  try {
    const packet = await signObject({ ...body, enc: base64(context.enc), cipher: base64(await context.seal(plain, aad)) }, 'message', identity);
    const encoded = bytes(packet); if (encoded.length > MAX_ENVELOPE_BYTES) throw new Error('offline_message_too_large');
    return base64(encoded);
  } finally { plain.fill(0); }
}
export async function openOffline(value: string, key: PrivatePrekey, recipient: string, nodeId: string, envelopeId: string,
  expiresAt: number): Promise<{ packet: Signed<MailBody>; content: string }> {
  const raw = unbase64(value); if (raw.length > MAX_ENVELOPE_BYTES) throw new Error('offline_message_too_large');
  const packet: Signed<MailBody> = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); const body = packet.body;
  if (!body || body.version !== 1 || body.to !== recipient || body.from !== key.peer || body.nodeId !== nodeId || key.nodeId !== nodeId ||
      body.keyId !== key.id || !MESSAGE_ID.test(body.id) || body.id.replaceAll('-', '').toLowerCase() !== envelopeId ||
      body.expiresAt !== expiresAt || body.expiresAt > key.expiresAt || body.expiresAt <= Date.now() ||
      !Number.isSafeInteger(body.timestamp) || body.timestamp < 0 || body.timestamp > Date.now() + 300000) throw new Error('invalid_offline_message');
  await verifyObject(packet, 'message', body.from);
  const aad = metadata(body); const secret = unbase64(key.privateKey);
  try {
    const recipientKey=await importP256Private(secret,key.publicKey);
    const context = await suite.createRecipientContext({ recipientKey, enc: unbase64(body.enc), info: aad })
      .catch(()=>{throw Error('courier_key_agreement_failed');});
    const plain = new Uint8Array(await context.open(unbase64(body.cipher), aad)
      .catch(()=>{throw Error('courier_decryption_failed');}));
    try { const content = new TextDecoder('utf-8', { fatal: true }).decode(plain);
      if (plain.length > 65536 || !decodeChatContent(content)) throw new Error('invalid_offline_content'); return { packet, content };
    } finally { plain.fill(0); }
  } finally { secret.fill(0); }
}
export async function receiptFor(packet: Signed<MailBody>, ciphertext: string, identity: IdentityProvider): Promise<string> {
  const body = packet.body;
  return JSON.stringify(await signObject({ version: 1 as const, from: body.to, to: body.from, id: body.id,
    digest: await cipherDigest(ciphertext), nodeId: body.nodeId }, 'receipt', identity));
}
export async function verifyReceipt(value: string, expected: ReceiptBody): Promise<void> {
  if (value.length > 2048) throw new Error('invalid_receipt');
  const receipt: Signed<ReceiptBody> = JSON.parse(value);
  if (!receipt?.body || Object.entries(expected).some(([key, value]) => receipt.body[key as keyof ReceiptBody] !== value)) throw new Error('invalid_receipt');
  await verifyObject(receipt, 'receipt', expected.from);
}
