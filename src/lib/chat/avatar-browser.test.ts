import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPhotoAvatar, loadAvatarPhoto } from './avatar-browser';
import { avatarFixture } from './avatar.fixture';
import { AVATAR_PREFIX } from './avatar';
function browser(fail = false, width = 1200, height = 800) {
  const draw = vi.fn(), fill = vi.fn();
  const raw = atob(avatarFixture().slice(AVATAR_PREFIX.length));
  const canvas = { width:0, height:0, getContext: () => ({ drawImage:draw, fillRect:fill, fillStyle:'' }),
    toBlob: vi.fn((callback: (value: Blob | null) => void) => callback(new Blob([Uint8Array.from(raw,c=>c.charCodeAt(0))], { type:'image/jpeg' }))) };
  vi.stubGlobal('document', { createElement: () => canvas });
  vi.stubGlobal('Image', class {
    naturalWidth = width; naturalHeight = height; onload: (()=>void) | null = null; onerror: (()=>void) | null = null;
    set src(value: string) { if (value) queueMicrotask(() => fail ? this.onerror?.() : this.onload?.()); }
  });
  const create = vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:local-avatar');
  const revoke = vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
  return { draw,fill,canvas,create,revoke };
}
afterEach(()=> { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('local avatar thumbnail preparation',()=> {
  it('bounds native resize requests for tall encoded images rather than upscaling their narrow side',async()=> {
    const bytes=new Uint8Array(24); bytes.set([137,80,78,71]); bytes.set([73,72,68,82],12);
    const header=new DataView(bytes.buffer); header.setUint32(16,1); header.setUint32(20,16384);
    const bitmap={width:1,height:1280,close:vi.fn()}, decode=vi.fn(async()=>bitmap);
    vi.stubGlobal('createImageBitmap',decode);
    const photo=await loadAvatarPhoto(new File([bytes],'tall.png',{type:'image/png'}));
    expect(decode).toHaveBeenCalledWith(expect.any(File),expect.objectContaining({resizeWidth:1})); photo.dispose();
  });
  it('uses the selected crop for the final encoded thumbnail',async()=> {
    const b = browser();
    await createPhotoAvatar(new File(['pixels'],'a.png',{type:'image/png'}),{zoom:2,x:1,y:0});
    expect(b.draw).toHaveBeenCalledWith(expect.anything(),800,0,400,400,0,0,160,160);
    expect(b.revoke).toHaveBeenCalledOnce();
  });
  it('releases a canceled preview without decoding or saving it',async()=> {
    const b = browser(), abort = new AbortController(); abort.abort();
    await expect(loadAvatarPhoto(new File(['pixels'],'a.png',{type:'image/png'}),abort.signal)).rejects.toThrow('canceled');
    expect(b.draw).not.toHaveBeenCalled(); expect(b.revoke).not.toHaveBeenCalled();
  });
  it('crops the center locally, makes a small JPEG and never mutates the original', async()=> {
    const b = browser(), file = new File(['original pixels and metadata'],'a.png',{type:'image/png'});
    expect(await createPhotoAvatar(file)).toBe(avatarFixture());
    expect(await file.text()).toBe('original pixels and metadata');
    expect(b.draw).toHaveBeenCalledWith(expect.anything(),200,0,800,800,0,0,160,160);
    expect(b.fill).toHaveBeenCalledWith(0,0,160,160);
    expect(b.revoke).toHaveBeenCalledWith('blob:local-avatar'); expect(b.canvas.width).toBe(0);
  });
  it('cleans up failed decoding and rejects huge decoded images',async()=> {
    const b = browser(true); await expect(createPhotoAvatar(new File(['bad'],'a.heic',{type:'image/heic'}))).rejects.toThrow('JPEG');
    expect(b.revoke).toHaveBeenCalledOnce();
    vi.restoreAllMocks(); vi.unstubAllGlobals();
    const big = browser(false,9000,9000);
    await expect(createPhotoAvatar(new File(['big'],'a.jpg',{type:'image/jpeg'}))).rejects.toThrow('64 мегапикселей');
    expect(big.draw).not.toHaveBeenCalled(); expect(big.revoke).toHaveBeenCalledOnce();
  });
  it('refuses active formats and excessive file sizes before decoding',async()=> {
    const b = browser();
    await expect(createPhotoAvatar(new File(['<svg/>'],'x.svg',{type:'image/svg+xml'}))).rejects.toThrow('формат');
    await expect(createPhotoAvatar(new File([new Uint8Array(64*1024*1024+1)],'x.jpg',{type:'image/jpeg'}))).rejects.toThrow('64 МБ');
    expect(b.create).not.toHaveBeenCalled();
  });
  it('reduces a 48 MP decoded fallback locally before the crop editor',async()=>{
    const b=browser(false,8000,6000), photo=await loadAvatarPhoto(new File(['pixels'],'large.jpg',{type:'image/jpeg'}));
    expect([photo.width,photo.height]).toEqual([1280,960]); expect(b.draw).toHaveBeenCalledOnce();
    expect(b.revoke).toHaveBeenCalledOnce(); photo.dispose(); expect(b.canvas.width).toBe(0);
  });
  it('requests a small native bitmap, accepts larger source files and closes decoded resources',async()=>{
    const bitmap={width:1280,height:960,close:vi.fn()}, decode=vi.fn(async()=>bitmap);
    vi.stubGlobal('createImageBitmap',decode);
    const photo=await loadAvatarPhoto(new File([new Uint8Array(21*1024*1024)],'large.jpg',{type:'image/jpeg'}));
    expect(decode).toHaveBeenCalledWith(expect.any(File),{resizeWidth:1280,resizeQuality:'high',imageOrientation:'from-image'});
    expect([photo.width,photo.height]).toEqual([1280,960]); photo.dispose(); expect(bitmap.close).toHaveBeenCalledOnce();
  });
  it('closes a late native bitmap after cancellation',async()=>{
    let resolve!:(bitmap:unknown)=>void; vi.stubGlobal('createImageBitmap',()=>new Promise(done=>resolve=done));
    const abort=new AbortController(), bitmap={width:1280,height:960,close:vi.fn()};
    const pending=loadAvatarPhoto(new File(['pixels'],'large.jpg',{type:'image/jpeg'}),abort.signal);
    await vi.waitFor(()=>expect(resolve).toBeDefined()); abort.abort();
    await expect(pending).rejects.toThrow('canceled'); resolve(bitmap); await Promise.resolve();
    await vi.waitFor(()=>expect(bitmap.close).toHaveBeenCalledOnce());
  });
});
