import { cleanImageMetadata } from './image-privacy';
import { isValidAccountId } from '$lib/addressing/bech32m.js';

export const AVATAR_SIZE = 160;
export const MAX_AVATAR_BYTES = 12 * 1024;
export const AVATAR_PREFIX = 'data:image/jpeg;base64,';

// Raster JPEG only: no external URLs, SVG, huge decoded images or metadata.
export function normalizeAvatar(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > AVATAR_PREFIX.length + MAX_AVATAR_BYTES * 4 / 3 || !value.startsWith(AVATAR_PREFIX)) return null;
  const encoded = value.slice(AVATAR_PREFIX.length);
  if (!encoded || encoded.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null;
  try {
    const raw = atob(encoded);
    const bytes = Uint8Array.from(raw, char => char.charCodeAt(0));
    if (btoa(raw) !== encoded || bytes[0] !== 255 || bytes[1] !== 216) return null;
    const clean = cleanImageMetadata(bytes, 'image/jpeg').bytes;
    if (clean.length !== bytes.length || clean.some((byte, i) => byte !== bytes[i])) return null;
    let frames = 0;
    for (let pos = 2; pos + 2 <= bytes.length;) {
      if (bytes[pos++] !== 255) return null;
      while (bytes[pos] === 255) pos++;
      const marker = bytes[pos++];
      if (marker === 217) return frames === 1 && pos === bytes.length ? value : null;
      if (marker === 220) return null;
      const length = (bytes[pos] << 8) | bytes[pos + 1];
      if (length < 2 || pos + length > bytes.length) return null;
      if (marker === 192 || marker === 194) {
        if (length < 8 || ++frames !== 1) return null;
        const height = (bytes[pos + 3] << 8) | bytes[pos + 4];
        const width = (bytes[pos + 5] << 8) | bytes[pos + 6];
        if (!width || width > AVATAR_SIZE || width !== height) return null;
      } else if (marker >= 192 && marker <= 207 && ![196,200,204].includes(marker)) {
        return null;
      }
      pos += length;
      if (marker === 218) {
        while (pos < bytes.length) {
          if (bytes[pos] !== 255) { pos++; continue; }
          let next = pos + 1; while (bytes[next] === 255) next++;
          if (bytes[next] === 0 || bytes[next] >= 208 && bytes[next] <= 215) { pos = next + 1; continue; }
          break;
        }
      }
    }
    return null;
  } catch { return null; }
}

export function normalizePeerAvatars(value: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const [peer, raw] of Object.entries(value).slice(0, 256)) {
    const avatar = isValidAccountId(peer) ? normalizeAvatar(raw) : null;
    if (avatar) result[peer] = avatar;
  }
  return result;
}
