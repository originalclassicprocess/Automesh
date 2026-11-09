import { normalizeFileOffer, type FileOffer } from '$lib/chat/file-transfer';
import { base64, unbase64 } from './offline-crypto';
import { ATTACHMENT_PROTOCOL, ATTACHMENT_CHUNK_BYTES, FILE_POLICY_BYTES, validateAttachment, attachmentPartBytes } from './attachment-protocol.js';
export type Attachment = { protocol: string; id: string; size: number; chunks: number; chunkBytes: number; bytes: number; digest: string };
export type AttachmentManifest = { protocol: string; attachment: Attachment; offer: FileOffer; key: string; nonce: string; from: string; to: string };
export const FILE_CONTENT_PREFIX = '\u0000automesh-attachment-v1:';
export const EPHEMERAL_FILE_PREFIX = '\u0000automesh-attachment-v2:';
const buffer = (v: Uint8Array) => v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) as ArrayBuffer;
export async function attachmentHash(bytes: Uint8Array) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer(bytes)))].map(b => b.toString(16).padStart(2, '0')).join('');
}
export function validateManifest(m: AttachmentManifest, from: string, to: string, id: string): AttachmentManifest {
  validateAttachment(m?.attachment);
  const offer = normalizeFileOffer(m?.offer);
  if (m.protocol !== ATTACHMENT_PROTOCOL || !offer || offer.id !== id || offer.size !== m.attachment.size || m.from !== from || m.to !== to ||
      !/^[A-Za-z0-9_-]{43}$/.test(m.key) || !/^[A-Za-z0-9_-]{11}$/.test(m.nonce) ||
      base64(unbase64(m.key)) !== m.key || base64(unbase64(m.nonce)) !== m.nonce) throw new Error('invalid_attachment_manifest');
  return m;
}
async function part(m: AttachmentManifest, index: number, bytes: Uint8Array, encrypt: boolean) {
  const cipherSize = attachmentPartBytes(m.attachment, index);
  if (bytes.length !== cipherSize - (encrypt ? 16 : 0)) throw new Error('invalid_attachment_part');
  const raw = unbase64(m.key);
  try {
    const key = await crypto.subtle.importKey('raw', buffer(raw), 'AES-GCM', false, [encrypt ? 'encrypt' : 'decrypt']);
    const iv = new Uint8Array(12); iv.set(unbase64(m.nonce)); new DataView(iv.buffer).setUint32(8, index);
    const aad = new TextEncoder().encode(JSON.stringify([ATTACHMENT_PROTOCOL, m.from, m.to, m.offer.id, m.attachment.id, m.attachment.size, m.attachment.chunkBytes, index]));
    return new Uint8Array(await crypto.subtle[encrypt ? 'encrypt' : 'decrypt']({ name: 'AES-GCM', iv, additionalData: aad }, key, buffer(bytes)));
  } finally { raw.fill(0); }
}
export const encryptAttachmentPart = (m: AttachmentManifest, index: number, plain: Uint8Array) => part(m, index, plain, true);
export const decryptAttachmentPart = (m: AttachmentManifest, index: number, cipher: Uint8Array) => part(m, index, cipher, false);
export async function createAttachmentManifest(offer: FileOffer, bytes: Uint8Array, from: string, to: string): Promise<AttachmentManifest> {
  if (!normalizeFileOffer(offer) || bytes.length !== offer.size || bytes.length > FILE_POLICY_BYTES || await attachmentHash(bytes) !== offer.sha256) throw new Error('attachment_source_changed');
  const key = crypto.getRandomValues(new Uint8Array(32)), nonce = crypto.getRandomValues(new Uint8Array(8));
  const attachment: Attachment = { protocol: ATTACHMENT_PROTOCOL, id: crypto.randomUUID().replaceAll('-', ''), size: bytes.length,
    chunkBytes: ATTACHMENT_CHUNK_BYTES, chunks: Math.max(1, Math.ceil(bytes.length / ATTACHMENT_CHUNK_BYTES)), bytes: 0, digest: '0'.repeat(64) };
  attachment.bytes = attachment.size + attachment.chunks * 16;
  const m = { protocol: ATTACHMENT_PROTOCOL, offer, attachment, key: base64(key), nonce: base64(nonce), from, to }; key.fill(0); nonce.fill(0);
  const encoded = new Uint8Array(attachment.bytes); let offset = 0;
  try {
    for (let index = 0; index < attachment.chunks; index++) {
      const cipher = await encryptAttachmentPart(m, index, bytes.subarray(index * attachment.chunkBytes, Math.min(bytes.length, (index + 1) * attachment.chunkBytes)));
      encoded.set(cipher, offset); offset += cipher.length;
    }
    attachment.digest = await attachmentHash(encoded); return m;
  } finally { encoded.fill(0); }
}
