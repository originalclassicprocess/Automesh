import { describe, expect, it } from 'vitest';
import { zlibSync } from 'fflate';
import { cleanImageMetadata } from './image-privacy';
const ascii = (s: string) => new TextEncoder().encode(s);
const concat = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap(p => [...p]));
const contains = (bytes: Uint8Array, part: Uint8Array) => bytes.some((_, at) => part.every((byte, index) => bytes[at + index] === byte));
const exif = () => {
  const bytes = new Uint8Array(26), v = new DataView(bytes.buffer); bytes.set(ascii('II'));
  v.setUint16(2, 42, true); v.setUint32(4, 8, true); v.setUint16(8, 1, true);
  v.setUint16(10, 0x112, true); v.setUint16(12, 3, true); v.setUint32(14, 1, true); v.setUint16(18, 6, true);
  return concat(bytes, ascii('GPS private date Android unique-id'));
};
function segment(marker: number, payload: Uint8Array) {
  const length = payload.length + 2; return concat(new Uint8Array([255, marker, length >> 8, length & 255]), payload);
}
function crc(bytes: Uint8Array) {
  let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let i = 0; i < 8; i++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); }
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(kind: string, data: Uint8Array) {
  const bytes = new Uint8Array(12 + data.length), view = new DataView(bytes.buffer);
  view.setUint32(0, data.length); bytes.set(ascii(kind), 4); bytes.set(data, 8); view.setUint32(bytes.length - 4, crc(bytes.subarray(4, bytes.length - 4))); return bytes;
}
function webChunk(kind: string, data: Uint8Array) {
  const bytes = new Uint8Array(8 + data.length + data.length % 2); bytes.set(ascii(kind));
  new DataView(bytes.buffer).setUint32(4, data.length, true); bytes.set(data, 8); return bytes;
}
function riff(...parts: Uint8Array[]) {
  const data = concat(...parts), head = concat(ascii('RIFF'), new Uint8Array(4), ascii('WEBP'));
  new DataView(head.buffer).setUint32(4, data.length + 4, true); return concat(head, data);
}
describe('lossless client image privacy', () => {
  it('removes JPEG EXIF, XMP, comments, thumbnails and trailing data but preserves essential orientation and exact progressive scans', () => {
    const pixels = new Uint8Array([1, 2, 255, 0, 7, 255, 0xd1, 3]);
    const scans = concat(segment(0xda, new Uint8Array([0])), pixels, segment(0xc4, ascii('table')), segment(0xda, new Uint8Array([0])), pixels);
    const source = concat(new Uint8Array([255, 216]), segment(0xe1, concat(ascii('Exif\0\0'), exif())),
      segment(0xe1, ascii('XMP private date')), segment(0xe0, ascii('JFIF thumbnail private')),
      segment(0xfe, ascii('private comment')), segment(0xe2, ascii('ICC_PROFILE\0colour')),
      scans, new Uint8Array([255, 217]), ascii('private trailing data'));
    const original = source.slice(), cleaned = cleanImageMetadata(source, 'image/jpeg');
    const readable = new TextDecoder().decode(cleaned.bytes);
    expect(source).toEqual(original); expect(readable).not.toContain('private'); expect(readable).not.toContain('unique-id');
    expect(readable).toContain('ICC_PROFILE');
    expect(contains(cleaned.bytes, scans)).toBe(true);
    expect(cleanImageMetadata(cleaned.bytes, cleaned.mime)).toEqual(cleaned);
    expect(() => cleanImageMetadata(source.subarray(0, source.length - 30), 'image/jpeg')).toThrow();
  });
  it('removes PNG metadata and trailing payload without changing IDAT, colours or APNG animation chunks', () => {
    const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const header = new Uint8Array(13); new DataView(header.buffer).setUint32(0, 1); new DataView(header.buffer).setUint32(4, 1); header[8] = 8; header[9] = 6;
    const idat = chunk('IDAT', zlibSync(new Uint8Array([0, 255, 0, 0, 255]))), animation = chunk('acTL', new Uint8Array(8));
    const source = concat(signature, chunk('IHDR', header), chunk('tEXt', ascii('Comment\0private')),
      chunk('iTXt', ascii('XMP private')), chunk('zTXt', ascii('private')), chunk('eXIf', exif()), chunk('sRGB', new Uint8Array([0])), animation,
      idat, chunk('IEND', new Uint8Array()), ascii('private trailing data'));
    const original = source.slice(), cleaned = cleanImageMetadata(source, 'image/png');
    expect(source).toEqual(original); expect(new TextDecoder().decode(cleaned.bytes)).not.toContain('private');
    expect(contains(cleaned.bytes, idat)).toBe(true);
    expect(contains(cleaned.bytes, animation)).toBe(true);
    expect(cleanImageMetadata(cleaned.bytes, cleaned.mime)).toEqual(cleaned);
    const bad = source.slice(); bad[15] ^= 1; expect(() => cleanImageMetadata(bad, 'image/png')).toThrow('invalid_image');
  });
  it('keeps WebP pixels, alpha, animations and ICC; fixes metadata flags and RIFF length', () => {
    const header = new Uint8Array(10); header[0] = 0x3e;
    const pixels = webChunk('VP8 ', ascii('pixel stream')), animation = webChunk('ANMF', new Uint8Array(16));
    const source = riff(webChunk('VP8X', header), webChunk('ICCP', ascii('colour')), webChunk('EXIF', exif()), webChunk('XMP ', ascii('private')),
      webChunk('ANIM', new Uint8Array(6)), animation, pixels);
    const original = source.slice(), cleaned = cleanImageMetadata(source, 'image/webp');
    expect(source).toEqual(original); expect(new TextDecoder().decode(cleaned.bytes)).not.toContain('private');
    expect(contains(cleaned.bytes, pixels)).toBe(true);
    expect(contains(cleaned.bytes, animation)).toBe(true);
    expect(cleaned.bytes[20]).toBe(0x3a); // XMP removed; essential orientation retained.
    expect(new DataView(cleaned.bytes.buffer).getUint32(4, true)).toBe(cleaned.bytes.length - 8);
    expect(cleanImageMetadata(cleaned.bytes, cleaned.mime)).toEqual(cleaned);
    expect(() => cleanImageMetadata(source.subarray(0, source.length - 1), 'image/webp')).toThrow();
  });
  it('does not touch GIF, audio, video or documents, and never silently passes unsupported images as cleaned', () => {
    const gif = ascii('GIF89aanimated original'); expect(cleanImageMetadata(gif, 'image/gif').bytes).toBe(gif);
    for (const mime of ['audio/mpeg', 'video/mp4', 'application/pdf']) {
      const data = ascii('original bytes'); expect(cleanImageMetadata(data, mime).bytes).toBe(data);
    }
    expect(() => cleanImageMetadata(ascii('heic'), 'image/heic')).toThrow('очистить');
    expect(() => cleanImageMetadata(ascii('<svg/>'), 'image/svg+xml')).toThrow();
  });
});
