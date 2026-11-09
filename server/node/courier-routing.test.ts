import { afterEach, expect, it, vi } from 'vitest';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import WebSocket from 'ws';
import { createHomeNode } from './application.js';
import { testProtector } from './test-protection.fixture.js';
import { WebCryptoIdentity } from '$lib/identity/webcrypto';
import { accountIdFromPublicKey } from '$lib/addressing/account-id.js';
import { registrationProofBytes } from '$lib/transport/registration-proof.js';
import { signedNodeRequest } from '$lib/node/client';
import { CourierController } from '$lib/node/courier-controller';
import { emptyCourierState } from '$lib/node/courier-state';
import { signCourier } from '$lib/node/courier-crypto';
import { COURIER_ROUTE_PROTOCOL } from '$lib/node/courier-route.js';
import { emptySessionChats, ensureConversation, receiveMessage, recordSentMessage, setContactState, setDeliveryStatus } from '$lib/chat/session-chats';

const nativeFetch=globalThis.fetch, nodes:any[]=[], directories:string[]=[], workers:CourierController[]=[], sockets:WebSocket[]=[], identities:WebCryptoIdentity[]=[];
afterEach(async()=>{
  workers.forEach(w=>w.stop()); await Promise.all(workers.splice(0).map(w=>w.settled()));
  sockets.splice(0).forEach(s=>s.terminate());
  for(const n of nodes.splice(0)) await n.close();
  for(const d of directories.splice(0)) {
    const child=relative(resolve(tmpdir()),resolve(d));
    expect(!isAbsolute(child) && /^automesh-route-[a-zA-Z0-9]+$/.test(child)).toBe(true);
    await rm(resolve(d),{recursive:true,force:true});
  }
  identities.splice(0).forEach(i=>i.dispose()); vi.unstubAllGlobals(); vi.restoreAllMocks();
});
async function account(){const identity=new WebCryptoIdentity();await identity.create();identities.push(identity);
  return {identity,address:await accountIdFromPublicKey(await identity.getPublicKeyBytes())};}
async function node(scope:'lan'|'internet',directory?:string,protector=testProtector(),port=0){
  if(!directory){directory=await mkdtemp(join(tmpdir(),'automesh-route-'));directories.push(directory);}
  const hosts=['127.0.0.1:0'];
  const runtime=await createHomeNode({directory,hosts,origins:['http://localhost:5173'],adminToken:'b'.repeat(64),
    testHttp:true,testRelay:true,secretProtector:protector,localRouteScope:scope});nodes.push(runtime);
  const server=runtime.createPublicServer();server.listen(port,'127.0.0.1');await once(server,'listening');
  const actual=(server.address() as {port:number}).port;hosts.push(`127.0.0.1:${actual}`);
  runtime.control.listen(0,'127.0.0.1');await once(runtime.control,'listening');
  return {runtime,directory,protector,port:actual,url:`https://127.0.0.1:${actual}`,nodeId:runtime.state.value.nodeId,address:runtime.courier.address};
}
async function pair(n:Awaited<ReturnType<typeof node>>,who:Awaited<ReturnType<typeof account>>){
  const control=`http://127.0.0.1:${n.runtime.control.address().port}`;
  const {pairCode}=await(await nativeFetch(control+'/status',{headers:{Authorization:'Bearer '+'b'.repeat(64)}})).json();
  await signedNodeRequest(n.url,n.nodeId,who.identity,who.address,'/node/join',{code:pairCode},new AbortController().signal);
}
async function register(n:Awaited<ReturnType<typeof node>>,who:Awaited<ReturnType<typeof account>>){
  const ws=new WebSocket(n.url.replace('https:','ws:')+'/signal');sockets.push(ws);await once(ws,'open');
  let received=once(ws,'message');ws.send(JSON.stringify({type:'register',address:who.address}));
  const challenge=JSON.parse((await received)[0].toString());received=once(ws,'message');
  ws.send(JSON.stringify({type:'register_proof',address:who.address,publicKey:Buffer.from(await who.identity.getPublicKeyBytes()).toString('hex'),
    signature:Buffer.from(await who.identity.sign(registrationProofBytes(who.address,challenge.challenge))).toString('hex')}));
  expect(JSON.parse((await received)[0].toString()).type).toBe('registered');return ws;
}
function client(who:Awaited<ReturnType<typeof account>>,peer:string,n:Awaited<ReturnType<typeof node>>,signalingUrl=''){
  let state=emptyCourierState(),chats=setContactState(ensureConversation(emptySessionChats(),peer),peer,'accepted');
  let destination:CourierController;
  const worker=new CourierController({...who,state:()=>state,update:s=>state=s,chats:()=>chats,persist:async()=>true,
    receive:m=>{chats=receiveMessage(chats,{...m,direction:'incoming'});},delivery:(p,id,s)=>{chats=setDeliveryStatus(chats,p,id,s);},
    publish:async(_p,bundle)=>destination.accept(who.address,bundle),error:()=>{},signalingRoutes:()=>signalingUrl?[signalingUrl]:[],
    request:(_url,nodeId,identity,address,path,body,signal)=>signedNodeRequest(n.url,nodeId,identity,address,path,body,signal)});
  workers.push(worker);
  return {worker,state:()=>state,chats:()=>chats,connect:(w:CourierController)=>destination=w,
    send:(text:string)=>{const id=crypto.randomUUID();chats=recordSentMessage(chats,peer,{id,from:who.address,text,timestamp:Date.now(),direction:'outgoing',delivery:'queued'});return id;}};
}

