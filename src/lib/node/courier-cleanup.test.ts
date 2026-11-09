import {it,expect,vi} from 'vitest';
import {CourierController,type CourierStatus} from './courier-controller';
import {emptyCourierState} from './courier-state';
import {createCourierJob,generateCourierKey,verifyCourier,signCourier} from './courier-crypto';
import {WebCryptoIdentity} from '$lib/identity/webcrypto';
import {accountIdFromPublicKey} from '$lib/addressing/account-id.js';
import {emptySessionChats,ensureConversation,setContactState} from '$lib/chat/session-chats';
async function account(){const identity=new WebCryptoIdentity();await identity.create();return {identity,address:await accountIdFromPublicKey(await identity.getPublicKeyBytes())};}
it.each([false,true])('repairs delivered copies and retains retries after cleanup failure=%s, without blocking messaging',async(failFirst)=>{
  const [owner,peer,node]=await Promise.all([account(),account(),account()]);
  const expires=Date.now()+60000,key=await generateCourierKey(owner.address,expires);
  const file=(id:string)=>({protocol:'automesh-attachment-v1',id:id.replaceAll('-',''),size:1,bytes:17,chunks:1,chunkBytes:32768,digest:'a'.repeat(64)}) as const;
  const ids=Array.from({length:4},()=>crypto.randomUUID());
  const bundle=await signCourier('prekeys',{protocol:'automesh-courier-v1',from:peer.address,to:owner.address,expiresAt:expires,keys:[{id:key.id,publicKey:key.publicKey}]},peer.identity);
  const jobs=await Promise.all(ids.map((id,i)=>createCourierJob(owner.identity,owner.address,node.address,bundle,{id:key.id,publicKey:key.publicKey},id,Date.now(),'test',false,i===1||i===3?file(id):undefined)));
  const records=new Map(jobs.map(j=>[j.body.id,j]));
  const chats=setContactState(ensureConversation(emptySessionChats(),peer.address),peer.address,'accepted');
  chats.byPeer[peer.address].messages=ids.filter((_,i)=>i!==2).map((id,i)=>({id,from:owner.address,text:'test',direction:'outgoing',timestamp:1,delivery:'delivered',...(i?{file:{id,name:'test.bin',mime:'application/octet-stream',size:1,sha256:'a'.repeat(64)},fileStatus:i===1?'ready' as const:'offered' as const}:{})}));
  let state={...emptyCourierState(),node:{url:'https://node.example',nodeId:'a'.repeat(32),address:node.address},pending:[jobs[0],jobs[3]]};
  let release!:()=>void;const blocked=new Promise<void>(r=>release=r);let rejectCancel=failFirst;const outcomes=vi.fn();let status:CourierStatus|undefined;
  const worker=new CourierController({...owner,state:()=>state,update:s=>state=s as typeof state,chats:()=>chats,persist:async()=>true,receive:()=>{},publish:async()=>{},delivery:()=>{},error:()=>{},outcome:outcomes,status:s=>status=s,
    request:async(_u,_n,_i,_a,path,body:any)=>{
      if(path==='/outbox/status')return {address:node.address,messages:records.size,inventoryProtocol:'automesh-outbox-inventory-v1'};
      if(path==='/outbox/receipts')return {receipts:[]};
      if(path==='/outbox/list'){await blocked;return {protocol:'automesh-outbox-inventory-v1',jobs:[...records.values()],cursor:''};}
      if(path==='/outbox/cancel'){if(rejectCancel)throw Error('node_unavailable');await verifyCourier(body.job,'job',owner.address);records.delete(body.job.body.id);return {status:'canceled'};}
      throw Error('unexpected_request:'+path);
    }});
  try{
    await worker.poll();expect(status?.queue?.messages).toBe(4);expect(state.pending).toHaveLength(2); // poll finishes with blocked optional inventory
    release();await worker.settled();
    if(failFirst){
      expect(state.pending).toHaveLength(2);expect(records.size).toBe(4);expect(status?.cleanup).toMatchObject({stage:'cancel',error:'node_unavailable'});rejectCancel=false;
      const time=vi.spyOn(Date,'now').mockReturnValue(Date.now()+16000);
      try{await worker.poll();await worker.settled();}finally{time.mockRestore();}
    }
    expect([...records.keys()]).toEqual([ids[2],ids[3]]); // unknown history and offer-only file remain
    expect(state.pending.map(j=>j.body.id)).toEqual([ids[3]]);expect(status?.queue?.messages).toBe(2);
    expect(status?.cleanup).toBeUndefined();expect(outcomes).not.toHaveBeenCalled();expect(chats.byPeer[peer.address].messages.every(m=>m.delivery==='delivered')).toBe(true);
  }finally{release();worker.stop();await worker.settled();}
});
