import { it,expect,vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { ChatService } from '../chat/ChatService';
import { WebCryptoIdentity } from '../identity/webcrypto';
import { accountIdFromPublicKey } from '../addressing/account-id.js';
import { TRANSPORT_CAPABILITIES, type Transport, type Peer, type TransportMessage, type TransportStatus } from '../transport/transport';
import type { CoreRecordStore, SealedCoreRecord } from '../core/durable-state';
import { webCryptoEnvironment } from '../core/ports';
import { createOwnerDeviceStore } from './owner-store';
import { createDeviceRequest,deviceComparisonCode } from './enrollment';
import { openDirectDeviceRuntime } from './direct-runtime';
import { emptyDeviceSettings } from './settings';
class Network implements Transport {
  capabilities=TRANSPORT_CAPABILITIES.webrtc; address=''; frames:TransportMessage[]=[];
  handlers:Array<(m:TransportMessage)=>void>=[]; peers:Array<(p:Peer,e:'joined'|'left')=>void>=[];
  constructor(private network:Map<string,Network>){}
  getStatus():TransportStatus{return 'connected';}
  async init(id:string){this.address=id;this.network.set(id,this);}
  async connect(p:Peer){const target=this.network.get(p.address);if(!target)throw Error('offline');for(const h of this.peers)h(p,'joined');for(const h of target.peers)h({address:this.address,lastSeen:Date.now(),transport:'webrtc'},'joined');}
  async send(m:TransportMessage){const target=this.network.get(m.to);if(!target)throw Error('offline');this.frames.push(structuredClone(m));queueMicrotask(()=>target.handlers.forEach(h=>h(structuredClone(m))));}
  async disconnect(){this.network.delete(this.address);}
  async isAvailable(){return true;}async discover(){return [];}
  onMessage(h:(m:TransportMessage)=>void){this.handlers.push(h);}onPeerChange(h:(p:Peer,e:'joined'|'left')=>void){this.peers.push(h);}onStatusChange(_h:(s:TransportStatus)=>void){}
}
function records():CoreRecordStore{const map=new Map<string,SealedCoreRecord>();return {async read(k){return map.get(k)&&structuredClone(map.get(k));},async compareAndSwap(k,r,n){if((map.get(k)?.revision??null)!==r)return false;map.set(k,structuredClone(n));return true;}};}
const key=()=>crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
it('uses real MAE and live nonce-bound owner policy for node-free text, independent keys and immediate known revocation',async()=>{
  vi.stubGlobal('indexedDB',new IDBFactory());vi.stubGlobal('localStorage',{getItem:()=>null});
  const first=new WebCryptoIdentity(),second=new WebCryptoIdentity();await first.create();await second.create();const env=webCryptoEnvironment();
  const a=await accountIdFromPublicKey(await first.getPublicKeyBytes()),b=await accountIdFromPublicKey(await second.getPublicKeyBytes());
  const phone=await createDeviceRequest('Private phone',env),c=phone.request.record.author;
  const alice=createOwnerDeviceStore({owner:a,signer:first,key:await key(),records:records(),environment:env,guard:()=>{}});
  const bob=createOwnerDeviceStore({owner:b,signer:second,key:await key(),records:records(),environment:env,guard:()=>{}});
  await alice.setPrimaryEnabled(true,true);await bob.setPrimaryEnabled(true,true);
  const cert=await bob.approve(phone.request,{approved:true,comparisonCode:await deviceComparisonCode(b,phone.request,env)});
  const network=new Map<string,Network>(),clients:Array<{chat:ChatService;runtime:Awaited<ReturnType<typeof openDirectDeviceRuntime>>;wire:Network;received:string[]}> = [];
  try {
    for(const spec of [{owner:a,device:a,identity:first,store:alice},{owner:b,device:b,identity:second,store:bob},{owner:b,device:c,identity:phone.signer,store:undefined}]){
      const wire=new Network(network),chat=new ChatService(wire),received:string[]=[];await chat.init({address:spec.device,provider:spec.identity});let settings=emptyDeviceSettings();
      const runtime=await openDirectDeviceRuntime({...spec,key:await key(),chat,settings:()=>settings,save:async next=>{settings=next;},guard:()=>{},contacts:()=>[a,b].filter(id=>id!==spec.owner),allowed:()=>true,
        commit:async event=>{if(!received.includes(event.text))received.push(event.text);}});
      clients.push({chat,runtime,wire,received});
    }
    await clients[0].chat.connect(b);await clients[0].chat.connect(c);await clients[1].chat.connect(c);
    await vi.waitFor(async()=>expect(await clients[0].runtime.canSend(b)).toBe(true),{timeout:15000});
    await clients[0].runtime.send(b,'Node-free encrypted payload',crypto.randomUUID());
    await vi.waitFor(()=>{expect(clients[1].received).toContain('Node-free encrypted payload');expect(clients[2].received).toContain('Node-free encrypted payload');},{timeout:15000});
    await clients[2].runtime.send(a,'Independent direct reply',crypto.randomUUID());
    await vi.waitFor(()=>expect(clients[0].received).toContain('Independent direct reply'),{timeout:15000});
    network.delete(a);
    try { expect(await clients[1].runtime.canSend(a)).toBe(false); }
    finally { network.set(a,clients[0].wire); }
    await clients[1].runtime.mirror(a,'Ordinary primary outgoing copy',crypto.randomUUID(),Date.now());
    await vi.waitFor(()=>expect(clients[2].received).toContain('Ordinary primary outgoing copy'),{timeout:15000});
    await bob.revoke(cert.record.id,true);
    await expect(clients[2].runtime.canSend(a)).rejects.toThrow('revoked');
    for(const client of clients)for(const frame of client.wire.frames){const raw=new TextDecoder().decode(frame.payload);expect(raw).not.toContain('Node-free encrypted payload');expect(raw).not.toContain('Independent direct reply');}
  }finally{for(const client of clients){await client.runtime.stop();await client.chat.disconnect();}alice.close();bob.close();phone.close();first.dispose();second.dispose();vi.unstubAllGlobals();}
},60000);