it.each([{scope:'lan',ownNode:true},{scope:'internet',ownNode:true},{scope:'lan',ownNode:false}] as const)(
  'delivers across unrelated networks after sender exit and source-node restart: %j',async ({scope,ownNode})=>{
  // Only test HTTP is translated to loopback; production still requires verified
  // TLS and the runtime's public DNS lookup on every discovered connection.
  vi.stubGlobal('fetch',(input:any,init:any)=>nativeFetch(String(input).replace('https://127.0.0.1:','http://127.0.0.1:'),init));
  const [alice,bob]=await Promise.all([account(),account()]);
  let source=await node(scope);const target=await node('internet');
  await pair(source,alice);if(ownNode)await pair(target,bob);
  const a=client(alice,bob.address,source),b=client(bob,alice.address,target,'wss://recipient.example/signal');a.connect(b.worker);b.connect(a.worker);
  await a.worker.configure({url:'https://source.example',nodeId:source.nodeId,address:source.address},true);
  if(ownNode)await b.worker.configure({url:'https://recipient.example',nodeId:target.nodeId,address:target.address},true);
  await a.worker.publish(bob.address);await b.worker.publish(alice.address);
  const advertisement=a.state().bundles[bob.address].body.route!;
  expect(advertisement.body.signalingUrl).toBe('wss://recipient.example/signal');
  expect(advertisement.body.kind).toBe(ownNode?undefined:'signaling');
  if(!ownNode)expect(target.runtime.state.value.members).toHaveLength(0);
  expect(source.runtime.courier.relay).toBe('');expect(target.runtime.courier.relay).toBe('');
  const socketsOpened:string[]=[];
  function bridge(n:typeof source){
    const native=n.runtime.courier.createSocket.bind(n.runtime.courier);
    n.runtime.courier.createSocket=(url:string,options:any)=>{
      if(url==='wss://recipient.example/signal'){
        expect(typeof options.lookup).toBe('function');expect(options.followRedirects).toBe(false);
        socketsOpened.push(url);const {lookup,...rest}=options;return new WebSocket(target.url.replace('https:','ws:')+'/signal',rest);
      }return native(url,options);
    };
  }
  bridge(source);
  const id=a.send('cross-node encrypted text');await a.worker.poll();
  const saved=structuredClone(source.runtime.courier.decode(source.runtime.courier.box.records.get(id.replaceAll('-',''))));
  // The new delivery deadline outlives this discovery advertisement. Keep the
  // existing bridge's separately persisted route, without shortening mail TTL.
  expect(saved.body.route).toBeUndefined();
  expect(source.runtime.courier.learnedRoutes.get(source.runtime.courier.routeKey(alice.address,bob.address))).toEqual(advertisement);
  expect(saved.body.expiresAt).toBeGreaterThanOrEqual(advertisement.body.expiresAt);
  expect(source.runtime.courier.box.stats().messages).toBe(1);expect(target.runtime.courier.box.stats().messages).toBe(0);
  a.worker.stop();await a.worker.settled();
  await source.runtime.close();nodes.splice(nodes.indexOf(source.runtime),1);
  source=await node(scope,source.directory,source.protector,source.port);bridge(source);
  const ws=await register(target,bob),failures:unknown[]=[];
  ws.on('message',raw=>{
    const msg=JSON.parse(raw.toString());if(msg.type!=='courier_delivery')return;
    void b.worker.receive(msg,(messageId,receipt)=>ws.send(JSON.stringify({type:'courier_receipt',to:msg.from,id:messageId,receipt}))).catch(e=>failures.push(e));
  });
  await source.runtime.courier.flush();
  await vi.waitFor(()=>expect(b.chats().byPeer[alice.address].messages.map(m=>m.text)).toEqual(['cross-node encrypted text']),{timeout:8000});
  await vi.waitFor(()=>expect(source.runtime.courier.box.records.get(id.replaceAll('-','')).status).toBe('acknowledged'),{timeout:8000});
  expect(failures).toEqual([]);expect(socketsOpened.length).toBeGreaterThan(0);
  expect(target.runtime.courier.box.stats().messages).toBe(0);
  // Lost ACK / duplicate hop cannot create another visible message or consume a
  // second prekey; the receiver resends its durable original signed receipt.
  const hop=await source.runtime.courier.sign('hop',{protocol:'automesh-courier-v1',courier:source.address,id,
    digest:await (await import('$lib/node/offline-crypto')).cipherDigest(saved.body.packet)});
  const duplicate=vi.fn();await b.worker.receive({from:source.address,job:saved,hop},duplicate);
  expect(duplicate).toHaveBeenCalledTimes(1);expect(b.chats().byPeer[alice.address].messages).toHaveLength(1);
  await source.runtime.courier.flush();expect([...source.runtime.courier.routes.values()].some((r:any)=>r.discovered)).toBe(false);
},20000);

