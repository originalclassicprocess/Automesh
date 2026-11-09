import { describe, expect, it, vi } from 'vitest';
import { addMedia, emptyMediaLibrary, makePack, prepareMedia, LIBRARY_BYTES } from './media-library';
import { prepareMediaImport, type ImportFile } from './media-import';
import { exportStickerPack } from './sticker-pack';
import { MAX_FILE_BYTES } from './file-transfer';

const gif = Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), c => c.charCodeAt(0));
function file(name: string, bytes: Uint8Array = gif): ImportFile {
  return { name, type: '', size: bytes.length, arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer };
}
describe('shared picker and drop import', () => {
  it('adds every GIF in a batch and deduplicates identical contents', async () => {
    const second = gif.slice(); second[13] = 120;
    const result = await prepareMediaImport([file('one.gif'), file('two.gif', second), file('copy.gif')], 'gifs', '');
    expect(result.kind).toBe('gifs'); expect(result.files).toHaveLength(3);
    expect(addMedia(emptyMediaLibrary(), result.files).gifs).toHaveLength(2);
  });
  it('accepts a batch over 20 MiB when every GIF meets its own limit', async () => {
    const padded = new Uint8Array(11 * 1024 * 1024); padded.set(gif);
    const result = await prepareMediaImport([file('one.gif', padded), file('two.gif', padded)], 'gifs', '');
    expect(result.files).toHaveLength(2);
  });
  it('imports a dropped ZIP with the same verified manifest as the picker', async () => {
    const media = await prepareMedia(gif, 'heart.gif'); const pack = await makePack('Test', [media]);
    const result = await prepareMediaImport([file('TEST.ZIP', exportStickerPack(pack, [media]))], 'stickers', 'Other');
    expect(result.kind).toBe('pack'); if (result.kind === 'pack') expect(result.pack).toEqual(pack);
  });
  it('prepares a pack from all dropped images without committing it', async () => {
    const result = await prepareMediaImport([file('one.gif'), file('two.gif')], 'stickers', 'My pack');
    expect(result.kind).toBe('pack'); if (result.kind === 'pack') expect(result.pack.name).toBe('My pack');
    expect(result.files).toHaveLength(2);
  });
  it('rejects mixed ZIP/image drops and ZIP in the GIF tab before reading files', async () => {
    const zip = file('pack.zip'); zip.arrayBuffer = vi.fn();
    await expect(prepareMediaImport([zip, file('image.gif')], 'stickers', '')).rejects.toThrow('один ZIP');
    await expect(prepareMediaImport([zip], 'gifs', '')).rejects.toThrow('Стикеры');
    expect(zip.arrayBuffer).not.toHaveBeenCalled();
  });
  it('rejects excessive batches before allocating image bytes', async () => {
    const huge: ImportFile = {...file('huge.gif'), size: MAX_FILE_BYTES + 1, arrayBuffer: vi.fn()};
    await expect(prepareMediaImport([huge], 'gifs', '')).rejects.toThrow('20 МБ');
    await expect(prepareMediaImport(Array.from({length: 101}, () => file('a.gif')), 'gifs', '')).rejects.toThrow('100 файлов');
    const sized = {...huge, size: MAX_FILE_BYTES};
    await expect(prepareMediaImport(Array(6).fill(sized), 'gifs', '')).rejects.toThrow('100 МБ');
    expect(6 * sized.size).toBeGreaterThan(LIBRARY_BYTES); expect(huge.arrayBuffer).not.toHaveBeenCalled();
  });
  it('rejects an invalid file in a batch rather than returning a partial import', async () => {
    await expect(prepareMediaImport([file('good.gif'), file('bad.gif', new TextEncoder().encode('<svg/>'))], 'gifs', '')).rejects.toThrow('PNG');
    await expect(prepareMediaImport([{...file('changed.gif'), size: gif.length + 1}], 'gifs', '')).rejects.toThrow('Размер файла');
  });
});
