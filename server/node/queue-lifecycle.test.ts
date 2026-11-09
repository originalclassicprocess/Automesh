import {createHash,webcrypto} from 'node:crypto';
import {courierBytes,COURIER_PROTOCOL} from '../../nodes/packages/protocol/src/index.js';
import {it,expect,afterEach,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {CourierController} from '$lib/node/courier-controller';
import {Courier} from '../../nodes/packages/runtime/src/courier.js';
import {job,identity,protector} from '../../nodes/test/fixtures.mjs';
import {emptyCourierState,type CourierState} from '$lib/node/courier-state';
import {emptySessionChats,ensureConversation,setContactState,setDeliveryStatus} from '$lib/chat/session-chats';
const paths:string[]=[],controllers:CourierController[]=[],nodes:any[]=[];
afterEach(async()=>{for(const c of controllers.splice(0)){c.stop();await c.settled();}for(const c of nodes.splice(0))await c.close();vi.restoreAllMocks();for(const p of paths.splice(0))await rm(p,{recursive:true,force:true});});
async function setup(){
 const path=await mkdtemp(join(tmpdir(),'automesh-client-lifecycle-'));paths.push(path);
 const c=await new Courier(path,{secretProtector:protector(),localInternetEnabled:true}).initialize();nodes.push(c);
 const [a,b]=await Promise.all([identity(),identity()]),j=await job(c.address,a,b);await c.put(a.address,j);
 let s:CourierState={...emptyCourierState(),enabled:true,node:{url:'https://node.example',nodeId:'a'.repeat(32),address:c.address},pending:[j]};
 let chats=setContactState(ensureConversation(emptySessionChats(),b.address),b.address,'accepted');chats.byPeer[b.address].messages=[{id:j.body.id,text:'hello',timestamp:Date.now(),from:a.address,direction:'outgoing',delivery:'stored'}];
 let puts=0,online=true;
 const controller=new CourierController({address:a.address,identity:{} as any,state:()=>s,update:v=>s=v,chats:()=>chats,persist:async()=>true,receive:()=>{},publish:async()=>{},error:()=>{},
  outcome:(peer,id,nodeQueue)=>{const m=chats.byPeer[peer].messages.find(m=>m.id===id)!;if(!['delivered','read'].includes(m.delivery??''))m.nodeQueue=nodeQueue;},
  delivery:(peer,id,value)=>chats=setDeliveryStatus(chats,peer,id,value),
  request:async(_url,_id,_identity,_owner,path,body:any):Promise<any>=>{
   if(!online)throw Error('offline');
   if(path==='/outbox/status')return c.stats(a.address);
   if(path==='/outbox/outcomes')return {outcomes:await c.box.outcomes(a.address,body.ids),checkedAt:c.box.now()};
   if(path==='/outbox/receipts')return {receipts:await c.box.receipts(a.address,body.ids)};
   if(path==='/outbox/cancel')return c.cancel(a.address,body.job);
   if(path==='/outbox/put'){puts++;return c.put(a.address,body.job);}
   if(path==='/inbox/list')return {deliveries:[],cursor:''};
   throw Error('unexpected '+path);
  }});controllers.push(controller);
 return {c,j,a,b,controller,get state(){return s;},get message(){return chats.byPeer[b.address].messages[0];},get puts(){return puts;},offline:()=>online=false,online:()=>online=true};
}
it('reconnect discovers cancellation before any upload, and does not re-encrypt/re-upload on later polls',async()=>{
 const f=await setup();await f.c.cancel(f.a.address,f.j);await f.controller.poll();expect(f.message.nodeQueue).toBe('canceled');expect(f.state.pending).toHaveLength(0);
 await f.controller.poll();expect(f.puts).toBe(0);expect(f.message.delivery).toBe('stored'); // receipt is never fabricated
});
it('expiry reports a terminal state instead of silently retrying an old message',async()=>{
 const f=await setup();vi.spyOn(Date,'now').mockReturnValue(f.j.body.expiresAt+1);f.c.box.now=()=>Date.now();
 await f.controller.poll();expect(f.message.nodeQueue).toBe('expired');expect(f.puts).toBe(0);expect(f.state.pending).toHaveLength(0);
});
it('offline cancellation remains pending and retries when the node becomes reachable',async()=>{
 const f=await setup();f.offline();await expect(f.controller.cancel(f.j.body.id)).rejects.toThrow('offline');expect(f.message.nodeQueue).toBe('canceling');expect(f.state.pending).toHaveLength(1);
 f.online();await f.controller.poll();expect(f.message.nodeQueue).toBe('canceled');expect(f.puts).toBe(0);expect(f.c.stats(f.a.address).messages).toBe(0);
});

it('a recipient-signed delivery wins if it was saved before the cancellation request',async()=>{
 const f=await setup(),body={protocol:COURIER_PROTOCOL,from:f.b.address,to:f.a.address,id:f.j.body.id,digest:createHash('sha256').update(f.j.body.packet).digest('hex')};
 const receipt=JSON.stringify({body,publicKey:f.b.publicKey,signature:Buffer.from(await webcrypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},f.b.keys.privateKey,courierBytes('receipt',body))).toString('hex')});
 await f.c.acceptReceipt({from:f.b.address,id:f.j.body.id.replaceAll('-',''),receipt});
 await f.controller.cancel(f.j.body.id);expect(f.message.delivery).toBe('delivered');expect(f.message.nodeQueue).toBeUndefined();expect(f.state.pending).toHaveLength(0);
});

it('does not announce expiry solely because the client clock is ahead of the node',async()=>{
 const f=await setup(),nodeNow=Date.now();f.c.box.now=()=>nodeNow;
 vi.spyOn(Date,'now').mockReturnValue(f.j.body.expiresAt+1000);
 await f.controller.poll();expect(f.message.nodeQueue).toBeUndefined();expect(f.state.pending).toHaveLength(1);
});