it('rejects a sender-forged recipient route without opening a discovered socket',async()=>{
  const [a,b]=await Promise.all([account(),account()]),n=await node('internet');
  const route=await signCourier('route',{protocol:COURIER_ROUTE_PROTOCOL,from:b.address,to:a.address,nodeAddress:b.address,
    nodeId:'a'.repeat(32),signalingUrl:'wss://recipient.example/signal',issuedAt:Date.now(),expiresAt:Date.now()+60000},a.identity);
  const job=await signCourier('job',{protocol:'automesh-courier-v1',courier:n.address,from:a.address,to:b.address,
    id:crypto.randomUUID(),packet:'YWJj',expiresAt:route.body.expiresAt,route},a.identity);
  const socket=vi.spyOn(n.runtime.courier,'createSocket');
  await expect(n.runtime.courier.put(a.address,job)).rejects.toThrow('invalid_courier_signature');
  expect(socket).not.toHaveBeenCalled();expect(n.runtime.courier.box.stats().messages).toBe(0);
});

it('persists the newest recipient-authorized route, rejects rollback, and never falls back after its expiry',async()=>{
  vi.stubGlobal('fetch',(input:any,init:any)=>nativeFetch(String(input).replace('https://127.0.0.1:','http://127.0.0.1:'),init));
  const [a,b,outsider]=await Promise.all([account(),account(),account()]);let n=await node('internet');await pair(n,a);
  const now=Date.now(),make=async(issuedAt:number,expiresAt:number,host:string)=>signCourier('route',{
    protocol:COURIER_ROUTE_PROTOCOL,kind:'signaling' as const,from:b.address,to:a.address,signalingUrl:`wss://${host}/signal`,issuedAt,expiresAt},b.identity);
  const older=await make(now-1000,now+60000,'old.example'),latest=await make(now-500,now+1000,'new.example');
  await signedNodeRequest(n.url,n.nodeId,a.identity,a.address,'/outbox/route',{route:older},new AbortController().signal);
  await expect(signedNodeRequest(n.url,n.nodeId,outsider.identity,outsider.address,'/outbox/route',{route:older},new AbortController().signal)).rejects.toThrow('not_member');
  await n.runtime.courier.rememberRoute(a.address,latest);
  expect((await n.runtime.courier.rememberRoute(a.address,older)).accepted).toBe(false);
  const body={from:a.address,to:b.address,route:older};
  expect(n.runtime.courier.routeFor({body})).toEqual(latest);
  await n.runtime.close();nodes.splice(nodes.indexOf(n.runtime),1);n=await node('internet',n.directory,n.protector,n.port);
  expect(n.runtime.courier.routeFor({body})).toEqual(latest);
  vi.spyOn(Date,'now').mockReturnValue(now+2000);
  expect(n.runtime.courier.routeFor({body})).toBeNull();
  expect(n.runtime.courier.routeFor({body:{...body,lanOnly:true}})).toBeNull();
  expect(n.runtime.courier.routeFor({body:{...body,attachment:{}}})).toBeNull();
});
