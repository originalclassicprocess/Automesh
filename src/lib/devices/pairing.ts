import { canonicalJson } from '../core/canonical';
import { signObject, verifyObject, type SignedObject } from '../core/objects';
import { webCryptoEnvironment } from '../core/ports';
import type { IdentityProvider } from '../identity/identity';
import { validatePairingChannel, type PairingChannel } from './links';
import { verifyDeviceRequest } from './enrollment';
const hex = (b: Uint8Array) => [...b].map(v => v.toString(16).padStart(2,'0')).join('');
const random = () => hex(crypto.getRandomValues(new Uint8Array(32)));
const unhex = (v: string) => Uint8Array.from(v.match(/../g)!, p => parseInt(p,16));
const bytes = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
const buffer = (v: Uint8Array) => new Uint8Array(v).buffer as ArrayBuffer;
export async function pairingRequest(origin: string, action: string, body: object, token?: string, signal?: AbortSignal, fetcher: typeof fetch = fetch) {
  const response = await fetcher(`${origin}/api/device-pair/${action}`, { method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store', signal: signal ?? AbortSignal.timeout(10000),
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  // Fixed server response bound; do not echo remote strings or URL capabilities.
  const reader = response.body?.getReader(); if (!reader) throw new Error('device_pair_unavailable');
  const parts: Uint8Array[] = []; let size = 0;
  try { while (true) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > 120000) { await reader.cancel(); throw new Error('device_pair_limit'); } parts.push(next.value); } }
  finally { reader.releaseLock(); }
  if (!response.ok) throw new Error(response.status === 409 ? 'device_pair_claimed' : response.status === 404 ? 'device_pair_expired' : 'device_pair_unavailable');
  const data = new Uint8Array(size); let offset = 0; for (const part of parts) { data.set(part, offset); offset += part.length; }
  return JSON.parse(decoder.decode(data));
}
export async function createPairingChannel(origin: string, fetcher: typeof fetch = fetch) {
  const channel = validatePairingChannel({ origin, id: random(), token: random(), key: random() }), ownerToken = random();
  await pairingRequest(origin, 'create', { id: channel.id, ownerToken, joinToken: channel.token }, undefined, undefined, fetcher);
  return { channel, ownerToken };
}
async function secret(channel: PairingChannel) {
  validatePairingChannel(channel); const raw = unhex(channel.key);
  try { return await crypto.subtle.importKey('raw', buffer(raw), 'AES-GCM', false, ['encrypt','decrypt']); } finally { raw.fill(0); }
}
export async function encryptPairingPacket(channel: PairingChannel, kind: 'request' | 'complete' | 'approval', value: unknown) {
  const plain = bytes.encode(canonicalJson(value)); if (plain.length > 65000) throw new Error('device_pair_limit');
  try {
    const iv = crypto.getRandomValues(new Uint8Array(12)), key = await secret(channel);
    const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: bytes.encode(`Automesh device pairing v1:${channel.id}:${kind}`) }, key, plain));
    const packet = new Uint8Array(iv.length + cipher.length); packet.set(iv); packet.set(cipher,12);
    return btoa(String.fromCharCode(...packet)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
  } finally { plain.fill(0); }
}
export async function decryptPairingPacket(channel: PairingChannel, kind: 'request' | 'complete' | 'approval', packet: unknown) {
  if (typeof packet !== 'string' || !/^[A-Za-z0-9_-]{32,90000}$/.test(packet)) throw new Error('device_pair_invalid');
  const cipher = Uint8Array.from(atob(packet.replaceAll('-','+').replaceAll('_','/')), c => c.charCodeAt(0)), key = await secret(channel);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buffer(cipher.subarray(0,12)), additionalData: bytes.encode(`Automesh device pairing v1:${channel.id}:${kind}`) }, key, buffer(cipher.subarray(12))));
  try { return JSON.parse(decoder.decode(plain)); } finally { plain.fill(0); }
}
export async function verifyPairingRequest(value: unknown, invitation: SignedObject) {
  const v = value as { invitation: string; request: SignedObject };
  if (!v || Object.keys(v).sort().join(',') !== 'invitation,request' || v.invitation !== invitation.record.id) throw new Error('device_pair_invalid');
  return verifyDeviceRequest(v.request, webCryptoEnvironment());
}
export async function submitPairingRequest(channel: PairingChannel, invitation: SignedObject, request: SignedObject) {
  const prior = await pairingRequest(channel.origin, 'mine', { id: channel.id }, channel.token);
  if (prior.request) {
    const saved = await decryptPairingPacket(channel, 'request', prior.request) as { invitation?: string; request?: SignedObject };
    if (saved.invitation !== invitation.record.id || canonicalJson(saved.request) !== canonicalJson(request)) throw new Error('device_pair_claimed');
    return;
  }
  const packet = await encryptPairingPacket(channel, 'request', { invitation: invitation.record.id, request });
  try { await pairingRequest(channel.origin, 'request', { id: channel.id, packet }, channel.token); }
  catch (error) { if (!(error instanceof Error) || error.message !== 'device_pair_claimed') throw error; await submitPairingRequest(channel, invitation, request); }
}
export async function pairingComplete(invitation: SignedObject, request: SignedObject, signer: IdentityProvider) {
  return signObject({ kind: 'document', audience: [invitation.record.author], expiresAt: Date.now() + 60000,
    body: { type: 'automesh-pair-complete-v1', invitation: invitation.record.id, request: request.record.id } }, signer, webCryptoEnvironment());
}
export async function verifyPairingComplete(value: unknown, invitation: SignedObject, request: SignedObject) {
  const signed = await verifyObject(value, webCryptoEnvironment()), r = signed.record, b = r.body as Record<string, unknown>;
  if (r.author !== request.record.author || r.kind !== 'document' || r.audience.length !== 1 || r.audience[0] !== invitation.record.author || !r.expiresAt || r.expiresAt-r.createdAt > 60000 || !b || Object.keys(b).sort().join(',') !== 'invitation,request,type' || b.type !== 'automesh-pair-complete-v1' || b.invitation !== invitation.record.id || b.request !== request.record.id) throw new Error('device_pair_invalid');
}
