export const MAX_AVATAR_SOURCE_BYTES = 64 * 1024 * 1024;
export const MAX_AVATAR_SOURCE_PIXELS = 64_000_000;
export const AVATAR_PREVIEW_EDGE = 1280;
export function checkAvatarDimensions(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      width > 16384 || height > 16384 || width * height > MAX_AVATAR_SOURCE_PIXELS)
    throw new Error('Выберите фото до 64 мегапикселей.');
}
// A bounded header read rejects common decompression bombs before decoding.
// Unknown native formats (HEIC/AVIF) are checked after native decoding too.
export function avatarHeaderDimensions(b: Uint8Array): [number, number] | null {
  const d = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const ascii = (p:number,n:number) => String.fromCharCode(...b.subarray(p,p+n));
  if (b.length >= 24 && b[0] === 137 && ascii(1,3) === 'PNG' && ascii(12,4) === 'IHDR') return [d.getUint32(16),d.getUint32(20)];
  if (b.length >= 10 && /^GIF8[79]a$/.test(ascii(0,6))) return [d.getUint16(6,true),d.getUint16(8,true)];
  if (b.length >= 30 && ascii(0,4) === 'RIFF' && ascii(8,4) === 'WEBP') {
    const kind=ascii(12,4);
    if (kind==='VP8X') return [1+b[24]+(b[25]<<8)+(b[26]<<16),1+b[27]+(b[28]<<8)+(b[29]<<16)];
    if (kind==='VP8L' && b[20]===47) { const bits=d.getUint32(21,true); return [(bits&16383)+1,((bits>>>14)&16383)+1]; }
    if (kind==='VP8 ' && b[23]===157 && b[24]===1 && b[25]===42) return [d.getUint16(26,true)&16383,d.getUint16(28,true)&16383];
  }
  if (b.length >= 2 && b[0]===255 && b[1]===216) {
    let p=2;
    while (p+4<=b.length) {
      if (b[p++]!==255) break; while (b[p]===255) p++;
      const marker=b[p++]; if (marker===217 || marker===218) break;
      if (marker===1 || (marker>=208 && marker<=215)) continue;
      if (p+2>b.length) break;
      const length=d.getUint16(p); if (length<2 || p+length>b.length) break;
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker) && length>=8) return [d.getUint16(p+5),d.getUint16(p+3)];
      p+=length;
    }
  }
  return null;
}
