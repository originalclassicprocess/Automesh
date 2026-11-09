import { AVATAR_PREFIX, AVATAR_SIZE, MAX_AVATAR_BYTES, normalizeAvatar } from './avatar';
import { cleanImageMetadata } from './image-privacy';
import { avatarCropRect, type AvatarCrop } from './avatar-crop';
import { MAX_AVATAR_SOURCE_BYTES, AVATAR_PREVIEW_EDGE, avatarHeaderDimensions, checkAvatarDimensions } from './avatar-photo-limits';

export type AvatarPhoto = { image: CanvasImageSource; width: number; height: number; dispose(): void };
async function loadBitmap(file:File, resizeWidth:number, signal?:AbortSignal): Promise<ImageBitmap> {
  return new Promise((resolve,reject) => {
    let finished=false;
    const finish=(error?:Error,bitmap?:ImageBitmap) => {
      if (finished) { bitmap?.close(); return; } finished=true;
      clearTimeout(timer); signal?.removeEventListener('abort',abort);
      error ? reject(error) : resolve(bitmap!);
    };
    const abort=()=>finish(new Error('avatar_load_canceled'));
    const timer=setTimeout(()=>finish(new Error('Не удалось открыть фото вовремя. Попробуйте JPEG или PNG.')),15000);
    if (signal?.aborted) { abort(); return; } signal?.addEventListener('abort',abort,{once:true});
    Promise.resolve().then(()=>createImageBitmap(file,{resizeWidth,resizeQuality:'high',imageOrientation:'from-image'}))
      .then(bitmap=>finish(undefined,bitmap),()=>finish(new Error('avatar_bitmap_unsupported')));
  });
}

export async function loadAvatarPhoto(file: File, signal?: AbortSignal): Promise<AvatarPhoto> {
  if (!file.size || file.size > MAX_AVATAR_SOURCE_BYTES) throw new Error('Выберите фото до 64 МБ.');
  const format = file.type.toLowerCase() || ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic', heif: 'image/heif', avif: 'image/avif', bmp: 'image/bmp' } as Record<string, string>)[file.name.toLowerCase().split('.').at(-1) ?? ''];
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'image/avif', 'image/bmp'].includes(format)) throw new Error('Выберите фото JPEG, PNG, WebP или другой поддерживаемый браузером формат.');
  if (signal?.aborted) throw new Error('avatar_load_canceled');
  const dimensions=avatarHeaderDimensions(new Uint8Array(await file.slice(0,1024*1024).arrayBuffer()));
  if (dimensions) checkAvatarDimensions(...dimensions);
  if (signal?.aborted) throw new Error('avatar_load_canceled');
  if (typeof createImageBitmap==='function') {
    try {
      // Use the shorter encoded side: EXIF may rotate width and height. This
      // avoids huge intermediate bitmaps for very tall or rotated pictures.
      const resizeWidth=dimensions ? Math.max(1,Math.round(Math.min(...dimensions)*Math.min(1,AVATAR_PREVIEW_EDGE/Math.max(...dimensions)))) : AVATAR_PREVIEW_EDGE;
      const bitmap=await loadBitmap(file,resizeWidth,signal);
      try { checkAvatarDimensions(bitmap.width,bitmap.height);
        if (bitmap.width*bitmap.height>8_000_000) throw new Error('Не удалось уменьшить фото. Попробуйте JPEG или PNG.');
      } catch(error) { bitmap.close(); throw error; }
      return {image:bitmap,width:bitmap.width,height:bitmap.height,dispose:()=>bitmap.close()};
    } catch(error) {
      if (!(error instanceof Error) || error.message!=='avatar_bitmap_unsupported') throw error;
      // Some native decoders support HTML images but not bitmap decoding.
    }
  }
  const url = URL.createObjectURL(file), image = new Image();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const dispose = () => { clearTimeout(timer); image.onload = null; image.onerror = null; image.src = ''; URL.revokeObjectURL(url); };
  let onAbort: (() => void) | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      onAbort = () => reject(new Error('avatar_load_canceled'));
      if (signal?.aborted) { onAbort(); return; }
      signal?.addEventListener('abort', onAbort, { once:true });
      timer = setTimeout(() => reject(new Error('Не удалось открыть фото. Попробуйте JPEG или PNG.')), 15000);
      image.onload = () => resolve(); image.onerror = () => reject(new Error('Браузер не может открыть это фото. Попробуйте JPEG или PNG.')); image.src = url;
    });
    const { naturalWidth: width, naturalHeight: height } = image;
    checkAvatarDimensions(width,height);
    clearTimeout(timer);
    if (Math.max(width,height)<=AVATAR_PREVIEW_EDGE) return { image,width,height,dispose };
    const reduced=document.createElement('canvas'), scale=AVATAR_PREVIEW_EDGE/Math.max(width,height);
    reduced.width=Math.max(1,Math.round(width*scale)); reduced.height=Math.max(1,Math.round(height*scale));
    const ctx=reduced.getContext('2d'); if (!ctx) throw new Error('Не удалось уменьшить фото.');
    ctx.drawImage(image,0,0,width,height,0,0,reduced.width,reduced.height); dispose();
    return {image:reduced,width:reduced.width,height:reduced.height,dispose:()=>{reduced.width=0;reduced.height=0;}};
  } catch (error) { dispose(); throw error; }
  finally { if (onAbort) signal?.removeEventListener('abort',onAbort); }
}

export async function createPhotoAvatar(file: File, crop?: AvatarCrop): Promise<string> {
  const photo = await loadAvatarPhoto(file), image = photo.image;
  const canvas = document.createElement('canvas');
  try {
    canvas.width = AVATAR_SIZE; canvas.height = AVATAR_SIZE;
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Не удалось подготовить фото.');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
    const rect = avatarCropRect(photo.width, photo.height, crop);
    ctx.drawImage(image, rect.x, rect.y, rect.size, rect.size, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
    for (const quality of [0.85, 0.65, 0.45, 0.3, 0.2]) {
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (!blob) continue;
      const bytes = cleanImageMetadata(new Uint8Array(await blob.arrayBuffer()), 'image/jpeg').bytes;
      if (bytes.length > MAX_AVATAR_BYTES) continue;
      const avatar = AVATAR_PREFIX + btoa(String.fromCharCode(...bytes));
      if (normalizeAvatar(avatar)) return avatar;
    }
    throw new Error('Не удалось подготовить аватар. Выберите другое фото.');
  } finally {
    photo.dispose(); canvas.width = 0; canvas.height = 0;
  }
}
