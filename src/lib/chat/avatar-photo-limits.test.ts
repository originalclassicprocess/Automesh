import { describe, expect, it } from 'vitest';
import { avatarHeaderDimensions, checkAvatarDimensions } from './avatar-photo-limits';
describe('avatar source bounds',()=>{
  it('allows 48 MP, rejects bombs and malformed dimensions before decoding',()=>{
    expect(()=>checkAvatarDimensions(8000,6000)).not.toThrow();
    for(const [w,h] of [[0,20],[9000,9000],[20000,1],[NaN,1],[1.5,1]]) expect(()=>checkAvatarDimensions(w,h)).toThrow();
  });
  it('reads bounded PNG/JPEG/GIF headers without reading image pixels',()=>{
    const png=new Uint8Array(24); png.set([137,80,78,71],0); png.set(new TextEncoder().encode('IHDR'),12);
    const p=new DataView(png.buffer);p.setUint32(16,8000);p.setUint32(20,6000);expect(avatarHeaderDimensions(png)).toEqual([8000,6000]);
    const jpg=new Uint8Array(21);jpg.set([255,216,255,192,0,17,8],0);const j=new DataView(jpg.buffer);j.setUint16(7,6000);j.setUint16(9,8000);
    expect(avatarHeaderDimensions(jpg)).toEqual([8000,6000]);expect(avatarHeaderDimensions(jpg.subarray(0,8))).toBeNull();
    const gif=new Uint8Array(10);gif.set(new TextEncoder().encode('GIF89a'));const g=new DataView(gif.buffer);g.setUint16(6,320,true);g.setUint16(8,240,true);
    expect(avatarHeaderDimensions(gif)).toEqual([320,240]);expect(avatarHeaderDimensions(new Uint8Array([1,2]))).toBeNull();
  });
});
