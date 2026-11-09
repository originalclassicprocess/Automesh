import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasTransparentPixels } from './transparent-image';
const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='),c=>c.charCodeAt(0));
function decoder(alpha: number, fail=false) {
  const canvas={width:0,height:0,getContext:()=>({drawImage:vi.fn(),getImageData:()=>({data:new Uint8ClampedArray([1,2,3,alpha])})})};
  vi.stubGlobal('document',{createElement:()=>canvas});
  vi.stubGlobal('Image',class {
    naturalWidth=1;naturalHeight=1;onload:(()=>void)|null=null;onerror:(()=>void)|null=null;
    set src(value:string){if(value)queueMicrotask(()=>fail?this.onerror?.():this.onload?.());}
  });
  vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:local');
  const revoke=vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
  return {canvas,revoke};
}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('transparent image classification',()=>{
  it('uses actual alpha, not the existence of an alpha channel',async()=>{
    const b=decoder(255);expect(await hasTransparentPixels(png,'image/png')).toBe(false);
    expect(b.canvas.width).toBe(0);expect(b.revoke).toHaveBeenCalledOnce();
  });
  it('recognizes a cutout and releases temporary resources',async()=>{
    const b=decoder(0);expect(await hasTransparentPixels(png,'')).toBe(true);
    expect(b.revoke).toHaveBeenCalledOnce();expect(b.canvas.height).toBe(0);
  });
  it('leaves unsupported or undecodable images unchanged',async()=>{
    decoder(0,true);expect(await hasTransparentPixels(png,'image/png')).toBe(false);
    expect(await hasTransparentPixels(new TextEncoder().encode('<svg/>'),'image/svg+xml')).toBe(false);
  });
});
