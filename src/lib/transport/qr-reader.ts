import jsQR from 'jsqr';

export function readQrFrame(source: CanvasImageSource, width: number, height: number): string | null {
  if (!width || !height) return null;
  const scale = Math.min(1, 960 / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('canvas_unavailable');
  // Keep narrow QR modules crisp when a dense code is downscaled on a phone.
  context.imageSmoothingEnabled = false;
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  return jsQR(pixels.data, pixels.width, pixels.height)?.data ?? null;
}

export async function readQrImage(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error('qr_image_invalid');
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 24_000_000) throw new Error('qr_image_too_large');
    const result = readQrFrame(bitmap, bitmap.width, bitmap.height);
    if (!result) throw new Error('qr_not_found');
    return result;
  } finally { bitmap.close(); }
}
