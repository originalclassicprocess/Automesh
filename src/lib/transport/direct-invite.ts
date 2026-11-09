import { isValidAccountId } from '$lib/addressing/bech32m.js';
import { getAccountId } from '$lib/addressing/address';
import { bytesToHex, hexToBytes } from '$lib/message/encoding';
import { WebCryptoIdentity } from '$lib/identity/webcrypto';
import type { TransportRegistrationIdentity } from './transport';

export const DIRECT_LIFETIME_MS = 5 * 60_000;
const MAX_PACKET_BYTES = 32_768;
const MAX_ENCODED = 16_000;
const PREFIX = 'mesh-direct1:';
const QR_PART_LENGTH = 350;
export type DirectInvite = {
  type: 'mesh-direct'; version: 1; kind: 'offer' | 'answer'; session: string;
  from: string; to: string; created: number; expires: number; publicKey: string;
  sdp: string; replyTo: string; signature: string;
};

function signBytes(packet: Omit<DirectInvite, 'signature'>): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(['MeshAutonomy direct pairing v1', packet.type,
    packet.version, packet.kind, packet.session, packet.from, packet.to, packet.created,
    packet.expires, packet.publicKey, packet.sdp, packet.replyTo]));
}

export async function inviteHash(packet: DirectInvite): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(JSON.stringify([Array.from(signBytes(packet)), packet.signature])))));
}

export async function signDirectInvite(packet: Omit<DirectInvite, 'signature' | 'publicKey'>,
  identity: TransportRegistrationIdentity): Promise<DirectInvite> {
  const unsigned = { ...packet, publicKey: bytesToHex(identity.publicKey) };
  if (await getAccountId(unsigned.publicKey) !== packet.from) throw new Error('direct_identity_mismatch');
  return { ...unsigned, signature: bytesToHex(await identity.sign(signBytes(unsigned))) };
}

export function validateDirectSdp(sdp: unknown): asserts sdp is string {
  if (typeof sdp !== 'string' || sdp.length > 24_000 || !sdp.startsWith('v=0\r\n') ||
      !/^m=application .*webrtc-datachannel\r?$/m.test(sdp) || /^m=(audio|video) /m.test(sdp) ||
      !/^a=fingerprint:sha-256 [A-Fa-f0-9:]+\r?$/m.test(sdp)) throw new Error('direct_sdp_invalid');
  const candidates = sdp.split(/\r?\n/).filter((line) => line.startsWith('a=candidate:'));
  if (!candidates.length) throw new Error('direct_no_candidates');
  if (candidates.length > 64 || candidates.some((line) => line.length > 1024 || !/ typ host(?: |$)/.test(line)))
    throw new Error('direct_sdp_invalid');
}

export async function verifyDirectInvite(value: unknown, now = Date.now()): Promise<DirectInvite> {
  const p = value as DirectInvite;
  if (!p || typeof p !== 'object' || p.type !== 'mesh-direct' || p.version !== 1 ||
      !['offer', 'answer'].includes(p.kind) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(p.session) ||
      !isValidAccountId(p.from) || (p.kind === 'offer' ? p.to !== '' || p.replyTo !== '' :
        !isValidAccountId(p.to) || !/^[0-9a-f]{64}$/.test(p.replyTo)) ||
      !Number.isSafeInteger(p.created) || !Number.isSafeInteger(p.expires) ||
      p.created > now + 30_000 || p.expires <= now || p.expires - p.created > DIRECT_LIFETIME_MS ||
      p.expires <= p.created || !/^04[0-9a-f]{128}$/.test(p.publicKey) ||
      !/^[0-9a-f]{128}$/.test(p.signature)) throw new Error('direct_invite_invalid_or_expired');
  validateDirectSdp(p.sdp);
  if (await getAccountId(p.publicKey) !== p.from || !await new WebCryptoIdentity().verifyWithPublicKey(
      hexToBytes(p.publicKey), signBytes(p), hexToBytes(p.signature))) throw new Error('direct_signature_invalid');
  return p;
}

// Native streams are bundled browser APIs: no CDN, external lookup or secret in the QR.
// Decoding is bounded *during* decompression, not only after allocating the result.
async function transform(bytes: Uint8Array, decompress: boolean): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(decompress
    ? new DecompressionStream('deflate') : new CompressionStream('deflate'));
  const reader = stream.getReader(); const parts: Uint8Array[] = []; let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.length;
      if (total > MAX_PACKET_BYTES) throw new Error('direct_invite_too_large');
      parts.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const result = new Uint8Array(total); let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

export async function encodeDirectInvite(packet: DirectInvite): Promise<string> {
  const bytes = await transform(new TextEncoder().encode(JSON.stringify(packet)), false);
  const encoded = PREFIX + btoa(String.fromCharCode(...bytes));
  if (encoded.length > MAX_ENCODED) throw new Error('direct_invite_too_large');
  return encoded;
}

export async function decodeDirectInvite(text: string): Promise<DirectInvite> {
  if (text.length > MAX_ENCODED || !text.startsWith(PREFIX) || !/^[A-Za-z0-9+/=]+$/.test(text.slice(PREFIX.length)))
    throw new Error('not_direct_invite');
  const bytes = Uint8Array.from(atob(text.slice(PREFIX.length)), (c) => c.charCodeAt(0));
  return verifyDirectInvite(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await transform(bytes, true))));
}

async function groupId(text: string): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))).slice(0, 32);
}

export async function directQrFrames(text: string): Promise<string[]> {
  if (text.length > MAX_ENCODED || !text.startsWith(PREFIX)) throw new Error('not_direct_invite');
  const id = await groupId(text); const count = Math.ceil(text.length / QR_PART_LENGTH);
  return Array.from({ length: count }, (_, i) => `mesh-qr1:${id}:${i + 1}:${count}:${text.slice(i * QR_PART_LENGTH, (i + 1) * QR_PART_LENGTH)}`);
}

export class DirectQrCollector {
  private id = ''; private count = 0; private pieces = new Map<number, string>();
  get progress(): string { return `${this.pieces.size}/${this.count || '?'}`; }
  get seenParts(): number[] { return [...this.pieces.keys()]; }
  get partCount(): number { return this.count; }
  reset(): void { this.id = ''; this.count = 0; this.pieces.clear(); }
  async add(text: string): Promise<string | null> {
    if (text.startsWith(PREFIX) && text.length <= MAX_ENCODED) { this.reset(); return text; }
    const match = /^mesh-qr1:([0-9a-f]{32}):(\d{1,2}):(\d{1,2}):([\s\S]{1,350})$/.exec(text);
    if (!match) throw new Error('not_direct_qr');
    const index = Number(match[2]); const count = Number(match[3]);
    if (index < 1 || index > count || count > Math.ceil(MAX_ENCODED / QR_PART_LENGTH) || (this.id && (this.id !== match[1] || this.count !== count)))
      throw new Error('direct_qr_different_session');
    this.id = match[1]; this.count = count;
    if (this.pieces.has(index) && this.pieces.get(index) !== match[4]) throw new Error('direct_qr_conflict');
    this.pieces.set(index, match[4]);
    if (this.pieces.size !== count) return null;
    const result = Array.from({ length: count }, (_, i) => this.pieces.get(i + 1)!).join('');
    if (result.length > MAX_ENCODED || await groupId(result) !== this.id) throw new Error('direct_qr_damaged');
    this.reset(); return result;
  }
}
