// Small JPEG-structure fixture for validation and encrypted control tests.
// Browser decode is exercised separately by the UI; this is not a visual asset.
export function avatarFixture(size = 160): string {
  return 'data:image/jpeg;base64,' + btoa(String.fromCharCode(
    255,216,255,192,0,11,8,size >> 8,size & 255,size >> 8,size & 255,1,1,17,0,
    255,218,0,8,1,1,0,0,63,0,1,255,217));
}
