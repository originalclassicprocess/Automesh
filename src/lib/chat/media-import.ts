import { LIBRARY_BYTES, PACK_ITEMS, makePack, prepareMedia, type PreparedMedia } from './media-library';
import { importStickerPack, type PreparedPack } from './sticker-pack';
import { MAX_FILE_BYTES } from './file-transfer';

export type ImportFile = Pick<File, 'name' | 'size' | 'type' | 'arrayBuffer'>;
export type MediaImport = { kind: 'gifs'; files: PreparedMedia[] } | ({ kind: 'pack' } & PreparedPack);

// Both the picker and drag-and-drop use the same bounded, all-or-nothing preparation.
export async function prepareMediaImport(files: ImportFile[], tab: 'gifs' | 'stickers', name: string): Promise<MediaImport> {
  if (!files.length || files.length > PACK_ITEMS) throw new Error('Выберите от 1 до 100 файлов за одно добавление.');
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (files.some(file => !Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_FILE_BYTES)) throw new Error('Один файл — до 20 МБ, пустые файлы не поддерживаются.');
  if (total > (tab === 'gifs' ? LIBRARY_BYTES : MAX_FILE_BYTES)) throw new Error(tab === 'gifs' ? 'До 100 МБ за одно добавление GIF.' : 'Набор — до 20 МБ.');
  const isZip = (file: ImportFile) => /\.zip$/i.test(file.name) || ['application/zip', 'application/x-zip-compressed'].includes(file.type);
  if (files.some(isZip)) {
    if (tab !== 'stickers' || files.length !== 1) throw new Error('В разделе «Стикеры» добавьте один ZIP отдельно от картинок.');
    return { kind: 'pack', ...await importStickerPack(new Uint8Array(await files[0].arrayBuffer()), undefined, files[0].name) };
  }
  const prepared: PreparedMedia[] = [];
  for (const file of files) {
    const media = await prepareMedia(new Uint8Array(await file.arrayBuffer()), file.name);
    if (media.bytes.length !== file.size) throw new Error('Размер файла изменился. Выберите его заново.');
    if (tab === 'gifs' && media.asset.mime !== 'image/gif') throw new Error('В раздел GIF можно добавить только GIF.');
    prepared.push(media);
  }
  return tab === 'gifs' ? { kind: 'gifs', files: prepared } : { kind: 'pack', pack: await makePack(name, prepared), files: prepared };
}
