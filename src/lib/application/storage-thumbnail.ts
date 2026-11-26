// In-memory derivative only; the encrypted original remains untouched.
export async function storageThumbnail(bytes: Uint8Array, mime: string): Promise<Blob | null> {
  const blob = new Blob([bytes as BlobPart], { type:mime });
  const bitmap = typeof createImageBitmap === 'function' ? await createImageBitmap(blob).catch(() => null) : null;
  if (!bitmap && typeof Image !== 'function') return null;
  const url = bitmap ? '' : URL.createObjectURL(blob);
  try {
    // Some browsers can render an animated image even when bitmap decoding fails.
    const image = bitmap ?? await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('thumbnail_decode_failed'));
      element.src = url;
    });
    const width = 'naturalWidth' in image ? image.naturalWidth : image.width;
    const height = 'naturalHeight' in image ? image.naturalHeight : image.height;
    const scale = Math.min(1, 256 / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', .78));
  } finally {
    bitmap?.close();
    if (url) URL.revokeObjectURL(url);
  }
}
