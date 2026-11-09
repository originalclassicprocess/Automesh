import { describe, expect, it } from 'vitest';
import { avatarCropRect, defaultAvatarCrop, moveAvatarCrop } from './avatar-crop';
describe('avatar crop geometry',()=> {
  it('starts centered in landscape and portrait photos',()=> {
    expect(avatarCropRect(1200,800)).toEqual({ x:200,y:0,size:800 });
    expect(avatarCropRect(800,1200)).toEqual({ x:0,y:200,size:800 });
    expect(avatarCropRect(800,800)).toEqual({ x:0,y:0,size:800 });
  });
  it('maps zoom and positions to a bounded square inside the original',()=> {
    expect(avatarCropRect(1200,800,{zoom:2,x:1,y:0})).toEqual({ x:800,y:0,size:400 });
    for (const width of [1,800,1200]) for (const height of [1,800,1200]) {
      for (const crop of [{zoom:100,x:-20,y:200},{zoom:NaN,x:Infinity,y:NaN},{zoom:0,x:0,y:1}]) {
        const r = avatarCropRect(width,height,crop);
        expect(r.x).toBeGreaterThanOrEqual(0); expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.x+r.size).toBeLessThanOrEqual(width); expect(r.y+r.size).toBeLessThanOrEqual(height);
      }
    }
    expect(()=>avatarCropRect(0,800)).toThrow(); expect(()=>avatarCropRect(Infinity,800)).toThrow();
  });
  it('moves the visible photo with a drag, clamps edges, and avoids zero-span division',()=> {
    const crop = defaultAvatarCrop();
    expect(moveAvatarCrop(1200,800,crop,80,0,320)).toEqual({zoom:1,x:0,y:0.5});
    expect(moveAvatarCrop(1200,800,crop,-800,800,320)).toEqual({zoom:1,x:1,y:0.5});
    expect(moveAvatarCrop(800,800,crop,80,80,320)).toEqual(crop);
    expect(moveAvatarCrop(800,800,{zoom:2,x:0.5,y:0.5},80,0,320)).toEqual({zoom:2,x:0.25,y:0.5});
  });
});
