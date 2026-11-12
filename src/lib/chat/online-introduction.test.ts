import { afterEach, expect, it, vi } from 'vitest';
import { OnlineIntroduction, type IntroductionOptions, type IntroductionRequest, type IntroductionStatus } from './online-introduction';
import type { IntroductionPort, IntroductionWire } from '../transport/introduction-relay';
import { IntroductionRelay } from '../transport/introduction-relay';
import { WebCryptoIdentity } from '../identity/webcrypto';
import { getAccountId } from '../addressing/address';
import { bytesToHex } from '../message/encoding';
import { contactHandshake } from '../application/contact-handshake';
import type { ContactState } from './session-chats';
import type { ChatIdentity, ChatMessage } from './ChatService';
import { encodeMessage, decodeMessage } from '../message/transport-codec';
import { base64, unbase64 } from '../node/offline-crypto';
import { encodeChatContent } from './message-details';

class Bus {
  ports = new Map<string, ReturnType<Bus['port']>>();
  frames: IntroductionWire[] = [];
  drop = false;
  port(self: string, route = 'wss://shared.test/signal') {
    const listeners = new Set<(e:IntroductionWire)=>void>();
    const closures = new Set<(route:string)=>void>();
    const port: IntroductionPort & { emit(e:IntroductionWire):void; disconnect():void } = {
      route: async () => route,
      send: (peer, channel, frame) => {
        const wire:IntroductionWire = {peer:self,route:channel,kind:frame?'frame':'open',...(frame?{frame}:{})};
        this.frames.push(wire);
        if (this.drop) return;
        queueMicrotask(() => {
          const target = this.ports.get(peer);
          if (target) target.emit(wire);
          else port.emit({peer,route:channel,kind:'unavailable'});
        });
      },
      listen: cb => {listeners.add(cb);return()=>{listeners.delete(cb);};},
      closed: cb => {closures.add(cb);return()=>{closures.delete(cb);};},
      emit: e => {for(const cb of listeners)cb(e);},
      disconnect: () => {for(const cb of closures)cb(route);},
    };
    this.ports.set(self, port); return port;
  }
}
const cleanup:Array<()=>void>=[];
afterEach(()=>{cleanup.splice(0).forEach(f=>f());vi.restoreAllMocks();});
async function identity(n:number):Promise<ChatIdentity> {
  const seed=new Uint8Array(32);seed[31]=n;
  const provider=new WebCryptoIdentity();const id=await provider.fromSeed(seed);
  cleanup.push(()=>provider.dispose());
  return {provider,address:await getAccountId(bytesToHex(id.publicKey))};
}
async function client(bus:Bus,n:number,state:ContactState='outgoing',overrides:Partial<IntroductionOptions>={}) {
  const id=await identity(n), port=bus.port(id.address);
  const request:IntroductionRequest={id:crypto.randomUUID(),content:encodeChatContent(`request-${n}`),timestamp:Date.now()};
  const saved:ChatMessage[]=[], receipts:string[]=[], keys:unknown[]=[], statuses:IntroductionStatus[]=[];
  let active=true, direct=false, incomingId:string|undefined, accepted=0, ready=0;
  const options:IntroductionOptions={
    identity:id,port,current:()=>active,contact:()=>state,request:()=>request,incomingRequest:()=>incomingId,
    directReady:()=>direct,authorize:async()=>{},
    receive:async message=>{
      incomingId=message.id;
      if(!saved.some(m=>m.id===message.id))saved.push(message);
      if(contactHandshake(state,'message').accept){state='accepted';accepted++;}
      else if(state==='new')state='pending';
    },
    received:async(_,id)=>{receipts.push(id);},
    accept:async()=>{if(contactHandshake(state,'accepted').accept){state='accepted';accepted++;}},
    keys:async(_,kind,bundle)=>{keys.push({kind,bundle});},ready:()=>{ready++;},status:(_,s)=>{statuses.push(s);},
    ...overrides,
  };
  const service=new OnlineIntroduction(options);cleanup.push(()=>service.close());
  // Skip the direct-first grace period in crypto tests, retaining the real
  // relay, envelope signatures, ECDH, AES-GCM, counters and persistence callbacks.
  const connect=(peer:string)=>service['relay'].connect(peer);
  return {service,connect,id,port,options,request,saved,receipts,keys,statuses,
    state:()=>state,setState:(s:ContactState)=>{state=s;},accepted:()=>accepted,ready:()=>ready,
    lock:()=>{active=false;service.close();},direct:()=>{direct=true;}};
}
const wait=async(assertion:()=>void)=>vi.waitFor(assertion,{timeout:2500,interval:10});

