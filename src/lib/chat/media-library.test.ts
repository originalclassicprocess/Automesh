import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { standaloneEmoji } from './emoji';
import { addMedia, emptyMediaLibrary, imageKind, libraryFileId, makePack, normalizeMediaLibrary, prepareMedia, pruneMedia } from './media-library';
import { exportStickerPack, importStickerPack, unpackBounded } from './sticker-pack';
import { decodeChatContent, encodeChatContent, normalizeMessageDetails } from './message-details';
import { MAX_FILE_BYTES } from './file-transfer';

export const tinyGif = Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'),c=>c.charCodeAt(0));
describe('single native emoji',()=>{
  it.each(['🙂',' ❤️ ','❤','👨‍👩‍👧‍👦','👋🏽','🇷🇺','1️⃣','🏳️‍🌈'])('enlarges %s',text=>expect(standaloneEmoji(text)).toBe(true));
  it.each(['hi 🙂','🙂🙂','123','1','#','🏽','🇷','a','🙂\na','©\ufe0e',''])('leaves ordinary text unchanged: %s',text=>expect(standaloneEmoji(text)).toBe(false));
});
describe('local media library',()=>{
  it('deduplicates assets and keeps GIF files when a shared pack is removed',async()=>{
    const media=await prepareMedia(tinyGif,'wave.gif'); const pack=await makePack('Wave',[media]);
    const library=addMedia(addMedia(emptyMediaLibrary(),[media]),[media],pack);
    expect(library.assets).toHaveLength(1); expect(library.gifs).toEqual(pack.assets);
    expect(pruneMedia({...library,packs:[]})).toEqual({...library,packs:[]});
    expect(pruneMedia({...library,packs:[],gifs:[]}).assets).toHaveLength(0);
    expect(libraryFileId(media.asset.id)).toMatch(/^media-library:/);
    expect(libraryFileId(media.asset.id)).not.toContain(media.asset.hash);
    expect((await prepareMedia(tinyGif,'wave.gif')).asset.id).not.toBe(media.asset.id);
  });
  it('accepts reactive snapshots without structuredClone',async()=>{
    const media=await prepareMedia(tinyGif,'a.gif'); const library=new Proxy(emptyMediaLibrary(),{});
    expect(addMedia(library,[media]).assets).toHaveLength(1);
  });
  it('discards unsafe metadata and dangling references',()=>{
    expect(normalizeMediaLibrary({assets:[{hash:'x',size:5,mime:'text/html'}],gifs:['x'],packs:[{id:'x',assets:['x']}]})).toEqual(emptyMediaLibrary());
  });
  it('rejects active documents and oversized decoded dimensions',()=>{
    expect(()=>imageKind(strToU8('<svg onload="alert(1)"></svg>'))).toThrow();
    const huge=tinyGif.slice(); huge[6]=255; huge[7]=255;
    expect(()=>imageKind(huge)).toThrow();
  });
  it('preserves authenticated media metadata through the existing message encoding',()=>{
    const media={kind:'sticker' as const,packId:'a'.repeat(64),packName:'Nice'};
    expect(decodeChatContent(encodeChatContent('',{media}))?.details?.media).toEqual(media);
    expect(normalizeMessageDetails({media:{...media,packId:'https://evil.test'}})).toBeNull();
    expect(normalizeMessageDetails({media:{kind:'pack-request'}})).toBeNull();
  });
});
describe('bounded sticker pack archives',()=>{
  it('imports a plain folder of images without treating paths as extraction targets',async()=>{
    const decoded=await importStickerPack(zipSync({'nested/':new Uint8Array(),'nested/привет.gif':tinyGif}),undefined,'Здорово.zip');
    expect(decoded.pack.name).toBe('Здорово'); expect(decoded.files[0].asset.name).toBe('привет.gif');
    await expect(importStickerPack(zipSync({'nested/привет.gif':tinyGif}),'a'.repeat(64))).rejects.toThrow();
  });
  it('round trips an immutable pack with byte integrity',async()=>{
    const media=await prepareMedia(tinyGif,'Hello.gif'); const pack=await makePack('Hello',[media]);
    const bytes=exportStickerPack(pack,[media]); const decoded=await importStickerPack(bytes,pack.id);
    expect(decoded.pack).toEqual(pack); expect(decoded.files[0].bytes).toEqual(tinyGif);
    await expect(importStickerPack(bytes,'f'.repeat(64))).rejects.toThrow('соответствует');
  });
  it('rejects traversal, unlisted files, invalid images and hash mismatch',async()=>{
    expect(()=>unpackBounded(zipSync({'../x':tinyGif}))).toThrow('имя');
    const media=await prepareMedia(tinyGif,'a.gif'); const pack=await makePack('a',[media]);
    const entries=Object.fromEntries(unpackBounded(exportStickerPack(pack,[media])));
    await expect(importStickerPack(zipSync({...entries,'extra.gif':tinyGif}))).rejects.toThrow('описание');
    const changed=tinyGif.slice(); changed[10]^=1;
    await expect(importStickerPack(zipSync({...entries,'0.gif':changed}))).rejects.toThrow('сумма');
    await expect(importStickerPack(zipSync({...entries,'0.gif':strToU8('<html>bad</html>')}))).rejects.toThrow();
  });
  it('enforces actual expansion limits rather than trusting compressed size',()=>{
    const bomb=zipSync({'bomb.gif':new Uint8Array(MAX_FILE_BYTES+1)},{level:9});
    expect(bomb.length).toBeLessThan(100_000);
    expect(()=>unpackBounded(bomb)).toThrow();
    // Corrupt the declared uncompressed size; actual output remains bounded.
    const forged=bomb.slice(); new DataView(forged.buffer).setUint32(22,1,true);
    expect(()=>unpackBounded(forged)).toThrow();
  });
  it('rejects incomplete archives and more than 100 assets',()=>{
    expect(()=>unpackBounded(new Uint8Array([80,75,3,4]))).toThrow();
    const many=Object.fromEntries(Array.from({length:102},(_,i)=>[`${i}.gif`,tinyGif]));
    expect(()=>unpackBounded(zipSync(many))).toThrow();
    expect(()=>unpackBounded(zipSync(Object.fromEntries(Array.from({length:135},(_,i)=>[`${i}.gif`,tinyGif]))))).toThrow();
  });
});
