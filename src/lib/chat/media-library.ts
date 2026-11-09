import { MAX_FILE_BYTES, safeFileName, sha256Hex, FILE_UUID_RE } from './file-transfer';

export const LIBRARY_BYTES = 100 * 1024 * 1024;
export const LIBRARY_ITEMS = 1000;
export const PACK_ITEMS = 100;
export const HASH = /^[0-9a-f]{64}$/;
export type MediaAsset = { id: string; hash: string; name: string; mime: string; size: number; favorite: boolean; usedAt: number };
export type StickerPack = { id: string; name: string; assets: string[] };
export type MediaLibrary = { assets: MediaAsset[]; gifs: string[]; packs: StickerPack[] };
export type PreparedMedia = { asset: MediaAsset; bytes: Uint8Array };
export function emptyMediaLibrary(): MediaLibrary { return { assets: [], gifs: [], packs: [] }; }
// Random storage names do not expose content fingerprints across profiles.
export function libraryFileId(id: string): string { if (!FILE_UUID_RE.test(id)) throw new Error('invalid_media_id'); return `media-library:${id}`; }
export function isLibraryFileId(id: string): boolean { return id.startsWith('media-library:') && FILE_UUID_RE.test(id.slice('media-library:'.length)); }
export function mediaName(value: unknown): string {
  return typeof value === 'string' ? safeFileName(value).slice(0, 64) : 'Набор';
}
export function normalizeMediaLibrary(raw: unknown): MediaLibrary {
  const empty = emptyMediaLibrary();
  if (!raw || typeof raw !== 'object') return empty;
  const value = raw as MediaLibrary;
  let size = 0;
  if (Array.isArray(value.assets)) for (const asset of value.assets.slice(0, LIBRARY_ITEMS)) {
    if (!asset || !FILE_UUID_RE.test(asset.id) || !HASH.test(asset.hash) || empty.assets.some(a => a.hash === asset.hash || a.id === asset.id) ||
      !['image/png', 'image/webp', 'image/gif'].includes(asset.mime) || !Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > MAX_FILE_BYTES || size + asset.size > LIBRARY_BYTES) continue;
    empty.assets.push({ id: asset.id, hash: asset.hash, name: mediaName(asset.name), mime: asset.mime, size: asset.size,
      favorite: asset.favorite === true, usedAt: Number.isSafeInteger(asset.usedAt) && asset.usedAt > 0 ? asset.usedAt : 0 }); size += asset.size;
  }
  const exists = (hash: string) => empty.assets.some(a => a.hash === hash);
  empty.gifs = Array.isArray(value.gifs) ? [...new Set(value.gifs.filter(hash => exists(hash) && empty.assets.find(a => a.hash === hash)?.mime === 'image/gif'))].slice(0, LIBRARY_ITEMS) : [];
  if (Array.isArray(value.packs)) for (const pack of value.packs.slice(0, 32)) {
    if (!pack || !HASH.test(pack.id) || empty.packs.some(p => p.id === pack.id) || !Array.isArray(pack.assets)) continue;
    const assets = [...new Set(pack.assets.filter(exists))].slice(0, PACK_ITEMS);
    if (assets.length) empty.packs.push({ id: pack.id, name: mediaName(pack.name), assets });
  }
  return empty;
}
// Check dimensions before a browser image decoder sees untrusted bytes.
export function imageKind(bytes: Uint8Array): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0, height = 0, mime = '';
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  if (bytes.length >= 24 && [137,80,78,71,13,10,26,10].every((n,i) => bytes[i] === n) && ascii(12,16) === 'IHDR') {
    mime = 'image/png'; width = view.getUint32(16); height = view.getUint32(20);
  } else if (bytes.length >= 13 && /^GIF8[79]a$/.test(ascii(0,6))) {
    mime = 'image/gif'; width = view.getUint16(6,true); height = view.getUint16(8,true);
  } else if (bytes.length >= 30 && ascii(0,4) === 'RIFF' && ascii(8,12) === 'WEBP') {
    mime = 'image/webp'; const kind = ascii(12,16);
    if (kind === 'VP8X') { width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16); height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16); }
    else if (kind === 'VP8L' && bytes[20] === 47) { const bits = view.getUint32(21,true); width = (bits & 16383) + 1; height = ((bits >>> 14) & 16383) + 1; }
    else if (kind === 'VP8 ' && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42) { width = view.getUint16(26,true) & 16383; height = view.getUint16(28,true) & 16383; }
  }
  if (!mime || width < 1 || height < 1 || width > 4096 || height > 4096 || width * height > 8_000_000) throw new Error('Нужны PNG, WebP или GIF размером не более 4096 px и 8 Мп.');
  return mime;
}
export async function prepareMedia(bytes: Uint8Array, name: string): Promise<PreparedMedia> {
  if (bytes.length < 1 || bytes.length > MAX_FILE_BYTES) throw new Error('Один файл — до 20 МБ.');
  const mime = imageKind(bytes);
  return { bytes, asset: { id: crypto.randomUUID(), hash: await sha256Hex(bytes), name: mediaName(name), mime, size: bytes.length, favorite: false, usedAt: 0 } };
}
export async function makePack(name: string, files: PreparedMedia[]): Promise<StickerPack> {
  const assets = [...new Set(files.map(f => f.asset.hash))];
  if (!assets.length || assets.length > PACK_ITEMS || files.reduce((s,f) => s + f.bytes.length,0) > MAX_FILE_BYTES - 128 * 1024) throw new Error('Набор — до 100 стикеров и 20 МБ с учётом архива.');
  const packName = mediaName(name);
  const id = await sha256Hex(new TextEncoder().encode(JSON.stringify({ name: packName, assets })));
  return { id, name: packName, assets };
}
export function addMedia(library: MediaLibrary, files: PreparedMedia[], pack?: StickerPack): MediaLibrary {
  const next: MediaLibrary = JSON.parse(JSON.stringify(library));
  for (const { asset } of files) if (!next.assets.some(a => a.hash === asset.hash)) next.assets.push(asset);
  if (pack) { if (!next.packs.some(p => p.id === pack.id)) next.packs.push(pack); }
  else for (const { asset } of files) {
    if (asset.mime !== 'image/gif') throw new Error('В раздел GIF можно добавить только GIF.');
    if (!next.gifs.includes(asset.hash)) next.gifs.push(asset.hash);
  }
  if (next.assets.length > LIBRARY_ITEMS || next.packs.length > 32 || next.assets.reduce((s,a) => s+a.size,0) > LIBRARY_BYTES) throw new Error('Библиотека заполнена: до 100 МБ, 1000 файлов и 32 наборов. Удалите ненужное.');
  return next;
}
export function pruneMedia(library: MediaLibrary): MediaLibrary {
  const hashes = new Set([...library.gifs, ...library.packs.flatMap(p => p.assets)]);
  return { ...library, assets: library.assets.filter(a => hashes.has(a.hash)) };
}
