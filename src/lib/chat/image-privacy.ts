// Client-only, lossless metadata filtering before hashing/encryption. Pixel
// streams, animation, colour profiles and essential orientation are retained.
// Never mutate the source bytes or silently send an unsupported image as clean.
const text = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes);
export class UnsupportedImagePrivacy extends Error {
  constructor() { super('Этот формат изображения не удалось очистить. Отключите очистку в настройках файлов, только если готовы отправить оригинал.'); }
}
const ascii = (value: string) => new TextEncoder().encode(value);
const matches = (bytes: Uint8Array, prefix: Uint8Array) => prefix.every((byte, i) => bytes[i] === byte);
function join(parts: Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0; for (const part of parts) { bytes.set(part, at); at += part.length; } return bytes;
}
function orientation(tiff: Uint8Array): number | undefined {
  if (tiff.length < 8) return;
  const little = text(tiff.subarray(0, 2)) === 'II';
  if (!little && text(tiff.subarray(0, 2)) !== 'MM') return;
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  if (view.getUint16(2, little) !== 42) return;
  const offset = view.getUint32(4, little);
  if (offset < 8 || offset + 2 > tiff.length) return;
  const count = view.getUint16(offset, little);
  if (count > 4096 || offset + 2 + count * 12 + 4 > tiff.length) return;
  for (let i = 0; i < count; i++) {
    const at = offset + 2 + i * 12;
    if (view.getUint16(at, little) === 0x112 && view.getUint16(at + 2, little) === 3 && view.getUint32(at + 4, little) === 1) {
      const value = view.getUint16(at + 8, little); if (value >= 1 && value <= 8) return value;
    }
  }
}
function orientationOnly(value: number): Uint8Array {
  const bytes = new Uint8Array(26), view = new DataView(bytes.buffer);
  bytes.set(ascii('II')); view.setUint16(2, 42, true); view.setUint32(4, 8, true);
  view.setUint16(8, 1, true); view.setUint16(10, 0x112, true); view.setUint16(12, 3, true);
  view.setUint32(14, 1, true); view.setUint16(18, value, true); return bytes;
}
function exifOrientation(bytes: Uint8Array): number | undefined {
  return orientation(matches(bytes, ascii('Exif\0\0')) ? bytes.subarray(6) : bytes);
}
function jpegSegment(marker: number, payload: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(payload.length + 4); bytes.set([255, marker]);
  new DataView(bytes.buffer).setUint16(2, payload.length + 2); bytes.set(payload, 4); return bytes;
}
function jpeg(bytes: Uint8Array): Uint8Array {
  const parts = [bytes.subarray(0, 2)]; let at = 2, scanned = false;
  while (at < bytes.length) {
    if (bytes[at++] !== 255) throw new Error('invalid_image');
    while (bytes[at] === 255) at++;
    const marker = bytes[at++];
    if (marker === 0xd9) { if (!scanned) throw new Error('invalid_image'); parts.push(new Uint8Array([255, marker])); return join(parts); }
    if (marker === 0 || marker === 0xd8 || marker === undefined) throw new Error('invalid_image');
    if (marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) { parts.push(new Uint8Array([255, marker])); continue; }
    if (at + 2 > bytes.length) throw new Error('invalid_image');
    const length = new DataView(bytes.buffer, bytes.byteOffset + at, 2).getUint16(0);
    if (length < 2 || at + length > bytes.length) throw new Error('invalid_image');
    const payload = bytes.subarray(at + 2, at + length);
    if (marker === 0xe1 && matches(payload, ascii('Exif\0\0'))) {
      const value = exifOrientation(payload);
      if (value && value !== 1) parts.push(jpegSegment(marker, join([ascii('Exif\0\0'), orientationOnly(value)])));
    } else if (!(marker >= 0xe0 && marker <= 0xef) && marker !== 0xfe ||
      marker === 0xe2 && matches(payload, ascii('ICC_PROFILE\0')) || marker === 0xee && matches(payload, ascii('Adobe'))) {
      parts.push(jpegSegment(marker, payload));
    }
    at += length;
    if (marker === 0xda) {
      scanned = true; const start = at;
      while (at < bytes.length) {
        if (bytes[at] !== 255) { at++; continue; }
        let next = at + 1; while (bytes[next] === 255) next++;
        if (bytes[next] === 0 || bytes[next] >= 0xd0 && bytes[next] <= 0xd7) { at = next + 1; continue; }
        break;
      }
      parts.push(bytes.subarray(start, at));
    }
  }
  throw new Error('invalid_image');
}
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const pngKept = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT', 'acTL', 'fcTL', 'fdAT', 'cICP', 'mDCV', 'cLLI']);
const crcTable = Uint32Array.from({ length: 256 }, (_, byte) => {
  let value = byte; for (let i = 0; i < 8; i++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); return value >>> 0;
});
function crc(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) value = (value >>> 8) ^ crcTable[(value ^ byte) & 255];
  return (value ^ 0xffffffff) >>> 0;
}
function pngChunk(kind: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(data.length + 12), view = new DataView(chunk.buffer);
  view.setUint32(0, data.length); chunk.set(ascii(kind), 4); chunk.set(data, 8);
  view.setUint32(chunk.length - 4, crc(chunk.subarray(4, chunk.length - 4))); return chunk;
}
function png(bytes: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [PNG]; let at = 8, imageData = false;
  while (at + 12 <= bytes.length) {
    const length = new DataView(bytes.buffer, bytes.byteOffset + at, 4).getUint32(0), end = at + 12 + length;
    if (end > bytes.length) throw new Error('invalid_image');
    const kind = text(bytes.subarray(at + 4, at + 8));
    if (!/^[A-Za-z]{4}$/.test(kind) || at === 8 && (kind !== 'IHDR' || length !== 13)) throw new Error('invalid_image');
    if (crc(bytes.subarray(at + 4, end - 4)) !== new DataView(bytes.buffer, bytes.byteOffset + end - 4, 4).getUint32(0)) throw new Error('invalid_image');
    if (pngKept.has(kind)) parts.push(bytes.subarray(at, end));
    else if (kind === 'eXIf') { const value = exifOrientation(bytes.subarray(at + 8, end - 4)); if (value && value !== 1) parts.push(pngChunk(kind, orientationOnly(value))); }
    else if (kind[0] === kind[0].toUpperCase()) throw new Error('unsupported_image_chunk');
    if (kind === 'IDAT') imageData = true;
    if (kind === 'IEND') { if (length !== 0 || !imageData) throw new Error('invalid_image'); return join(parts); }
    at = end;
  }
  throw new Error('invalid_image');
}
function webpChunk(kind: string, data: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(8 + data.length + data.length % 2); bytes.set(ascii(kind));
  new DataView(bytes.buffer).setUint32(4, data.length, true); bytes.set(data, 8); return bytes;
}
function webp(bytes: Uint8Array): Uint8Array {
  const end = new DataView(bytes.buffer, bytes.byteOffset + 4, 4).getUint32(0, true) + 8;
  if (end > bytes.length || end < 12) throw new Error('invalid_image');
  const parts: Uint8Array[] = []; let at = 12, hasImage = false, value: number | undefined;
  while (at + 8 <= end) {
    const length = new DataView(bytes.buffer, bytes.byteOffset + at + 4, 4).getUint32(0, true), next = at + 8 + length + length % 2;
    if (next > end) throw new Error('invalid_image');
    const kind = text(bytes.subarray(at, at + 4)), data = bytes.subarray(at + 8, at + 8 + length);
    if (['VP8X', 'VP8 ', 'VP8L', 'ALPH', 'ANIM', 'ANMF', 'ICCP'].includes(kind)) parts.push(webpChunk(kind, data));
    if (kind === 'VP8 ' || kind === 'VP8L' || kind === 'ANMF') hasImage = true;
    if (kind === 'EXIF') value = exifOrientation(data);
    at = next;
  }
  if (at !== end || !hasImage) throw new Error('invalid_image');
  const extended = parts.find(part => text(part.subarray(0, 4)) === 'VP8X');
  if (extended) { if (extended.length !== 18) throw new Error('invalid_image'); extended[8] &= ~0x0c; }
  if (value && value !== 1) {
    if (!extended) throw new Error('invalid_image'); extended[8] |= 0x08;
    parts.push(webpChunk('EXIF', orientationOnly(value)));
  }
  const payload = join(parts), header = join([ascii('RIFF'), new Uint8Array(4), ascii('WEBP')]);
  new DataView(header.buffer).setUint32(4, payload.length + 4, true); return join([header, payload]);
}
export function cleanImageMetadata(bytes: Uint8Array, mime: string): { bytes: Uint8Array; mime: string } {
  if (bytes[0] === 255 && bytes[1] === 216) return { bytes: jpeg(bytes), mime: 'image/jpeg' };
  if (matches(bytes, PNG)) return { bytes: png(bytes), mime: 'image/png' };
  if (bytes.length >= 12 && text(bytes.subarray(0, 4)) === 'RIFF' && text(bytes.subarray(8, 12)) === 'WEBP') return { bytes: webp(bytes), mime: 'image/webp' };
  // GIFs are animation files, outside this photo/screenshot setting.
  if (matches(bytes, ascii('GIF87a')) || matches(bytes, ascii('GIF89a'))) return { bytes, mime: 'image/gif' };
  if (mime.toLowerCase().startsWith('image/')) throw new UnsupportedImagePrivacy();
  return { bytes, mime };
}
