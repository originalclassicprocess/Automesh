import { describe, expect, it } from 'vitest';
import { clipboardImages, pastedText } from './clipboard-images';
import { normalizeMessageDetails, decodeChatContent, encodeChatContent } from './message-details';
describe('clipboard images and standalone stickers',()=>{
  it('reads image items, ignores HTML/URLs and does not duplicate the files fallback',()=>{
    const file=new File([new Uint8Array([1])],'screen.png',{type:'image/png'});
    const data={items:[{kind:'file',type:'image/png',getAsFile:()=>file},{kind:'string',type:'text/html',getAsFile:()=>null}],files:[file]} as unknown as DataTransfer;
    expect(clipboardImages(data)).toEqual([file]); expect(clipboardImages(null)).toEqual([]);
    expect(clipboardImages({items:[],files:[new File(['<svg/>'],'x.svg',{type:'image/svg+xml'})]} as unknown as DataTransfer)).toEqual([]);
  });
  it('preserves mixed pasted text at the cursor rather than replacing the whole draft',()=>{
    expect(pastedText('hello world','screen',6,11)).toBe('hello screen');
  });
  it('authenticates a standalone sticker without inventing a requestable pack',()=>{
    const details={media:{kind:'sticker' as const}};
    expect(decodeChatContent(encodeChatContent('',details))?.details).toEqual(details);
    expect(normalizeMessageDetails({media:{kind:'sticker',packId:'a'.repeat(64)}})).toBeNull();
    expect(normalizeMessageDetails({media:{kind:'pack-request'}})).toBeNull();
    expect(normalizeMessageDetails({media:{kind:'sticker-pack'}})).toBeNull();
  });
});
