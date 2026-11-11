import { afterEach, expect, it, vi } from 'vitest';
import { storageThumbnail } from './storage-thumbnail';

afterEach(()=>vi.unstubAllGlobals());
it('bounds preview dimensions, preserves aspect ratio and closes the decoded original', async()=>{
  const bitmap={width:4000,height:2000,close:vi.fn()};
  const context={drawImage:vi.fn()},result=new Blob(['preview'],{type:'image/webp'});
  const canvas={width:0,height:0,getContext:()=>context,toBlob:(resolve:(blob:Blob)=>void)=>resolve(result)};
  vi.stubGlobal('createImageBitmap',vi.fn(async()=>bitmap));
  vi.stubGlobal('document',{createElement:()=>canvas});
  expect(await storageThumbnail(new Uint8Array([1,2]),'image/png')).toBe(result);
  expect([canvas.width,canvas.height]).toEqual([256,128]);
  expect(bitmap.close).toHaveBeenCalledOnce();
});
it('releases decoded memory when thumbnail creation fails', async()=>{
  const bitmap={width:200,height:400,close:vi.fn()};
  vi.stubGlobal('createImageBitmap',vi.fn(async()=>bitmap));
  vi.stubGlobal('document',{createElement:()=>({width:0,height:0,getContext:()=>{throw new Error('canvas unavailable');}})});
  await expect(storageThumbnail(new Uint8Array([1]),'image/png')).rejects.toThrow('canvas unavailable');
  expect(bitmap.close).toHaveBeenCalledOnce();
});
it('keeps the file usable when the browser cannot decode a thumbnail', async()=>{
  vi.stubGlobal('createImageBitmap',undefined);
  expect(await storageThumbnail(new Uint8Array([1]),'image/png')).toBeNull();
});
