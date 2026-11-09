import { cleanImageMetadata, UnsupportedImagePrivacy } from './image-privacy';
const additionalFormats: Record<string, string> = { heic: 'image/heic', heif: 'image/heif', avif: 'image/avif', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff' };
export async function preparePrivateImage(bytes: Uint8Array, declaredMime: string, name: string): Promise<{ bytes: Uint8Array; mime: string; name: string }> {
  const mime = declaredMime || additionalFormats[name.toLowerCase().split('.').at(-1) ?? ''] || '';
  try { return { ...cleanImageMetadata(bytes, mime), name }; }
  catch (error) {
    if (!(error instanceof UnsupportedImagePrivacy)) throw new Error('Не удалось проверить структуру изображения для очистки. Выберите другую копию файла; оригинал не отправлен.');
    // No SVG or generic active format. Only local browser decoders, never a
    // remote conversion service. Unsupported codecs fail closed, not unfiltered.
    if (!Object.values(additionalFormats).includes(mime.toLowerCase()) || typeof document === 'undefined') throw error;
    if (['avis', 'msf1', 'hevc', 'hevx'].includes(new TextDecoder().decode(bytes.subarray(8, 12)))) throw error;
  }
  const blob = new Blob([bytes.slice().buffer], { type: mime }), url = URL.createObjectURL(blob), image = new Image();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => reject(new UnsupportedImagePrivacy()), 15000);
      image.onload = () => resolve(); image.onerror = () => reject(new UnsupportedImagePrivacy()); image.src = url;
    });
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 16 * 1024 * 1024) throw new Error('Изображение слишком большое для безопасной очистки в браузере. Отправьте JPEG/PNG или явно отключите очистку для оригинала.');
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    try {
      const context = canvas.getContext('2d'); if (!context) throw new UnsupportedImagePrivacy();
      context.drawImage(image, 0, 0);
      const rendered = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new UnsupportedImagePrivacy()), 'image/png'));
      if (rendered.size > 20 * 1024 * 1024) throw new Error('Очищенное изображение превышает 20 МБ. Выберите JPEG/PNG меньшего размера.');
      return { ...cleanImageMetadata(new Uint8Array(await rendered.arrayBuffer()), 'image/png'), name: name.replace(/\.[^.]+$/, '') + '.png' };
    } finally { canvas.width = 0; canvas.height = 0; }
  } finally { clearTimeout(timer); image.onload = null; image.onerror = null; image.src = ''; URL.revokeObjectURL(url); }
}
