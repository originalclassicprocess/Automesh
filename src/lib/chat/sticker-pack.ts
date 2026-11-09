import { Unzip, UnzipInflate, zipSync, strToU8, strFromU8 } from 'fflate';
import { MAX_FILE_BYTES } from './file-transfer';
import { makePack, prepareMedia, PACK_ITEMS, type PreparedMedia, type StickerPack } from './media-library';

export type PreparedPack = { pack: StickerPack; files: PreparedMedia[] };
export function unpackBounded(bytes: Uint8Array): Map<string, Uint8Array> {
  if (bytes.length > MAX_FILE_BYTES || bytes.length < 4 || bytes[0] !== 80 || bytes[1] !== 75) throw new Error('Нужен ZIP до 20 МБ.');
  const output = new Map<string, Uint8Array>(); const seen = new Set<string>(); let total = 0, pending = 0, fileCount = 0;
  let failure: Error | null = null;
  const fail = (text: string) => { failure ??= new Error(text); throw failure; };
  const unzip = new Unzip(file => {
    if (failure) throw failure;
    const directory=file.name.endsWith('/'); const segments = (directory?file.name.slice(0,-1):file.name).split('/');
    if (seen.has(file.name) || seen.size >= PACK_ITEMS + 33 || file.name.length > 240 || /[\\:\u0000-\u001f\u007f]/.test(file.name) || segments.some(p=>!p || p==='.' || p==='..')) fail('Небезопасное имя или слишком много файлов в ZIP.');
    seen.add(file.name);
    if (!directory && file.name !== 'manifest.json' && ++fileCount > PACK_ITEMS) fail('Слишком много файлов в ZIP.');
    if (file.compression !== 0 && file.compression !== 8) fail('Неподдерживаемое сжатие ZIP.');
    const limit = directory ? 0 : file.name === 'manifest.json' ? 64 * 1024 : MAX_FILE_BYTES;
    if (file.originalSize !== undefined && file.originalSize > limit) fail('Слишком большой файл в ZIP.');
    let length = 0; const chunks: Uint8Array[] = []; pending++;
    file.ondata = (error, chunk, final) => {
      if (error) { file.terminate(); fail('Повреждённый ZIP.'); }
      if (failure) throw failure;
      length += chunk.length; total += chunk.length;
      if (length > limit || total > MAX_FILE_BYTES) { file.terminate(); fail('Распакованный набор превышает 20 МБ.'); }
      chunks.push(chunk.slice());
      if (final) { const result = new Uint8Array(length); let at = 0; for (const part of chunks) { result.set(part,at); at += part.length; } if (!directory) output.set(file.name,result); pending--; }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  // Small input windows bound transient expansion, not merely ZIP header sizes.
  for (let at = 0; at < bytes.length; at += 1024) unzip.push(bytes.subarray(at, at + 1024), at + 1024 >= bytes.length);
  if (failure) throw failure;
  if (pending || !output.size) throw new Error('Неполный ZIP.');
  return output;
}
export async function importStickerPack(bytes: Uint8Array, expectedId?: string, fallbackName = 'Импортированные стикеры'): Promise<PreparedPack> {
  const entries = unpackBounded(bytes); const manifestBytes = entries.get('manifest.json');
  if (!manifestBytes) {
    if (expectedId) throw new Error('В ZIP нет описания ожидаемого набора.');
    const files: PreparedMedia[]=[];
    for (const [path,content] of entries) files.push(await prepareMedia(content,path.split('/').at(-1)!));
    return {pack:await makePack(fallbackName.replace(/\.zip$/i,''),files),files};
  }
  let manifest: { type: string; version: number; name: string; items: { file: string; name: string; hash: string }[] };
  try { manifest = JSON.parse(strFromU8(manifestBytes)); } catch { throw new Error('Повреждённое описание набора.'); }
  if (!manifest || manifest.type !== 'automesh-sticker-pack' || manifest.version !== 1 || typeof manifest.name !== 'string' || manifest.name.length > 64 || !Array.isArray(manifest.items) || !manifest.items.length || manifest.items.length > PACK_ITEMS || entries.size !== manifest.items.length + 1) throw new Error('Неверное описание набора.');
  const files: PreparedMedia[] = []; const seen = new Set<string>();
  for (const item of manifest.items) {
    if (!item || typeof item.file !== 'string' || typeof item.name !== 'string' || item.name.length > 120 || seen.has(item.file) || item.file === 'manifest.json') throw new Error('Неверный стикер в наборе.');
    seen.add(item.file); const content = entries.get(item.file); if (!content) throw new Error('В наборе отсутствует файл.');
    const media = await prepareMedia(content,item.name); if (media.asset.hash !== item.hash) throw new Error('Контрольная сумма стикера не совпала.'); files.push(media);
  }
  const pack = await makePack(manifest.name, files);
  if (expectedId && pack.id !== expectedId) throw new Error('Набор не соответствует сообщению.');
  return { pack, files };
}
export function exportStickerPack(pack: StickerPack, files: PreparedMedia[]): Uint8Array {
  const entries: Record<string, Uint8Array> = {}; const items = pack.assets.map((hash,index) => {
    const media = files.find(f => f.asset.hash === hash); if (!media) throw new Error('Файл набора отсутствует.');
    const ext = media.asset.mime === 'image/png' ? 'png' : media.asset.mime === 'image/webp' ? 'webp' : 'gif';
    const file = `${index}.${ext}`; entries[file] = media.bytes; return { file, name: media.asset.name, hash };
  });
  entries['manifest.json'] = strToU8(JSON.stringify({ type: 'automesh-sticker-pack', version: 1, name: pack.name, items }));
  const zip = zipSync(entries, { level: 0, mtime: new Date(1980,0,1) });
  if (zip.length > MAX_FILE_BYTES) throw new Error('Архив превышает 20 МБ.');
  return zip;
}
