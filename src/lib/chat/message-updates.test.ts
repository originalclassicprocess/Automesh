import{describe,expect,it}from'vitest';
import{presentMessages,nextUpdateRevision,editableText,retryMessageUpdate}from'./message-updates';
import{decodeChatContent,encodeChatContent,normalizeMessageDetails,RICH_PREFIX,UPDATE_PREFIX}from'./message-details';
import{unreadMessageCount,type ChatEntry}from'./session-chats';
import{normalizeFileOffer}from'./file-transfer';
import{normalizeLocalChatData}from'./local-store';
import{encodeAccountId}from'../addressing/bech32m.js';
const self='alice',peer='bob',target='11111111-1111-4111-8111-111111111111';
const original:ChatEntry={id:target,from:self,direction:'outgoing',timestamp:1,text:'original',delivery:'delivered'};
const edit=(revision:number,text='new',from=self):ChatEntry=>({id:crypto.randomUUID(),from,direction:from===self?'outgoing':'incoming',timestamp:2,text,details:{edit:{targetId:target,revision}}});
const react=(revision:number,emoji:string|null='👍',from=peer):ChatEntry=>({id:crypto.randomUUID(),from,direction:from===self?'outgoing':'incoming',timestamp:3,text:'',details:{reaction:{targetId:target,revision,emoji}}});
describe('authenticated message update projection',()=>{
 it('retries the latest canceled update with a newer revision and never rolls later changes back',()=>{
  const first=edit(1),later=edit(2,'latest');const retry=retryMessageUpdate([original,first],first,self)!;
  expect(retry.details.edit?.revision).toBe(2);expect(retryMessageUpdate([original,first,later],first,self)).toBeNull();expect(retryMessageUpdate([first],first,self)).toBeNull();
  const tie={...edit(1,'new tie'),id:'ffffffff-ffff-4fff-8fff-ffffffffffff'};expect(retryMessageUpdate([original,{...first,id:target},tie],{...first,id:target},self)).toBeNull();
  const remove=react(2,null,self);expect(retryMessageUpdate([original,react(1,'👍',self),remove],remove,self)?.details.reaction).toMatchObject({emoji:null,revision:3});
 });
 it('preserves originals, edits, reactions and receipts through encrypted-history normalization',()=>{
  const a=encodeAccountId(new Uint8Array(20).fill(1)),b=encodeAccountId(new Uint8Array(20).fill(2));
  const messages=[{...original,from:a},{...edit(1),from:a},{...react(1),from:b}];
  const saved=normalizeLocalChatData({chats:{order:[b],byPeer:{[b]:{messages,contact:'accepted'}}}});
  const raw=saved.chats.byPeer[b].messages,shown=presentMessages(raw,a,b);expect(raw).toHaveLength(3);expect(raw[0].text).toBe('original');expect(raw[0].delivery).toBe('delivered');
  expect(shown[0]).toMatchObject({text:'new',edited:true,reactions:[{emoji:'👍',actors:[b]}]});
 });
 it('uses a separate version so older chat decoders cannot display an empty update',()=>{
  const c=edit(1);const wire=encodeChatContent(c.text,c.details);expect(wire.startsWith(UPDATE_PREFIX)).toBe(true);expect(wire.startsWith(RICH_PREFIX)).toBe(false);
  expect(decodeChatContent(wire)).toEqual({text:c.text,details:c.details});
  expect(decodeChatContent(RICH_PREFIX+JSON.stringify({text:c.text,details:c.details}))).toBeNull();
  expect(()=>encodeChatContent('',c.details)).toThrow();expect(()=>encodeChatContent('body',react(1).details)).toThrow();
 });
 it('rejects mixed intent, extra actors, invalid revisions, targets, reactions and file offers',()=>{
  for(const details of [{edit:{targetId:target,revision:0}},{edit:{targetId:'x',revision:1}},{edit:{targetId:target,revision:1,actor:self}},{...edit(1).details,forwarded:{sourceId:target}},{reaction:{targetId:target,revision:1,emoji:'<script>'}}])expect(normalizeMessageDetails(details)).toBeNull();
  expect(normalizeFileOffer({id:target,name:'x',size:0,mime:'text/plain',sha256:'a'.repeat(64),details:edit(1).details})).toBeNull();
 });
 it('edits only the authenticated original author, never another participant or spoofed direction',()=>{
  for(const attack of [edit(1,'forged',peer),edit(1,'forged','stranger'),{...edit(1),direction:'incoming' as const}])expect(presentMessages([original,attack],self,peer)[0].text).toBe('original');
  const before=JSON.stringify(original),shown=presentMessages([original,edit(1)],self,peer)[0];expect(shown.text).toBe('new');expect(shown.edited).toBe(true);expect(shown.delivery).toBe('delivered');expect(JSON.stringify(original)).toBe(before);
 });
 it('converges for out-of-order events, duplicate delivery and controls arriving before originals',()=>{
  const a=edit(1,'first'),b=edit(2,'second');expect(presentMessages([b,a,original,b],self,peer)[0].text).toBe('second');
  expect(presentMessages([a,b],self,peer)).toEqual([]);expect(presentMessages([a,b,original],self,peer)[0].text).toBe('second');
  const x=edit(3,'x'),y=edit(3,'y');expect(presentMessages([original,x,y],self,peer)).toEqual(presentMessages([original,y,x],self,peer));
 });
 it('keeps reaction ownership separate and a removal tombstone cannot be replayed away',()=>{
  const a=react(1),own=react(1,'❤️',self),remove=react(2,null);
  expect(presentMessages([original,a,own],self,peer)[0].reactions).toHaveLength(2);
  expect(presentMessages([original,remove,a,own,a],self,peer)[0].reactions).toEqual([{emoji:'❤️',actors:[self]}]);
  expect(presentMessages([original,react(9,'🔥','stranger')],self,peer)[0].reactions).toBeUndefined();
 });
 it('does not edit files, disappearing messages, forwarded claims or radio content',()=>{
  for(const m of [{...original,file:{id:target,name:'x',size:0,mime:'text/plain',sha256:'a'.repeat(64)}},{...original,details:{ephemeral:{views:1,allowDownload:false}}},{...original,details:{forwarded:{sourceId:target}}},{...original,radioDelivery:'received' as const}]){expect(editableText(m)).toBe(false);expect(presentMessages([m,edit(1)],self,peer)[0].text).toBe('original');}
 });
 it('does not count controls as new chat messages, resurrect deleted originals or modify receipts',()=>{
  const updates=[edit(1),react(1)];expect(unreadMessageCount(updates)).toBe(0);expect(presentMessages(updates,self,peer)).toEqual([]);
  expect(nextUpdateRevision(updates,self,target,'edit')).toBe(2);expect(nextUpdateRevision(updates,peer,target,'reaction')).toBe(2);
 });
});
