import { describe, expect, it } from 'vitest';
import { prepareChatStorageCleanup, formatBytes, managedFiles, filterStoredFiles, fileBytes, chatStorageUsage, measureMediaLibrary,
  storageBreakdown, withoutStickerPacks, type ManagedFile } from './storage-summary';
import { libraryFileId, type MediaLibrary } from '$lib/chat/media-library';
import type { LocalChatData } from '$lib/chat/local-store';
import { emptySessionChats, ensureConversation, updateConversation } from '$lib/chat/session-chats';
describe('storage dashboard without secrets', () => {
  it('cleans an old durable archive without writing new untrusted messages or dropping settings', () => {
    const data: LocalChatData = { selfNickname: 'Old', readReceiptsEnabled: false, autoLockMinutes: 5, aliases: { peer: 'Friend' },
      declaredNames: {}, peerReadPreferences: {}, peerPublicKeys: {}, chats: { order: ['peer'], byPeer: { peer: { contact: 'blocked', messages: [
        { id: 'a', from: 'peer', timestamp: 1, text: '', direction: 'incoming', fileStatus: 'ready',
          file: { id: 'a', name: 'old.png', mime: 'image/png', size: 10, sha256: 'a'.repeat(64) } },
        { id: 'b', from: 'peer', timestamp: 2, text: 'old text', direction: 'incoming' },
      ] } } } };
    const selected = prepareChatStorageCleanup(data, {kind:'files',label:'file',ids:['peer:a']}, ['peer:a']).snapshot;
    expect(selected.chats.byPeer.peer.messages[0]).toMatchObject({ fileDeleted: true, fileStatus: 'canceled' });
    expect(selected.chats.byPeer.peer.messages[1].text).toBe('old text');
    expect(data.chats.byPeer.peer.messages[0].fileStatus).toBe('ready');
    const textOnly = prepareChatStorageCleanup(data, {kind:'history'}, ['peer:a']);
    expect(textOnly.ids).toEqual([]);
    expect(textOnly.snapshot.chats.byPeer.peer.messages).toEqual([data.chats.byPeer.peer.messages[0]]);
    expect(textOnly.snapshot.chats.byPeer.peer.deletedIds).toEqual(['b']);
    const cleared = prepareChatStorageCleanup(data, {kind:'chat',peer:'peer'}, ['peer:a']).snapshot;
    expect(cleared.chats.byPeer.peer.messages).toEqual([]);
    expect(cleared.chats.byPeer.peer.contact).toBe('blocked');
    expect(cleared.aliases).toEqual({ peer: 'Friend' }); expect(cleared.chats.byPeer.peer.contact).toBe('blocked');
    expect(cleared.autoLockMinutes).toBe(5);
  });
  it('matches only current account file records and distinguishes disk/memory/orphans', () => {
    let state = ensureConversation(emptySessionChats(), 'peer');
    state = updateConversation(state, 'peer', c => ({ ...c, messages: [{ id: 'image', from: 'peer', text: '', timestamp: 1,
      direction: 'incoming', file: { id: 'image', name: 'photo.png', mime: 'image/png', size: 10, sha256: 'a'.repeat(64) } }] }));
    const files = managedFiles(state, { historyBytes: 100, otherAccountBytes: 1000, allFileBytes: 1090,
      files: [{ id: 'peer:image', bytes: 38 }, { id: 'orphan', bytes: 52 }] }, new Map([['peer:image', new Uint8Array(10)]]));
    expect(files).toHaveLength(2); expect(files[0]).toMatchObject({ name: 'photo.png', category: 'image', bytes: 38, memoryBytes: 10 });
    expect(files[1]).toMatchObject({ name: 'Файл вне истории', category: 'other', peer: '' });
    expect(files).not.toContainEqual(expect.objectContaining({ bytes: 1000 }));
  });
  it('filters by inclusive local calendar dates, excludes unknown dates and never expands invalid ranges', () => {
    const item=(id:string,timestamp?:number):ManagedFile=>({id,peer:'p',messageId:id,name:`${id}.jpg`,category:'image',bytes:100,memoryBytes:80,timestamp});
    const rows=[item('early',new Date(2026,10,10,23,59).getTime()),item('start',new Date(2026,10,11).getTime()),
      item('end',new Date(2026,10,11,23,59,59,999).getTime()),item('later',new Date(2026,10,12).getTime()),item('unknown')];
    expect(filterStoredFiles(rows,{from:'2026-11-11',to:'2026-11-11'}).map(f=>f.id)).toEqual(['end','start']);
    expect(filterStoredFiles(rows,{from:'2026-02-30'})).toEqual([]);
    expect(filterStoredFiles(rows,{from:'2026-11-12',to:'2026-11-10'})).toEqual([]);
    expect(filterStoredFiles(rows,{peer:'other'})).toEqual([]);
    expect(filterStoredFiles(rows,{query:'start'}).map(f=>f.id)).toEqual(['start']);
    const archive:LocalChatData={selfNickname:'',readReceiptsEnabled:true,autoLockMinutes:15,peerReadPreferences:{},aliases:{},declaredNames:{},peerPublicKeys:{},
      chats:{order:['p'],byPeer:{p:{messages:rows.filter(f=>f.timestamp!==undefined).map(f=>({id:f.id,from:'p',timestamp:f.timestamp!,direction:'incoming',text:'',file:{id:f.id,name:f.name,mime:'image/jpeg',size:80,sha256:'a'.repeat(64)}}))}}}};
    const chosen = filterStoredFiles(rows,{from:'2026-11-11',to:'2026-11-11'}).map(f=>`p:${f.id}`);
    const cleaned = prepareChatStorageCleanup(archive,{kind:'files',label:'period',ids:chosen},chosen).snapshot;
    expect(cleaned.chats.byPeer.p.messages.filter(m=>m.fileDeleted).map(m=>m.id)).toEqual(['start','end']);
    expect(archive.chats.byPeer.p.messages.some(m=>m.fileDeleted)).toBe(false);
  });
  it('counts a disk and resident copy once and groups unattached files separately', () => {
    const rows:ManagedFile[]=[{id:'p:a',peer:'p',messageId:'a',name:'a',category:'other',bytes:100,memoryBytes:80},
      {id:'p:b',peer:'p',messageId:'b',name:'b',category:'other',bytes:0,memoryBytes:40},
      {id:'orphan',peer:'',messageId:'',name:'orphan',category:'other',bytes:20,memoryBytes:0}];
    expect(rows.map(fileBytes)).toEqual([100,40,20]);
    expect(chatStorageUsage(ensureConversation(emptySessionChats(),'p'),rows)).toMatchObject([{peer:'p',bytes:140,files:2},{peer:'',bytes:20,files:1}]);
  });
  it('formats payload size without claiming to measure physical RAM', () => {
    expect(formatBytes(0)).toBe('0 Б'); expect(formatBytes(1024)).toBe('1.0 КБ');
    expect(formatBytes(1048576)).toBe('1.0 МБ'); expect(formatBytes(NaN)).toBe('Неизвестно');
  });
  it('counts shared library assets once and preserves GIFs when all packs are removed', () => {
    const gif = { id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', hash:'a'.repeat(64), name:'a.gif', mime:'image/gif', size:40, favorite:false, usedAt:0 };
    const sticker = { ...gif, id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', hash:'b'.repeat(64), name:'b.png', mime:'image/png' };
    const media: MediaLibrary = { assets:[gif,sticker], gifs:[gif.hash], packs:[{id:'c'.repeat(64),name:'Pack',assets:[gif.hash,sticker.hash]}] };
    const disk = { historyBytes:20, otherAccountBytes:3, allFileBytes:136,
      files:[{id:libraryFileId(gif.id),bytes:68},{id:libraryFileId(sticker.id),bytes:68}] };
    expect(measureMediaLibrary(disk, media)).toEqual({gifs:0,packs:68,shared:68,cached:0});
    expect(withoutStickerPacks(media)).toEqual({assets:[gif],gifs:[gif.hash],packs:[]});
  });
  it('allocates the gap in browser estimates without adding memory-only files or counting models twice', () => {
    const rows: ManagedFile[] = [{id:'p:f',peer:'p',messageId:'f',name:'a',category:'other',bytes:100,memoryBytes:72},
      {id:'p:g',peer:'p',messageId:'g',name:'b',category:'other',bytes:0,memoryBytes:200}];
    const usage = {app:{scripts:20,styles:10,shell:10,ai:30},history:20,other:10,modelBytes:500,
      media:{gifs:5,packs:10,shared:0,cached:0},incomplete:false,origin:765};
    const breakdown = storageBreakdown(usage, rows);
    expect(breakdown).toMatchObject({total:765,measured:715,estimated:true});
    expect(breakdown.groups.find(group => group.id === 'browser')?.bytes).toBe(50);
    expect(storageBreakdown({...usage,origin:680},rows)).toMatchObject({total:715,origin:680,estimated:false});
  });
  it('removes files only in chosen chats and does not touch the protected library', () => {
    const keep = 'peer2:b';
    const packFile = libraryFileId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    const message = { id:'a', from:'peer', text:'caption', direction:'incoming' as const, timestamp:1,
      file:{id:'a',name:'a.gif',mime:'image/gif',size:9,sha256:'a'.repeat(64)} };
    const archive: LocalChatData = { selfNickname:'Owner', readReceiptsEnabled:true, autoLockMinutes:15,
      aliases:{}, declaredNames:{}, peerPublicKeys:{}, peerReadPreferences:{}, chats:{order:['peer','peer2'],byPeer:{
        peer:{messages:[message]}, peer2:{messages:[{...message,id:'b',from:'peer2'}]},
      }} };
    const files = ['peer:a', keep, packFile, 'orphan'];
    const scoped = prepareChatStorageCleanup(archive, {kind:'chat-files',peers:['peer']}, files);
    expect(scoped.ids).toEqual(['peer:a']);
    expect(scoped.snapshot.chats.byPeer.peer.messages[0]).toMatchObject({text:'caption',fileDeleted:true});
    expect(scoped.snapshot.chats.byPeer.peer2).toEqual(archive.chats.byPeer.peer2);
    expect(prepareChatStorageCleanup(archive,{kind:'all-files'},files).ids).toEqual(['peer:a',keep,'orphan']);
  });
});
