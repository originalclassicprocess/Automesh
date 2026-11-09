import { imageKind } from './media-library';
// A PNG alpha channel alone says nothing: screenshots often encode opaque RGBA.
// Check actual pixels, locally and within the existing bounded sticker decoder.
export async function hasTransparentPixels(bytes: Uint8Array, mime: string): Promise<boolean> {
  if (typeof document === 'undefined') return false;
  try { mime=imageKind(bytes); } catch { return false; }
  if (!['image/png','image/webp'].includes(mime)) return false;
  // Do not reclassify animation based on a single decoded frame.
  const ascii = (start: number) => String.fromCharCode(...bytes.subarray(start,start+4));
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  for (let at = mime === 'image/png' ? 8 : 12; at + 12 <= bytes.length;) {
    const kind = ascii(mime === 'image/png' ? at+4 : at);
    if (['acTL','ANIM','ANMF'].includes(kind)) return false;
    const size = view.getUint32(mime === 'image/png' ? at : at+4, mime === 'image/webp');
    const next = at + size + (mime === 'image/png' ? 12 : 8 + size % 2);
    if (next <= at || next > bytes.length) return false;
    at = next;
  }
  const image = new Image(), url = URL.createObjectURL(new Blob([bytes.slice().buffer],{type:mime}));
  let timer: ReturnType<typeof setTimeout> | undefined;
  let canvas: HTMLCanvasElement | undefined;
  try {
    await new Promise<void>((resolve,reject) => {
      timer = setTimeout(() => reject(new Error('image_timeout')),8000);
      image.onload = () => resolve(); image.onerror = () => reject(new Error('image_decode')); image.src = url;
    });
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 8_000_000 || image.naturalWidth > 4096 || image.naturalHeight > 4096) return false;
    canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d',{willReadFrequently:true}); if (!context) return false;
    context.drawImage(image,0,0);
    for (let y=0; y<canvas.height; y+=64) {
      const pixels = context.getImageData(0,y,canvas.width,Math.min(64,canvas.height-y)).data;
      for (let at=3; at<pixels.length; at+=4) if (pixels[at] < 255) return true;
    }
    return false;
  } catch { return false; }
  finally { clearTimeout(timer); if (canvas) {canvas.width=0;canvas.height=0;} image.onload=null;image.onerror=null;image.src='';URL.revokeObjectURL(url); }
}
