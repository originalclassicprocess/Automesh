// In-memory derivative only; the encrypted original remains untouched.
export async function storageThumbnail(bytes: Uint8Array, mime: string): Promise<Blob | null> {
  if (typeof createImageBitmap !== 'function') return null;
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], {type:mime}));
  try {
    const scale = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', .78));
  } finally { bitmap.close(); }
}
