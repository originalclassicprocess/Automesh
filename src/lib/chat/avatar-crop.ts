export type AvatarCrop = { zoom: number; x: number; y: number };
export const defaultAvatarCrop = (): AvatarCrop => ({ zoom: 1, x: 0.5, y: 0.5 });
function bounded(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}
export function avatarCropRect(width: number, height: number, crop?: AvatarCrop) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('invalid_avatar_dimensions');
  const zoom = bounded(crop?.zoom, 1, 1, 4), size = Math.min(width, height) / zoom;
  return { x: (width - size) * bounded(crop?.x, 0.5, 0, 1), y: (height - size) * bounded(crop?.y, 0.5, 0, 1), size };
}
export function moveAvatarCrop(width: number, height: number, crop: AvatarCrop, dx: number, dy: number, previewSize: number): AvatarCrop {
  const rect = avatarCropRect(width, height, crop);
  const x = width > rect.size ? crop.x - dx * rect.size / previewSize / (width - rect.size) : crop.x;
  const y = height > rect.size ? crop.y - dy * rect.size / previewSize / (height - rect.size) : crop.y;
  return { zoom: crop.zoom, x: bounded(x,0.5,0,1), y: bounded(y,0.5,0,1) };
}
