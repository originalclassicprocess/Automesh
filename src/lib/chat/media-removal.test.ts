import { describe, expect, it } from 'vitest';
import { removeMediaSelection } from './media-removal';
import { addMedia, emptyMediaLibrary, makePack, prepareMedia } from './media-library';
const gif = Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'),c=>c.charCodeAt(0));
describe('batch library deletion',()=>{
  it('rebuilds only the selected pack and retains shared assets and GIF references',async()=>{
    const first=await prepareMedia(gif,'a.gif'), copy=gif.slice(); copy[13]^=1;
    const second=await prepareMedia(copy,'b.gif');
    const pack=await makePack('First',[first,second]), shared=await makePack('Shared',[first]);
    const library=addMedia(addMedia(addMedia(emptyMediaLibrary(),[second]),[first,second],pack),[first],shared);
    const next=await removeMediaSelection(library,[first.asset.hash],'stickers',pack.id);
    expect(next.packs).toContainEqual(await makePack('First',[second]));
    expect(next.packs).toContainEqual(shared); expect(next.assets).toHaveLength(2);
    expect(library.packs[0]).toEqual(pack);
    const empty=await removeMediaSelection(next,[first.asset.hash,second.asset.hash],'stickers');
    expect(empty.packs).toHaveLength(0); expect(empty.assets.map(a=>a.hash)).toEqual([second.asset.hash]);
  });
  it('does not erase a GIF still referenced by a sticker pack or mutate the source',async()=>{
    const file=await prepareMedia(gif,'a.gif'), pack=await makePack('Pack',[file]);
    const library=addMedia(addMedia(emptyMediaLibrary(),[file]),[file],pack);
    expect((await removeMediaSelection(library,[file.asset.hash],'gifs')).assets).toHaveLength(1);
    expect(library.gifs).toHaveLength(1);
    expect(await removeMediaSelection(library,[],'stickers')).toBe(library);
  });
});
