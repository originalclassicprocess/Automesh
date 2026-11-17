import{describe,it,expect,vi,afterEach}from'vitest';import{StickerCacheExchange,cachePacket,type CachePacket}from'./sticker-cache-exchange';
const offer=()=>({id:crypto.randomUUID(),name:'a.gif',mime:'image/gif',size:10,sha256:'a'.repeat(64),details:{media:{kind:'sticker' as const}}});
afterEach(()=>vi.useRealTimers());
function fixture(){
 const sent:CachePacket[]=[],delivered=vi.fn(async()=>{}),receive=vi.fn(async()=>true);let active=true,accepted=true,ready=true;
 const service=new StickerCacheExchange({current:()=>active,accepted:()=>accepted,ready:()=>ready,send:async(_p,v)=>{sent.push(v);},delivered,receive});
 return{service,sent,delivered,receive,lock:()=>active=false,block:()=>accepted=false,offline:()=>ready=false};
}
describe('bounded authenticated cache rendezvous',()=>{
 it('coalesces probes and accepts only the matching peer, message and challenge',async()=>{
  const f=fixture(),o=offer();const first=f.service.probe('peer',o);expect(f.service.probe('peer',o)).toBe(first);expect(f.sent).toHaveLength(1);
  const p=f.sent[0];await f.service.receive('other',{op:'hit',request:p.request,id:o.id});expect(f.delivered).not.toHaveBeenCalled();
  await f.service.receive('peer',{op:'hit',request:crypto.randomUUID(),id:o.id});expect(f.delivered).not.toHaveBeenCalled();
  await f.service.receive('peer',{op:'hit',request:p.request,id:o.id});expect(await first).toBe(true);expect(f.delivered).toHaveBeenCalledTimes(1);f.service.close();
 });
 it('sends hit only after verified receiver persistence, never on a lookup alone',async()=>{
  const f=fixture();let release!:(v:boolean)=>void;f.receive.mockImplementation(()=>new Promise(r=>release=r));
  const packet={op:'probe' as const,request:crypto.randomUUID(),offer:offer(),timestamp:Date.now()};
  const pending=f.service.receive('peer',packet);expect(f.sent).toEqual([]);release(true);await pending;expect(f.sent[0].op).toBe('hit');f.service.close();
 });
 it('falls back after an old client ignores the probe and does not keep delaying uploads',async()=>{
  vi.useFakeTimers();const f=fixture(),o=offer();expect(f.service.defer('peer',o)).toBe(true);
  const result=f.service.probe('peer',o);await vi.advanceTimersByTimeAsync(2001);expect(await result).toBe(false);expect(f.service.defer('peer',o)).toBe(false);
  await f.service.receive('peer',{op:'hit',request:f.sent[0].request,id:o.id});expect(f.delivered).not.toHaveBeenCalled();f.service.close();
 });
 it('never probes a blocked/offline peer or a disappearing attachment and cancels pending work on lock',async()=>{
  const f=fixture(),o=offer();expect(f.service.defer('peer',{...o,details:{...o.details,ephemeral:{views:1,allowDownload:false}}})).toBe(false);
  const pending=f.service.probe('peer',o);f.lock();await f.service.receive('peer',{op:'hit',request:f.sent[0].request,id:o.id});f.service.close();expect(await pending).toBe(false);expect(f.delivered).not.toHaveBeenCalled();
  const b=fixture();b.block();expect(await b.service.probe('peer',offer())).toBe(false);b.service.close();
 });
 it('does not grant a receipt when durable saving fails and rejects oversized or malformed packets',async()=>{
  const f=fixture();f.receive.mockRejectedValue(Error('disk_full'));await f.service.receive('peer',{op:'probe',request:crypto.randomUUID(),offer:offer(),timestamp:Date.now()});expect(f.sent[0].op).toBe('miss');
  expect(cachePacket({op:'probe',request:crypto.randomUUID(),offer:offer(),timestamp:1})).toBeNull();
  expect(cachePacket({op:'hit',request:crypto.randomUUID(),id:crypto.randomUUID(),extra:true})).toBeNull();f.service.close();
 });
});
