import {it,expect,afterEach,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {CourierPrekeys} from '../../nodes/packages/runtime/src/prekeys.js';
import {COURIER_PREKEY_PROTOCOL} from '$lib/node/courier-prekeys.js';
import {CourierController} from '$lib/node/courier-controller';
import {emptyCourierState,restoreCourierState,type CourierState} from '$lib/node/courier-state';
import {signCourier,verifyCourier,type CourierBundle,type CourierJob} from '$lib/node/courier-crypto';
import {COURIER_PROTOCOL} from '$lib/node/courier-protocol.js';
import {cipherDigest} from '$lib/node/offline-crypto';
import {WebCryptoIdentity} from '$lib/identity/webcrypto';
import {accountIdFromPublicKey} from '$lib/addressing/account-id.js';
import {emptySessionChats,ensureConversation,setContactState} from '$lib/chat/session-chats';
const paths:string[]=[],workers:CourierController[]=[],identities:WebCryptoIdentity[]=[];
afterEach(async()=>{for(const w of workers.splice(0)){w.stop();await w.settled();}vi.restoreAllMocks();for(const i of identities.splice(0))i.dispose();for(const p of paths.splice(0))await rm(p,{recursive:true,force:true});});
async function account(){const identity=new WebCryptoIdentity();identities.push(identity);await identity.create();return {identity,address:await accountIdFromPublicKey(await identity.getPublicKeyBytes())};}
async function setup(){
  const [a,b,na,nb]=await Promise.all([account(),account(),account(),account()]);
  const path=await mkdtemp(join(tmpdir(),'automesh-client-prekeys-'));paths.push(path);
  const node={url:'https://receiver.example',nodeId:'b'.repeat(32),address:nb.address};
  const directory=await new CourierPrekeys(path,{nodeId:node.nodeId,isMember:(address:string)=>address===b.address,now:()=>Date.now()}).initialize();
  let bs:CourierState={...emptyCourierState(),node,enabled:true},as:CourierState={...emptyCourierState(),node:{url:'https://sender.example',nodeId:'a'.repeat(32),address:na.address},enabled:true};
  const bchats=setContactState(ensureConversation(emptySessionChats(),a.address),a.address,'accepted');
  const achats=setContactState(ensureConversation(emptySessionChats(),b.address),b.address,'accepted');
  let bundle:CourierBundle|undefined,save=true,committed=emptyCourierState(),received=0;const uploads:CourierJob[]=[],calls:string[]=[];
  const br=new CourierController({...b,state:()=>bs,update:s=>bs=s,chats:()=>bchats,persist:async()=>{if(save)committed=restoreCourierState(bs);return save;},
    receive:()=>received++,delivery:()=>{},publish:async(_peer,value)=>{bundle=value;},error:()=>{},
    request:async(_url,_node,_identity,_address,path,body:any):Promise<any>=>{
      calls.push(path);
      if(path==='/outbox/status')return {address:nb.address,enabled:true,signalingEnabled:true,prekeyProtocol:COURIER_PREKEY_PROTOCOL,prekeyPeers:directory.summary(b.address)};
      if(path==='/prekeys/status')return directory.status(b.address,body.peer);
      if(path==='/prekeys/publish')return directory.publish(b.address,body);
      if(path==='/prekeys/revoke')return directory.revoke(b.address,body.peer);
      if(path==='/outbox/receipts')return {receipts:[]};throw Error('Unexpected receiver endpoint '+path);
    }});workers.push(br);
  let sourceOnline=true;let stockGate:Promise<void>|undefined;let senderStatus:import('$lib/node/courier-controller').CourierStatus|undefined;
  const ar=new CourierController({...a,state:()=>as,update:s=>as=s,chats:()=>achats,persist:async()=>true,receive:()=>{},delivery:()=>{},publish:async()=>{},error:()=>{},status:value=>{senderStatus=value;},
    request:async(url,_node,_identity,_address,path,body:any):Promise<any>=>{
      if(path==='/prekeys/availability'){expect(url).toBe(node.url);await stockGate;if(!sourceOnline)throw Error('node_unavailable');return directory.availability(a.address,body);}
      if(path==='/prekeys/allocate'){expect(url).toBe(node.url);if(!sourceOnline)throw Error('node_unavailable');return directory.allocate(a.address,body);}
      expect(url).toBe('https://sender.example');
      if(path==='/outbox/status')return {address:na.address,enabled:true,routingProtocol:'automesh-courier-route-v1'};
      if(path==='/outbox/route'){await verifyCourier(body.route,'route',b.address);return {protocol:'automesh-courier-route-v1'};}
      if(path==='/outbox/put'){await verifyCourier(body.job,'job',a.address);uploads.push(body.job);return {status:'stored'};}
      if(path==='/outbox/receipts')return {receipts:[]};throw Error('Unexpected sender endpoint '+path);
    }});workers.push(ar);
  return {a,b,na,node,directory,br,ar,calls,uploads,blockStock:()=>{let unblock!:()=>void;stockGate=new Promise<void>(resolve=>unblock=resolve);return()=>{unblock();stockGate=undefined;};},activate:()=>{achats.activePeer=b.address;achats.byPeer[b.address].connection='connecting';},get stock(){return senderStatus?.keyStocks?.[b.address];},get bs(){return bs;},get as(){return as;},get bundle(){return bundle!;},get committed(){return committed;},get received(){return received;},
    save:(value:boolean)=>save=value,sourceOnline:(value:boolean)=>sourceOnline=value,
    enqueue:(n:number)=>{for(let i=0;i<n;i++)achats.byPeer[b.address].messages.push({id:crypto.randomUUID(),from:a.address,direction:'outgoing',text:'test-'+i,timestamp:Date.now(),delivery:'queued'});},
    consumeCached:()=>{for(const k of bundle!.body.keys.slice(0,-1))as.used[k.id]=bundle!.body.expiresAt+86400000;}};
}

it('refills through the recipient node without a direct chat and delivers beyond the initial batch',async()=>{
  const f=await setup();let now=Date.now();vi.spyOn(Date,'now').mockImplementation(()=>now);
  await f.br.poll();expect((await f.directory.status(f.b.address,f.a.address)).available).toHaveLength(32);
  await f.br.publish(f.a.address);expect(f.bundle.body.keySource).toEqual({url:f.node.url,nodeId:f.node.nodeId});
  await f.ar.accept(f.b.address,f.bundle);f.consumeCached();f.enqueue(40);
  for(let i=0;i<3;i++)await f.ar.poll();expect(f.uploads).toHaveLength(30);
  expect((await f.directory.status(f.b.address,f.a.address)).available).toHaveLength(2);
  now+=6000;await f.br.poll();expect((await f.directory.status(f.b.address,f.a.address)).available).toHaveLength(32);
  await f.ar.poll();expect(f.uploads).toHaveLength(40);
  expect(new Set(f.uploads.map(j=>JSON.parse(Buffer.from(j.body.packet,'base64url').toString()).body.keyId)).size).toBe(40);
  const keyId=JSON.parse(Buffer.from(f.uploads[0].body.packet,'base64url').toString()).body.keyId;
  expect(f.as.used[keyId]).toBeGreaterThan(f.bs.keys.find(k=>k.id===keyId)!.expiresAt);
  expect(f.as.used[f.bundle.body.keys.at(-1)!.id]).toBeUndefined(); // cached fallback stayed available
  expect(f.calls.filter(p=>p==='/prekeys/publish')).toHaveLength(2);
  for(const job of f.uploads){const hop=await signCourier('hop',{protocol:COURIER_PROTOCOL,courier:f.na.address,id:job.body.id,digest:await cipherDigest(job.body.packet)},f.na.identity);
    await f.br.receive({from:f.na.address,job,hop},async()=>{});}
  expect(f.received).toBe(40);expect(f.committed.acks).toHaveLength(40);
},20000);

it('never publishes volatile private keys, including retrying a batch after a failed save',async()=>{
  const f=await setup();let now=Date.now();vi.spyOn(Date,'now').mockImplementation(()=>now);f.save(false);
  await expect(f.br.poll()).rejects.toThrow('courier_not_saved');expect(f.calls).not.toContain('/prekeys/publish');
  expect(f.bs.keys).toHaveLength(0);now+=31000;
  await expect(f.br.poll()).rejects.toThrow('courier_not_saved');expect(f.calls).not.toContain('/prekeys/publish');
  f.save(true);now+=31000;await f.br.poll();
  expect(f.bs.keys).toHaveLength(32);expect(f.committed.keys).toHaveLength(32);expect(f.committed.version).toBe(2);expect(f.calls.filter(p=>p==='/prekeys/publish')).toHaveLength(1);
});

it('uses its last cached key when the directory is unavailable instead of blocking delivery',async()=>{
  const f=await setup();await f.br.poll();await f.br.publish(f.a.address);await f.ar.accept(f.b.address,f.bundle);
  f.consumeCached();f.sourceOnline(false);f.enqueue(1);await f.ar.poll();
  expect(f.uploads).toHaveLength(1);expect(Object.keys(f.as.used)).toContain(f.bundle.body.keys.at(-1)!.id);
});

it('fetches a newly published key after the original direct bundle expires',async()=>{
  const f=await setup();let now=Date.now();vi.spyOn(Date,'now').mockImplementation(()=>now);
  await f.br.poll();await f.br.publish(f.a.address);await f.ar.accept(f.b.address,f.bundle);
  now+=7*86400000+1000;await f.br.poll();f.enqueue(1);await f.ar.poll();
  expect(f.uploads).toHaveLength(1);expect(f.uploads[0].body.expiresAt).toBe(now+7*86400000);
  expect(f.uploads[0].body.route).toBeUndefined(); // supplied through existing route-update API
});
it('creates fresh public keys after a node loses its directory instead of reissuing old claims',async()=>{
  const f=await setup();let now=Date.now();vi.spyOn(Date,'now').mockImplementation(()=>now);
  await f.br.poll();const before=new Set((await f.directory.status(f.b.address,f.a.address)).available);
  const old=await f.directory.allocate(f.a.address,{owner:f.b.address,reservation:crypto.randomUUID()});
  f.directory.records.clear(); // Simulate restoring node identity without its directory data.
  now+=31000;await f.br.poll();const after=(await f.directory.status(f.b.address,f.a.address)).available;
  expect(after).toHaveLength(32);expect(after.every((id:string)=>!before.has(id))).toBe(true);
  expect(f.bs.keys.some(k=>k.id===old.key.body.id)).toBe(true); // still decryptable if its message arrives
});

it('reports real node stock while the direct channel is connecting and observes its automatic refill',async()=>{
 const f=await setup();let now=Date.now();vi.spyOn(Date,'now').mockImplementation(()=>now);
 await f.br.poll();await f.br.publish(f.a.address);await f.ar.accept(f.b.address,f.bundle);f.consumeCached();f.activate();
 await f.ar.poll();await vi.waitFor(()=>expect(f.stock).toMatchObject({status:'ready',available:32}));expect((await f.directory.status(f.b.address,f.a.address)).available).toHaveLength(32);
 f.enqueue(27);for(let i=0;i<3;i++)await f.ar.poll();await vi.waitFor(()=>expect(f.stock).toMatchObject({status:'ready',available:5}));
 now+=6000;await f.br.poll();await f.ar.poll();await vi.waitFor(()=>expect(f.stock).toMatchObject({status:'ready',available:32}));
 f.sourceOnline(false);now+=31000;await f.ar.poll();await vi.waitFor(()=>expect(f.stock).toMatchObject({status:'unavailable'}));expect(f.stock?.available).toBeUndefined();
});

it('never waits for the stock indicator before sending and discards a probe made before allocation',async()=>{
 const f=await setup();await f.br.poll();await f.br.publish(f.a.address);await f.ar.accept(f.b.address,f.bundle);f.consumeCached();f.activate();const release=f.blockStock();
 try {f.enqueue(1);await f.ar.poll();expect(f.uploads).toHaveLength(1);expect(f.stock).toBeUndefined();}
 finally {release();}
 await f.ar.settled();expect(f.stock).toBeUndefined();await f.ar.poll();await vi.waitFor(()=>expect(f.stock).toMatchObject({status:'ready',available:31}));
});
