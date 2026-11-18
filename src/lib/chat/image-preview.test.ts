import { afterEach,describe,expect,it,vi } from 'vitest';
import { imageDimensions,normalizeImagePreview,createImagePreview } from './image-preview';
import { normalizeMessageDetails,encodeChatContent,decodeChatContent } from './message-details';
import { sameFileOffer } from './file-transfer';
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});
function png(width:number,height:number){const b=new Uint8Array(33);b.set([137,80,78,71,13,10,26,10]);b.set([73,72,68,82],12);const v=new DataView(b.buffer);v.setUint32(8,13);v.setUint32(16,width);v.setUint32(20,height);return b;}
const preview={width:600,height:900,colors:Array(9).fill('#aabbcc')};
describe('bounded private image placeholders',()=>{
  it.each([[1200,800],[800,1200],[600,600]])('preserves %s × %s display geometry from headers', (w,h)=>{
    expect(imageDimensions(png(w,h),'image/png')).toEqual({width:w,height:h});
  });
  it('reads JPEG orientation before exposing portrait dimensions',()=>{
    const tiff=new Uint8Array(26),v=new DataView(tiff.buffer);tiff.set([73,73]);v.setUint16(2,42,true);v.setUint32(4,8,true);v.setUint16(8,1,true);v.setUint16(10,0x112,true);v.setUint16(12,3,true);v.setUint32(14,1,true);v.setUint16(18,6,true);
    const exif=new Uint8Array([69,120,105,102,0,0,...tiff]),app=new Uint8Array([255,225,0,exif.length+2,...exif]);
    const jpeg=new Uint8Array([255,216,...app,255,192,0,8,8,1,44,2,88,1,255,217]);
    expect(imageDimensions(jpeg,'image/jpeg')).toEqual({width:300,height:600});
  });
  it('drops unsafe dimensions/colors and never supplies executable CSS/URLs',()=>{
    for(const raw of [{width:0,height:2},{width:Infinity,height:2},{width:65535,height:65535},[],null])expect(normalizeImagePreview(raw)).toBeUndefined();
    expect(normalizeImagePreview({...preview,colors:Array(9).fill('url(https://evil.example)')})).toEqual({width:600,height:900});
    expect(imageDimensions(new Uint8Array([1,2,3]),'image/png')).toBeUndefined();
    expect(imageDimensions(png(100,100),'image/svg+xml')).toBeUndefined();
  });
  it('keeps preview metadata encrypted with normal content and excludes disappearing media',()=>{
    const details={imagePreview:preview};expect(decodeChatContent(encodeChatContent('',details))?.details).toEqual(details);
    expect(normalizeMessageDetails({...details,ephemeral:{views:1,allowDownload:false}})?.imagePreview).toBeUndefined();
    expect(normalizeMessageDetails({imagePreview:{width:Infinity,height:1}})).toEqual({});
  });
  it('treats omitted legacy previews as the same offer, while preserving security-sensitive intent',()=>{
    const a={id:'id',name:'photo.png',mime:'image/png',size:20,sha256:'a'.repeat(64),details:{imagePreview:preview}};
    expect(sameFileOffer(a,{...a,details:undefined})).toBe(true);
    expect(sameFileOffer(a,{...a,sha256:'b'.repeat(64)})).toBe(false);
    expect(sameFileOffer(a,{...a,details:{ephemeral:{views:1,allowDownload:false}}})).toBe(false);
  });
  it('decodes only into a 3×3 palette and releases all temporary resources',async()=>{
    const close=vi.fn(),pixels=new Uint8ClampedArray(Array.from({length:9},()=>[170,187,204,255]).flat()),canvas={width:0,height:0,getContext:()=>({fillStyle:'',fillRect:vi.fn(),drawImage:vi.fn(),getImageData:()=>({data:pixels})})};
    const decoder=vi.fn(async(_blob:Blob,_options?:ImageBitmapOptions)=>({close,width:3,height:3}));vi.stubGlobal('createImageBitmap',decoder);vi.stubGlobal('document',{createElement:()=>canvas});
    const result=await createImagePreview(png(600,900),'image/png');expect(result).toEqual(preview);
    expect(decoder.mock.calls[0][1]).toMatchObject({resizeWidth:3,resizeHeight:3,imageOrientation:'from-image'});
    expect(close).toHaveBeenCalledOnce();expect(canvas.width).toBe(0);expect(pixels.every(p=>p===0)).toBe(true);
    decoder.mockClear();expect(await createImagePreview(png(6000,4000),'image/png')).toEqual({width:6000,height:4000});expect(decoder).not.toHaveBeenCalled();
  });
  it('bounds optional decoding time and closes a decoder that completes after the timeout',async()=>{
    vi.useFakeTimers();let finish!:(value:{close:()=>void})=>void;
    const close=vi.fn(),canvas=vi.fn();vi.stubGlobal('document',{createElement:canvas});
    vi.stubGlobal('createImageBitmap',()=>new Promise(resolve=>{finish=resolve;}));
    const work=createImagePreview(png(600,900),'image/png');await vi.advanceTimersByTimeAsync(1201);
    expect(await work).toEqual({width:600,height:900});finish({close});await Promise.resolve();
    expect(close).toHaveBeenCalledOnce();expect(canvas).not.toHaveBeenCalled();
  });
});
