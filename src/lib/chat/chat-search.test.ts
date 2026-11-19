import {describe,expect,it} from 'vitest';
import {searchMessages} from './chat-search';
import type {ChatEntry} from './session-chats';
const base={from:'peer',direction:'incoming' as const,timestamp:new Date(2026,10,19,12).getTime(),text:''};
const file=(id:string,mime:string):ChatEntry=>({...base,id,file:{id,name:`${id}.example`,size:10,mime,sha256:'a'.repeat(64)}});
const rows:ChatEntry[]=[file('photo','image/jpeg'),file('video','video/webm'),file('voice','audio/ogg'),file('document','application/pdf'),
 {...file('sticker','image/webp'),details:{media:{kind:'sticker'}}},{...base,id:'link',text:'See https://example.test/page'},
 {...base,id:'unsafe',text:'https://user:password@example.test/'},{...file('hidden','image/png'),details:{ephemeral:{views:1,allowDownload:false}}}];
describe('typed conversation search',()=>{
 it('filters by content without needing a text query and keeps ordinary search compatible',()=>{
  expect(searchMessages(rows,'')).toEqual([]);
  for(const [kind,id]of [['images','photo'],['videos','video'],['audio','voice'],['links','link']]as const)
   expect(searchMessages(rows,'','',kind).map(m=>m.id)).toEqual([id]);
  expect(searchMessages(rows,'','', 'files')).toHaveLength(5);
 });
 it('combines date, text and type without exposing disappearing content',()=>{
  expect(searchMessages(rows,'photo','2026-11-19','images').map(m=>m.id)).toEqual(['photo']);
  expect(searchMessages(rows,'photo','2026-11-18','images')).toEqual([]);
  expect(searchMessages(rows,'hidden')).toEqual([]);
 });
 it('does not change history, delivery or file data while filtering',()=>{
  const before=JSON.stringify(rows);searchMessages(rows,'','', 'images');expect(JSON.stringify(rows)).toBe(before);
 });
});