it('mutual signed requests accept once and exchange keys without any direct peer becoming connected',async()=>{
  const bus=new Bus(),a=await client(bus,1),b=await client(bus,2);
  await Promise.all([a.connect(b.id.address),b.connect(a.id.address)]);
  await wait(()=>{expect(a.state()).toBe('accepted');expect(b.state()).toBe('accepted');expect(a.receipts).toContain(a.request.id);expect(b.receipts).toContain(b.request.id);});
  expect(a.accepted()).toBe(1);expect(b.accepted()).toBe(1);
  expect(a.saved[0]).toMatchObject({verified:true,via:'introduction',text:'request-2'});
  await Promise.all([a.service.sendKeys(b.id.address,'courier',{signed:'A'}),b.service.sendKeys(a.id.address,'offline',{signed:'B'})]);
  await wait(()=>{expect(a.keys).toEqual([{kind:'offline',bundle:{signed:'B'}}]);expect(b.keys).toEqual([{kind:'courier',bundle:{signed:'A'}}]);});
  // Relay observers only see encrypted frames, never request text or key JSON.
  expect(JSON.stringify(bus.frames)).not.toContain('request-1');
  expect(JSON.stringify(bus.frames)).not.toContain('signed');
});

it('one-sided request stays pending until explicit acceptance; acceptance precedes keys',async()=>{
  const bus=new Bus(),a=await client(bus,3),b=await client(bus,4,'new');
  await a.connect(b.id.address);
  await wait(()=>{expect(b.state()).toBe('pending');expect(a.statuses.at(-1)).toBe('waiting_acceptance');});
  expect(a.state()).toBe('outgoing');expect(a.keys).toEqual([]);
  await expect(b.service.sendKeys(a.id.address,'courier',{})).rejects.toThrow('introduction_not_accepted');
  b.setState('accepted');
  await b.service.sendKeys(a.id.address,'courier',{verifiedLater:true});
  await wait(()=>{expect(a.state()).toBe('accepted');expect(a.keys).toHaveLength(1);});
});

it.each([true,false])('recovers a one-sided signaling interruption (lower account reconnects: %s)',async lower=>{
  const bus=new Bus(),a=await client(bus,16,'outgoing'),b=await client(bus,17,'new');
  await a.connect(b.id.address);await wait(()=>expect(b.saved).toHaveLength(1));
  const reconnect=(a.id.address<b.id.address)===lower?a:b, other=reconnect===a?b:a;
  reconnect.port.disconnect();expect(reconnect.service.isReady(other.id.address)).toBe(false);
  await reconnect.connect(other.id.address);
  await wait(()=>{expect(a.service.isReady(b.id.address)).toBe(true);expect(b.service.isReady(a.id.address)).toBe(true);});
  b.setState('accepted');await b.service.sendKeys(a.id.address,'courier',{afterReconnect:true});
  await wait(()=>{expect(a.state()).toBe('accepted');expect(a.keys).toHaveLength(1);});
  expect(b.saved).toHaveLength(1);
});

