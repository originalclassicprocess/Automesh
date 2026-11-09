// Bounded v1 file transfer over the existing authenticated encrypted session.
import { normalizeMessageDetails, type MessageDetails } from './message-details';
import { FILE_POLICY_BYTES } from '$lib/node/attachment-protocol.js';
export const MAX_FILE_BYTES = FILE_POLICY_BYTES;
export const FILE_CHUNK_BYTES = 16 * 1024;
export const FILE_CHUNK_HEADER = new Uint8Array([0, 0x4d, 0x46, 0x43, 1]);
export const FILE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type FileOffer = {
  id: string;
  name: string;
  size: number;
  mime: string;
  sha256: string;
  details?: MessageDetails;
};

export function safeFileName(value: string): string {
  const cleaned = value.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_').trim().slice(0, 120);
  return cleaned && cleaned !== '.' && cleaned !== '..' ? cleaned : 'file';
}

export function normalizeFileOffer(raw: unknown): FileOffer | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.id !== 'string' || !FILE_UUID_RE.test(value.id) ||
    typeof value.name !== 'string' || value.name.length > 120 || !value.name.trim() ||
    safeFileName(value.name) !== value.name ||
    !Number.isSafeInteger(value.size) || (value.size as number) < 0 || (value.size as number) > MAX_FILE_BYTES ||
    typeof value.mime !== 'string' || value.mime.length > 100 || /[\u0000-\u001f\u007f]/.test(value.mime) ||
    typeof value.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(value.sha256)) return null;
  const details = value.details === undefined ? undefined : normalizeMessageDetails(value.details);
  if (details === null || details?.pin || details?.ephemeralOpened) return null;
  return { id: value.id, name: value.name, size: value.size as number, mime: value.mime, sha256: value.sha256,
    ...(details ? { details } : {}) };
}

export function encodeFileChunk(id: string, index: number, bytes: Uint8Array): Uint8Array {
  if (!FILE_UUID_RE.test(id) || !Number.isSafeInteger(index) || index < 0 || index > 0xffffffff ||
    bytes.length < 1 || bytes.length > FILE_CHUNK_BYTES) throw new Error('invalid_file_chunk');
  const frame = new Uint8Array(FILE_CHUNK_HEADER.length + 36 + 4 + bytes.length);
  frame.set(FILE_CHUNK_HEADER);
  frame.set(new TextEncoder().encode(id.toLowerCase()), FILE_CHUNK_HEADER.length);
  new DataView(frame.buffer).setUint32(FILE_CHUNK_HEADER.length + 36, index);
  frame.set(bytes, FILE_CHUNK_HEADER.length + 40);
  return frame;
}

export function decodeFileChunk(frame: Uint8Array): { id: string; index: number; bytes: Uint8Array } | null {
  if (frame.length < FILE_CHUNK_HEADER.length || !FILE_CHUNK_HEADER.every((byte, index) => frame[index] === byte)) return null;
  const offset = FILE_CHUNK_HEADER.length;
  if (frame.length < offset + 40 + 1 || frame.length > offset + 40 + FILE_CHUNK_BYTES) throw new Error('invalid_file_chunk');
  const id = new TextDecoder().decode(frame.slice(offset, offset + 36));
  if (!FILE_UUID_RE.test(id)) throw new Error('invalid_file_chunk_id');
  return { id, index: new DataView(frame.buffer, frame.byteOffset + offset + 36, 4).getUint32(0), bytes: frame.slice(offset + 40) };
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const input = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
