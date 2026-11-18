import { exifOrientation } from './image-privacy';
export type ImagePreview = { width: number; height: number; colors?: string[] };
export function normalizeImagePreview(raw: unknown): ImagePreview | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
  const value = raw as ImagePreview;
  if (!Number.isSafeInteger(value.width) || !Number.isSafeInteger(value.height) || value.width < 1 || value.height < 1 ||
      value.width > 65535 || value.height > 65535 || value.width * value.height > 100_000_000) return;
  const colors = Array.isArray(value.colors) && value.colors.length === 9 && value.colors.every(c => typeof c === 'string' && /^#[a-f0-9]{6}$/i.test(c)) ? [...value.colors] : undefined;
  return { width: value.width, height: value.height, ...(colors ? { colors } : {}) };
}

// Bounded header reads, no decoder allocation just to learn the aspect ratio.
export function imageDimensions(bytes: Uint8Array, mime: string): ImagePreview | undefined {
  try {
    const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    const text = (at: number, count: number) => String.fromCharCode(...bytes.subarray(at,at+count));
    let width=0,height=0,orientation=1;
    if (mime==='image/png' && bytes.length>=24 && view.getUint32(0)===0x89504e47 && text(12,4)==='IHDR') {
      width=view.getUint32(16);height=view.getUint32(20);
      for(let at=8,n=0;at+12<=bytes.length&&n<4096;n++){
        const size=view.getUint32(at),next=at+12+size;if(next>bytes.length||next<=at)break;
        if(text(at+4,4)==='eXIf')orientation=exifOrientation(bytes.subarray(at+8,next-4))??1;
        at=next;
      }
    } else if (mime==='image/jpeg' && bytes[0]===255 && bytes[1]===216) {
      for(let at=2,n=0;at+4<=bytes.length&&n<4096;n++){
        if(bytes[at++]!==255)break;while(bytes[at]===255)at++;
        const marker=bytes[at++];if(marker===0xda||marker===0xd9)break;
        if(marker===1||marker>=0xd0&&marker<=0xd7)continue;
        const size=view.getUint16(at);if(size<2||at+size>bytes.length)break;
        if(marker===0xe1&&text(at+2,6)==='Exif\0\0')orientation=exifOrientation(bytes.subarray(at+2,at+size))??1;
        if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)&&size>=8){height=view.getUint16(at+3);width=view.getUint16(at+5);}
        at+=size;
      }
    } else if(mime==='image/gif'&&bytes.length>=13&&/^GIF8[79]a$/.test(text(0,6))){width=view.getUint16(6,true);height=view.getUint16(8,true);
    } else if(mime==='image/webp'&&bytes.length>=30&&text(0,4)==='RIFF'&&text(8,4)==='WEBP'){
      for(let at=12,n=0;at+8<=bytes.length&&n<4096;n++){
        const size=view.getUint32(at+4,true),next=at+8+size+size%2;if(next>bytes.length||next<=at)break;
        const kind=text(at,4),data=at+8;
        if(kind==='VP8X'&&size>=10){width=1+bytes[data+4]+(bytes[data+5]<<8)+(bytes[data+6]<<16);height=1+bytes[data+7]+(bytes[data+8]<<8)+(bytes[data+9]<<16);}
        else if(!width&&kind==='VP8L'&&size>=5&&bytes[data]===47){const bits=view.getUint32(data+1,true);width=(bits&16383)+1;height=((bits>>>14)&16383)+1;}
        else if(!width&&kind==='VP8 '&&size>=10){width=view.getUint16(data+6,true)&16383;height=view.getUint16(data+8,true)&16383;}
        if(kind==='EXIF')orientation=exifOrientation(bytes.subarray(data,data+size))??1;
        at=next;
      }
    }
    return normalizeImagePreview(orientation>=5?{width:height,height:width}:{width,height});
  } catch { return; }
}

// Optional cosmetic metadata inside the existing encrypted offer. No external
// thumbnail service, filename hash change, or prerequisite for delivery.
export async function createImagePreview(bytes: Uint8Array, mime: string): Promise<ImagePreview | undefined> {
  const dimensions=imageDimensions(bytes,mime);if(!dimensions)return;
  if(dimensions.width*dimensions.height>16_000_000||typeof createImageBitmap!=='function'||typeof document==='undefined')return dimensions;
  let expired=false,timer:ReturnType<typeof setTimeout>|undefined,bitmap:ImageBitmap|null=null,canvas:HTMLCanvasElement|undefined;
  try{
    const decoding=createImageBitmap(new Blob([bytes as BlobPart],{type:mime}),{resizeWidth:3,resizeHeight:3,resizeQuality:'low',imageOrientation:'from-image'})
      .then(value=>{if(expired){value.close();return null;}return value;});
    bitmap=await Promise.race([decoding,new Promise<null>(resolve=>{timer=setTimeout(()=>{expired=true;resolve(null);},1200);})]);
    if(!bitmap)return dimensions;
    canvas=document.createElement('canvas');canvas.width=3;canvas.height=3;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)return dimensions;
    ctx.fillStyle='#808080';ctx.fillRect(0,0,3,3);ctx.drawImage(bitmap,0,0,3,3);
    const pixels=ctx.getImageData(0,0,3,3).data,colors:string[]=[];
    for(let at=0;at<pixels.length;at+=4)colors.push('#'+[pixels[at],pixels[at+1],pixels[at+2]].map(c=>c.toString(16).padStart(2,'0')).join(''));
    pixels.fill(0);return {...dimensions,colors};
  }catch{return dimensions;}
  finally{expired=true;clearTimeout(timer);bitmap?.close();if(canvas){canvas.width=0;canvas.height=0;}}
}