it('never acknowledges a request that failed durable saving',async()=>{
  const bus=new Bus(),a=await client(bus,5),b=await client(bus,6,'new',{receive:async()=>{throw Error('disk_full');}});
  await a.connect(b.id.address);
  await wait(()=>expect(a.statuses).toContain('request_sent'));
  await new Promise(r=>setTimeout(r,30));
  expect(a.receipts).toEqual([]);expect(a.state()).toBe('outgoing');expect(b.keys).toEqual([]);
});

it('rejects a forged envelope and a replay without granting consent or duplicating history',async()=>{
  const bus=new Bus(),a=await client(bus,7),b=await client(bus,8,'new');
  await a.connect(b.id.address);await wait(()=>expect(b.saved).toHaveLength(1));
  const wire=bus.frames.filter(e=>e.peer===a.id.address&&e.kind==='frame').at(-1)!;
  const forged=decodeMessage(unbase64(wire.frame!));forged.signature[0]^=1;
  b.port.emit({...wire,frame:base64(new Uint8Array(encodeMessage(forged)))});
  b.port.emit(wire);
  await new Promise(r=>setTimeout(r,30));
  expect(b.saved).toHaveLength(1);expect(b.state()).toBe('pending');expect(b.accepted()).toBe(0);
});

it('does not turn a late acknowledgement into consent for a replacement request',async()=>{
  const bus=new Bus(),a=await client(bus,9),b=await client(bus,10,'new');
  await a.connect(b.id.address);await wait(()=>expect(b.saved).toHaveLength(1));
  a.request.id=crypto.randomUUID();b.setState('accepted');await b.service.accept(a.id.address);
  await new Promise(r=>setTimeout(r,30));expect(a.state()).toBe('outgoing');expect(a.accepted()).toBe(0);
});

it('locking during authorization prevents sending, and a blocked peer cannot open a session',async()=>{
  let resume!:()=>void;
  const gate=new Promise<void>(resolve=>{resume=resolve;});
  const bus=new Bus(),a=await client(bus,11,'outgoing',{authorize:()=>gate}),b=await client(bus,12,'new');
  await a.connect(b.id.address);await wait(()=>expect(a.service.isReady(b.id.address)).toBe(true));
  a.lock();resume();await new Promise(r=>setTimeout(r,30));expect(b.saved).toEqual([]);
  b.setState('blocked');b.port.emit({peer:a.id.address,route:'wss://shared.test/signal',kind:'open'});
  expect(b.service.isReady(a.id.address)).toBe(false);
});

it('direct-first grace and unsupported/offline states never claim request delivery',async()=>{
  const bus=new Bus(),a=await client(bus,13);
  a.service.start('missing');expect(bus.frames).toHaveLength(0);
  a.direct();a.service['tick']();expect(bus.frames).toHaveLength(0);
  const b=await client(bus,14,'outgoing',{port:{...bus.port('unused'),route:async()=>{throw Error('introduction_unsupported');}}});
  b.service.start('missing');b.service['desired'].set('missing',0);b.service['tick']();
  await wait(()=>expect(b.statuses.at(-1)).toBe('unsupported'));
  expect(b.receipts).toEqual([]);
  const c=await client(bus,15);await c.connect('missing');
  await wait(()=>expect(c.service['relay'].has('missing')).toBe(false));expect(c.receipts).toEqual([]);
});

it('simultaneous opens through different shared servers converge without replacing a session with late data',async()=>{
  const bus=new Bus(),a=bus.port('a','route-A'),b=bus.port('b','route-B');
  const ra=new IntroductionRelay(a,'a',()=>true),rb=new IntroductionRelay(b,'b',()=>true);
  cleanup.push(()=>ra.close(),()=>rb.close());
  await Promise.all([ra.connect('b'),rb.connect('a')]);
  expect(ra['routes'].get('b')).toBe('route-A');expect(rb['routes'].get('a')).toBe('route-A');
  b.emit({peer:'a',route:'route-B',kind:'frame',frame:'AA=='});
  expect(rb['routes'].get('a')).toBe('route-A');
});
