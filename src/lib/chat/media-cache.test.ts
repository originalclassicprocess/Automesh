import{describe,it,expect,beforeEach,afterEach,vi}from'vitest';
import{IDBFactory,IDBKeyRange}from'fake-indexeddb';
import{encodeAccountId}from'../addressing/bech32m';
import{prepareMedia,cacheMedia,emptyMediaLibrary,addMedia,makePack,editMediaPack,libraryFileId,pruneMedia}from'./media-library';
import{linkCachedMedia,retainMessageMedia,rebaseMediaLibrary,reusableMedia,packRequested,packRequestAnswered}from'./media-cache';
import{emptySessionChats,ensureConversation,recordSentMessage,saveChats,restoreChats,type ChatEntry}from'./session-chats';
import{deriveChatStoreKey,normalizeLocalChatData,saveLocalSessionData,loadLocalFileData,inspectChatStorage,saveLocalChatData}from'./local-store';
import{validateBackupProfiles,referencedBackupFiles}from'../backup/full-backup';
import{captureDeviceHistory}from'../devices/history-data';
const gif=Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'),c=>c.charCodeAt(0));
const owner=encodeAccountId(new Uint8Array(20).fill(1)),peer=encodeAccountId(new Uint8Array(20).fill(2));
beforeEach(()=>{vi.stubGlobal('indexedDB',new IDBFactory());vi.stubGlobal('IDBKeyRange',IDBKeyRange);const map=new Map();vi.stubGlobal('localStorage',{getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>map.set(k,v)});});
afterEach(()=>vi.unstubAllGlobals());
async function fixture(){
 const f=await prepareMedia(gif,'tiny.gif'),file={id:crypto.randomUUID(),name:f.asset.name,mime:f.asset.mime,size:gif.length,sha256:f.asset.hash,details:{media:{kind:'sticker' as const}}};
 let chats=ensureConversation(emptySessionChats(),peer);
 for(let i=0;i<2;i++){const id=crypto.randomUUID();chats=recordSentMessage(chats,peer,{id,from:owner,text:'',timestamp:1,direction:'outgoing',file:{...file,id},details:file.details,fileStatus:'ready',delivery:'delivered'});}
 const linked=linkCachedMedia(chats,f.asset),library=cacheMedia(emptyMediaLibrary(),f),key=await deriveChatStoreKey(new Uint8Array(32).fill(5),owner);
 const data=normalizeLocalChatData({mediaLibrary:library,chats:saveChats(linked.chats)});return{f,file,chats:linked.chats,library,key,data};
}
describe('profile-local sticker content references',()=>{
 it('rebases a stale pack edit onto a concurrently received canonical copy',async()=>{
  const f=await fixture(),baseline=emptyMediaLibrary(),incoming=f.library;
  const imported={...f.f,asset:{...f.f.asset,id:crypto.randomUUID()}},pack=await makePack('imported',[imported]);
  const proposed=addMedia(baseline,[imported],pack),next=rebaseMediaLibrary(proposed,baseline,incoming,f.chats);
  expect(next.assets).toHaveLength(1);expect(next.assets[0].id).toBe(f.f.asset.id);
  expect(next.packs[0]).toEqual(pack);expect(next.cached).toContain(f.f.asset.hash);
 });
 it('keeps new cache entries during stale edits and respects explicit clearing unless messages reference them',async()=>{
  const f=await fixture(),baseline=emptyMediaLibrary();
  expect(rebaseMediaLibrary(baseline,baseline,f.library,emptySessionChats()).assets).toEqual(f.library.assets);
  const cleared=pruneMedia({...f.library,cached:[]});
  expect(rebaseMediaLibrary(cleared,f.library,f.library,emptySessionChats()).assets).toHaveLength(0);
  const protectedCopy=rebaseMediaLibrary(cleared,f.library,f.library,f.chats);
  expect(protectedCopy.assets).toHaveLength(1);expect(protectedCopy.cached).toContain(f.f.asset.hash);
 });
 it('stores one encrypted blob for several messages and collections and resolves logical reads',async()=>{
  const f=await fixture(),pack=await makePack('one',[f.f]),second=await makePack('two',[f.f]);
  const library=addMedia(addMedia(f.library,[f.f],pack),[f.f],second);
  expect(library.assets).toHaveLength(1);
  await saveLocalSessionData(f.key,owner,{...f.data,mediaLibrary:library},new Map([[libraryFileId(f.f.asset.id),gif]]));
  const rows=f.chats.byPeer[peer].messages;
  for(const row of rows)expect(await loadLocalFileData(f.key,owner,peer+':'+row.id)).toEqual(gif);
  expect((await inspectChatStorage(owner)).files).toHaveLength(1);
  expect(await loadLocalFileData(f.key,peer,libraryFileId(f.f.asset.id))).toBeNull();
  const data=structuredClone(f.data);data.chats.byPeer[peer].messages[0].fileDeleted=true;await saveLocalChatData(f.key,owner,data);
  expect(await loadLocalFileData(f.key,owner,peer+':'+rows[0].id)).toBeNull();
  expect(await loadLocalFileData(f.key,owner,peer+':'+rows[1].id)).toEqual(gif);
 });
 it('keeps shared blobs in full backups and materializes device history without foreign local references',async()=>{
  const f=await fixture(),id=libraryFileId(f.f.asset.id);
  await saveLocalSessionData(f.key,owner,f.data,new Map([[id,gif]]));
  expect([...referencedBackupFiles(f.data).keys()]).toEqual([id]);
  expect((await validateBackupProfiles([{accountId:owner,data:f.data,files:new Map([[id,gif]])}],new Set([owner]),()=>{})).missingFiles).toBe(0);
  const history=await captureDeviceHistory(owner,f.key,[peer],true,()=>{});
  expect(history.files.size).toBe(2);
  for(const m of history.data.chats.byPeer[peer].messages){expect(m.mediaRef).toBeUndefined();expect(history.files.get(peer+':'+m.id)).toEqual(gif);}
 });
 it('does not reuse disappearing files or expose cache hashes as storage names',async()=>{
  const f=await fixture();expect(reusableMedia({...f.file,details:{...f.file.details,ephemeral:{views:1,allowDownload:false}}})).toBe(false);
  expect(libraryFileId(f.f.asset.id)).not.toContain(f.f.asset.hash);
  const secret={...f.chats.byPeer[peer].messages[0],mediaRef:undefined,details:{...f.file.details,ephemeral:{views:1,allowDownload:false}}};
  const c=structuredClone(f.chats);c.byPeer[peer].messages=[secret];
  expect(linkCachedMedia(c,f.f.asset).logical).toEqual([]);
 });
 it('retains message bytes after pack removal but lets unused cache be pruned',async()=>{
  const f=await fixture(),pack=await makePack('one',[f.f]),library=addMedia(emptyMediaLibrary(),[f.f],pack);
  const removed=pruneMedia({...library,packs:[]});
  expect(retainMessageMedia(removed,library,f.chats).assets).toHaveLength(1);
  expect(retainMessageMedia(removed,library,emptySessionChats()).assets).toHaveLength(0);
  expect(pruneMedia({...f.library,cached:[]}).assets).toHaveLength(0);
 });
 it('rebuilds immutable pack identity for renaming, additions and cover order without cloning bytes',async()=>{
  const a=await prepareMedia(gif,'a.gif'),other=gif.slice();other[other.length-2]^=1;const b=await prepareMedia(other,'b.gif');
  const pack=await makePack('old',[a]),library=addMedia(emptyMediaLibrary(),[a],pack);
  const next=await editMediaPack(library,pack.id,'new',[b.asset.hash,a.asset.hash,a.asset.hash],[b]);
  expect(next.packs[0].name).toBe('new');expect(next.packs[0].id).not.toBe(pack.id);
  expect(next.packs[0].assets).toEqual([b.asset.hash,a.asset.hash]);expect(next.assets).toHaveLength(2);expect(next.assets.find(x=>x.hash===a.asset.hash)?.id).toBe(a.asset.id);
  expect(next.packs[0].previousIds).toContain(pack.id);
 });
 it('derives request/answer buttons from durable chat history',async()=>{
  const id='a'.repeat(64),request={id:crypto.randomUUID(),from:peer,direction:'incoming',text:'',timestamp:2,details:{media:{kind:'pack-request',packId:id,packName:'p'}}} as ChatEntry;
  expect(packRequestAnswered([request],request)).toBe(false);
  const sent={...request,id:crypto.randomUUID(),direction:'outgoing' as const,timestamp:3,details:{media:{kind:'sticker-pack' as const,packId:id,packName:'p'}}};
  expect(packRequestAnswered([request,sent],request)).toBe(true);
  expect(packRequested([{...request,direction:'outgoing'}],id)).toBe(true);
  const updated={...sent,details:{media:{...sent.details.media,packId:'b'.repeat(64)},reply:{id:request.id,from:peer,preview:''}}};
  expect(packRequestAnswered([request,updated],request)).toBe(true);
 });
 it('prevents an older v2 reader from overwriting shared-reference metadata',async()=>{
  const f=await fixture();await saveLocalSessionData(f.key,owner,f.data,new Map([[libraryFileId(f.f.asset.id),gif]]));
  await expect(new Promise((resolve,reject)=>{const request=indexedDB.open('mesh-autonomy-local-chats',2);request.onerror=()=>reject(request.error);request.onsuccess=()=>{request.result.close();resolve(true);};})).rejects.toMatchObject({name:'VersionError'});
  expect(await loadLocalFileData(f.key,owner,peer+':'+f.chats.byPeer[peer].messages[0].id)).toEqual(gif);
 });
});
