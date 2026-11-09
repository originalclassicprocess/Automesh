import { it, expect, vi } from 'vitest';
import { CourierController } from './courier-controller';
import { emptyCourierState, type CourierState } from './courier-state';
import { generateCourierKey, signCourier } from './courier-crypto';
import { COURIER_PROTOCOL } from './courier-protocol.js';
import { WebCryptoIdentity } from '../identity/webcrypto';
import { accountIdFromPublicKey } from '../addressing/account-id.js';
import { emptySessionChats,recordSentMessage,setContactState, type SessionChats } from '../chat/session-chats';
import type { DeliveryIssue } from '../application/delivery-issues';

async function setup({online=false,fallback=false,saving=false,keys='ready',contact='accepted',deny=false,home=false,authorize}:
  {online?:boolean;fallback?:boolean;saving?:boolean;keys?:'ready'|'missing'|'expired'|'exhausted';contact?:'accepted'|'outgoing';deny?:boolean;home?:boolean;
    authorize?(chats:SessionChats,call:number):void}={}) {
  const a=new WebCryptoIdentity(),b=new WebCryptoIdentity(),n=new WebCryptoIdentity();await Promise.all([a.create(),b.create(),n.create()]);
  const [self,peer,node]=await Promise.all([a,b,n].map(async id=>accountIdFromPublicKey(await id.getPublicKeyBytes())));
  const id=crypto.randomUUID(); let chats=recordSentMessage(emptySessionChats(),peer,{id,from:self,text:'Primary text',timestamp:Date.now(),direction:'outgoing',delivery:saving?'saving':'queued',directFallback:fallback});
  chats=setContactState(chats,peer,contact);chats.byPeer[peer].connection=online?'connected':'offline';
  let state:CourierState={...emptyCourierState(),enabled:true,node:{url:home?'https://192.168.0.10:3003':'https://node.example',nodeId:'a'.repeat(32),address:node}};
  if(keys!=='missing'){
    const expiresAt=Date.now()+(keys==='expired'?-1000:3600000),key=await generateCourierKey(self,expiresAt);
    state.bundles[peer]=await signCourier('prekeys',{protocol:COURIER_PROTOCOL,from:peer,to:self,expiresAt,keys:[{id:key.id,publicKey:key.publicKey}]},b);
    if(keys==='exhausted')state.used[key.id]=Date.now()+3600000;
  }
  const issues:DeliveryIssue[]=[],deposits:unknown[]=[],persist=vi.fn(async()=>true);
  let authorizationCalls=0;
  const worker=new CourierController({address:self,identity:a,state:()=>state,update:s=>state=s,chats:()=>chats,persist,
    receive:()=>{},delivery:()=>{},publish:async()=>{},error:()=>{},issue:(_p,_id,code)=>{if(code)issues.push(code);},
    authorize:async()=>{if(deny)throw new Error('primary_disabled');authorize?.(chats,++authorizationCalls);},
    request:async(_url,_node,_identity,_address,path,body:any)=>{
      if(path==='/outbox/status')return{address:node,enabled:true};
      if(path==='/outbox/put'){expect(state.pending.some(j=>j.body.id===id)).toBe(true);expect(persist).toHaveBeenCalled();deposits.push(body);return{status:'stored'};}
      if(path==='/outbox/receipts')return{receipts:[]};
      throw new Error('unexpected_test_request');
    }});
  return {worker,issues,deposits,get state(){return state;},close:async()=>{worker.stop();await worker.settled();a.dispose();b.dispose();n.dispose();}};
}
it.each(['delivered','blocked','deleted','delegated','restored'] as const)(
  'does not upload a stale job when the message becomes %s during authorization', async change => {
    const f=await setup({authorize:(chats,call)=>{
      if(call!==2)return; // First check reserves the job; second check precedes upload.
      const c=chats.byPeer[chats.order[0]], m=c.messages[0];
      if(change==='delivered')m.delivery='delivered';
      if(change==='blocked')c.contact='blocked';
      if(change==='deleted')c.messages=[];
      if(change==='delegated')m.deviceMessage=true;
      if(change==='restored')m.restoredFromBackup=true;
    }});
    try {
      await f.worker.poll();
      expect(f.deposits).toHaveLength(0);
      // A reservation is never recycled into a different ciphertext/key reuse.
      expect(Object.keys(f.state.used)).toHaveLength(1);
    }finally{await f.close();}
  });
it.each([
  {online:false,fallback:false,saving:false,count:1},
  {online:true,fallback:false,saving:false,count:0},
  {online:true,fallback:true,saving:false,count:1},
  {online:false,fallback:false,saving:true,count:0},
  {online:false,fallback:false,saving:false,home:true,count:1},
])('chooses courier only after local commit and offline/direct-failure decision: %j',async({count,...spec})=>{
  const f=await setup(spec);try{await f.worker.poll();expect(f.deposits).toHaveLength(count);}finally{await f.close();}
});
it.each([
  {keys:'missing' as const,reason:'keys_missing'},
  {keys:'expired' as const,reason:'keys_expired'},
  {keys:'exhausted' as const,reason:'keys_exhausted'},
  {contact:'outgoing' as const,reason:'contact_pending'},
  {deny:true,reason:'primary_disabled'},
])('does not invent rights or prekeys and gives a precise reason: %j',async({reason,...spec})=>{
  const f=await setup(spec);try{await f.worker.poll();expect(f.deposits).toHaveLength(0);expect(f.issues).toContain(reason);}finally{await f.close();}
});
