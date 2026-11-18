import { afterEach, describe, expect, it } from 'vitest';
import { webcrypto, randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNotifications, validPushSubscription, notificationProvider, notificationProof, NOTIFICATION_PROTOCOL } from './notifications.js';
import { accountIdFromPublicKey } from '../src/lib/addressing/account-id.js';

const cleanup=[];
afterEach(async()=>{for(const f of cleanup.splice(0).reverse())await f();});
const token=()=>randomBytes(32).toString('base64url');
async function person(){const keys=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);const pub=new Uint8Array(await webcrypto.subtle.exportKey('raw',keys.publicKey));return {keys,pub,account:await accountIdFromPublicKey(pub),device:token()};}
function subscription(){return {endpoint:`https://fcm.googleapis.com/fcm/send/${token()}`,keys:{p256dh:Buffer.concat([Buffer.from([4]),randomBytes(64)]).toString('base64url'),auth:randomBytes(16).toString('base64url')}};}
async function input(p,origin,action,body,at){const m={account:p.account,device:p.device,at,nonce:token(),body,publicKey:Buffer.from(p.pub).toString('base64url'),signature:''};m.signature=Buffer.from(await webcrypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},p.keys.privateKey,notificationProof(origin+'/api/notifications',action,m))).toString('base64url');return m;}
async function invoke(service,method,action,body){
  const request=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);request.method=method;request.headers={'content-type':'application/json'};request.socket={remoteAddress:'127.0.0.1'};
  let status,headers,result;const response={headersSent:false,writableEnded:false,writeHead(s,h){status=s;headers=h;this.headersSent=true;},end(v){result=v?JSON.parse(v):null;this.writableEnded=true;},destroy(){}};
  await service.handle(request,response,`/api/notifications/${action}`);return {status,headers,body:result};
}
async function fixture(options={}){
  let t=Date.now();const sent=[];const origin=options.origin??'https://notify.automesh.online';
  const service=createNotifications({origin,directory:options.directory??':memory:',now:()=>t,send:async(s,p,o)=>{sent.push({subscription:s,payload:JSON.parse(p),options:o});if(options.fail)throw Object.assign(Error('outage'),{statusCode:503});}});cleanup.push(()=>service.close());
  const call=async(p,action,body)=>invoke(service,'POST',action,await input(p,origin,action,body,t));
  const register=(p,allowed,node=false)=>call(p,'register',{subscription:subscription(),allowed:allowed.map(a=>a.account),locale:'ru',node});
  const settle=async()=>{for(let n=0;n<5;n++)await new Promise(r=>setImmediate(r));await service.drain();};
  return {service,sent,call,register,origin,settle,advance:n=>{t+=n;},time:()=>t};
}
describe('isolated Web Push provider',()=>{
  it('delivers an authenticated manual return after a live sender locks, without an initial push',async()=>{
    const f=await fixture(),a=await person(),b=await person();await f.register(a,[b]);await f.register(b,[a]);
    await f.call(b,'policy',{muted:{},viewing:a.account});
    const t=token(),route={provider:f.origin+'/api/notifications',device:a.device,token:t,expires:f.time()+3600000};
    await f.call(a,'waiting',{peer:b.account,token:t,pending:true});
    expect((await f.call(a,'return-route',{to:b.account,route})).status).toBe(200);
    await f.settle();expect(f.sent).toHaveLength(0);
    await f.call(b,'policy',{muted:{},viewing:a.account});
    // Old clients query ready without a peer and must not auto-consume a manual capability.
    expect((await f.call(b,'ready',{node:false})).body.tickets).toEqual([]);
    const tickets=(await f.call(b,'ready',{node:false,peer:a.account})).body.tickets;
    expect(tickets).toHaveLength(1);expect(tickets[0]).toMatchObject({peer:a.account,manual:true,token:t});
    await f.call(a,'view-close',{});
    await f.call(b,'notify',{to:a.account,kind:'return',event:t,returnRoute:null});await f.settle();
    expect(f.sent).toHaveLength(1);expect(f.sent[0].payload.kind).toBe('return');
    await f.call(b,'notify',{to:a.account,kind:'return',event:t,returnRoute:null});await f.settle();expect(f.sent).toHaveLength(1);
  });
  it('rejects ungranted, stale, blocked or node-backed manual return requests',async()=>{
    for(const mode of ['no-ticket','wrong-token','finished','sender-node','recipient-node','blocked']){
      const f=await fixture(),a=await person(),b=await person();await f.register(a,mode==='blocked'?[]:[b],mode==='sender-node');await f.register(b,mode==='blocked'?[]:[a],mode==='recipient-node');
      const t=token(),route={provider:f.origin+'/api/notifications',device:a.device,token:t,expires:f.time()+3600000};
      if(mode!=='no-ticket')await f.call(a,'waiting',{peer:b.account,token:t,pending:true});
      await f.call(a,'return-route',{to:b.account,route});
      if(mode==='recipient-node'||mode==='blocked')expect((await f.call(b,'ready',{node:mode==='recipient-node',peer:a.account})).body.tickets).toEqual([]);
      if(mode==='finished')await f.call(a,'waiting',{peer:b.account,token:t,pending:false});
      await f.call(a,'view-close',{});
      // A recipient backed by a node receives no capability and cannot issue a
      // reverse nudge in the normal client. Other cases test sender enforcement.
      await f.call(b,'notify',{to:a.account,kind:'return',event:mode==='wrong-token'?token():t,returnRoute:null});
      f.advance(91000);await f.settle();expect(f.sent,mode).toHaveLength(0);
    }
  });
  it('enforces permanent/timed mute on the provider while the receiving browser is closed',async()=>{
    const f=await fixture(),a=await person(),b=await person();await f.register(b,[a]);
    expect((await f.call(b,'policy',{muted:{[a.account]:-1},viewing:''})).body.updated).toBe(true);
    const suppressedEvent=token();await f.call(a,'notify',{to:b.account,kind:'message',event:suppressedEvent,returnRoute:null});await f.settle();expect(f.sent).toHaveLength(0);
    await f.call(b,'policy',{muted:{[a.account]:f.time()+3600000},viewing:''});f.advance(3600001);
    await f.call(a,'notify',{to:b.account,kind:'message',event:token(),returnRoute:null});await f.settle();expect(f.sent).toHaveLength(1);
    await f.call(b,'policy',{muted:{},viewing:''});f.advance(70000);await f.call(a,'notify',{to:b.account,kind:'message',event:suppressedEvent,returnRoute:null});await f.settle();expect(f.sent).toHaveLength(1);
  });
  it('applies mute to one receiving device without changing the account other device',async()=>{
    const f=await fixture(),a=await person(),b=await person(),second={...b,device:token()};await f.register(b,[a]);await f.register(second,[a]);await f.call(b,'policy',{muted:{[a.account]:-1},viewing:''});
    await f.call(a,'notify',{to:b.account,kind:'message',event:token(),returnRoute:null});await f.settle();expect(f.sent).toHaveLength(1);
  });
  it('suppresses the viewed chat but not another one, and expires a crashed foreground lease',async()=>{
    const f=await fixture(),a=await person(),b=await person(),c=await person();await f.register(b,[a,c]);await f.call(b,'policy',{muted:{},viewing:a.account});
    await f.call(a,'notify',{to:b.account,kind:'message',event:token(),returnRoute:null});await f.call(c,'notify',{to:b.account,kind:'message',event:token(),returnRoute:null});await f.settle();expect(f.sent).toHaveLength(1);
    f.advance(26000);await f.call(a,'notify',{to:b.account,kind:'message',event:token(),returnRoute:null});await f.settle();expect(f.sent).toHaveLength(2);
    await f.call(b,'policy',{muted:{},viewing:a.account});await f.call(b,'view-close',{});f.advance(70000);await f.call(a,'notify',{to:b.account,kind:'message',event:token(),returnRoute:null});await f.settle();expect(f.sent).toHaveLength(3);
  });
  it('drops a pending retry when muted and coalesces different messages from the same contact',async()=>{
    const f=await fixture({fail:true}),a=await person(),b=await person();await f.register(b,[a]);await f.call(a,'notify',{to:b.account,kind:'message',event:token(),returnRoute:null});await f.settle();expect(f.sent).toHaveLength(1);
    await f.call(b,'policy',{muted:{[a.account]:-1},viewing:''});f.advance(60000);await f.settle();expect(f.sent).toHaveLength(1);
    const g=await fixture();await g.register(b,[a]);for(let n=0;n<5;n++)await g.call(a,'notify',{to:b.account,kind:'message',event:token(),returnRoute:null});await g.settle();expect(g.sent).toHaveLength(1);
  });
  it('does not let another account change mute rules and keeps malformed policy fail-closed',async()=>{
    const f=await fixture(),a=await person(),b=await person();await f.register(b,[a]);expect((await f.call(a,'policy',{muted:{},viewing:''})).status).toBe(503);
    expect((await f.call(b,'policy',{muted:{[a.account]:-2},viewing:''})).status).toBe(400);
    expect((await f.call(b,'policy',{muted:{},viewing:b.account})).status).toBe(400);
  });
  it('cancels a delayed/queued event without canceling unrelated ready messages',async()=>{
    const f=await fixture({fail:true}),a=await person(),b=await person();await f.register(b,[a]);const event=token();await f.call(a,'notify',{to:b.account,kind:'message',event,returnRoute:null});await f.settle();expect(f.sent).toHaveLength(1);
    await f.call(a,'cancel',{to:b.account,event});f.advance(70000);await f.settle();expect(f.sent).toHaveLength(1);
    const future=token();await f.call(a,'cancel',{to:b.account,event:future});await f.call(a,'notify',{to:b.account,kind:'message',event:future,returnRoute:null});await f.settle();expect(f.sent).toHaveLength(1);
    await f.call(a,'notify',{to:b.account,kind:'message',event:token(),returnRoute:null});await f.settle();expect(f.sent).toHaveLength(2);
    await f.call(a,'cancel',{to:b.account,event:token()});f.advance(20000);await f.settle();expect(f.sent).toHaveLength(3);
  });
  it('preserves the attempt kind for a sender without a node',async()=>{const f=await fixture(),a=await person(),b=await person();await f.register(b,[a]);await f.call(a,'notify',{to:b.account,kind:'attempt',event:token(),returnRoute:null});await f.settle();expect(f.sent[0].payload.kind).toBe('attempt');});
  it('exposes only a public VAPID key, supports cross-origin signed clients and rejects arbitrary outbound URLs',async()=>{
    const f=await fixture();const r=await invoke(f.service,'GET','config');expect(r.status).toBe(200);expect(r.body).toEqual({protocol:NOTIFICATION_PROTOCOL,publicKey:expect.stringMatching(/^[A-Za-z0-9_-]{87}$/)});expect(r.headers['Access-Control-Allow-Origin']).toBe('*');
    const s=subscription();expect(validPushSubscription(s)).toBe(true);
    for(const endpoint of ['http://fcm.googleapis.com/a','https://127.0.0.1/a','https://fcm.googleapis.com.evil.org/a','https://user@fcm.googleapis.com/a','https://fcm.googleapis.com:8443/a'])expect(validPushSubscription({...s,endpoint})).toBe(false);
    for(const endpoint of ['https://updates.push.services.mozilla.com/wpush/v2/a','https://web.push.apple.com/a','https://wns2-db5p.notify.windows.com/a'])expect(validPushSubscription({...s,endpoint})).toBe(true);
    expect(notificationProvider('https://127.0.0.1/api/notifications')).toBeNull();expect(notificationProvider('https://example.local/api/notifications')).toBeNull();
  });
  it('requires real account signatures, prevents replay, domain replay and recipient enumeration',async()=>{
    const f=await fixture(),a=await person(),b=await person();await f.register(b,[a]);
    const packet=await input(a,f.origin,'notify',{to:b.account,kind:'message',event:token(),returnRoute:null},f.time());
    expect((await invoke(f.service,'POST','notify',{...packet,body:{...packet.body,to:a.account}})).status).toBe(403);
    expect((await invoke(f.service,'POST','notify',packet)).status).toBe(200);expect((await invoke(f.service,'POST','notify',packet)).status).toBe(403);
    const other=await fixture({origin:'https://other.automesh.online'});expect((await invoke(other.service,'POST','notify',packet)).status).toBe(403);
    const unknown=await person();const result=await f.call(a,'notify',{to:unknown.account,kind:'message',event:token(),returnRoute:null});expect(result.body).toEqual({accepted:true});
  });
  it('notifies only permitted devices, coalesces retries and never includes chat/identity data',async()=>{
    const f=await fixture(),a=await person(),b=await person(),stranger=await person();await f.register(b,[a]);
    await f.call(stranger,'notify',{to:b.account,kind:'message',event:token(),returnRoute:null});await f.settle();expect(f.sent).toHaveLength(0);
    const event=token();for(let n=0;n<3;n++)await f.call(a,'notify',{to:b.account,kind:'message',event,returnRoute:null});await f.settle();expect(f.sent).toHaveLength(1);
    expect(f.sent[0].payload).toEqual({protocol:NOTIFICATION_PROTOCOL,kind:'message',locale:'ru'});expect(JSON.stringify(f.sent[0].payload)).not.toContain(a.account);
    f.advance(70000);await f.call(a,'notify',{to:b.account,kind:'message',event,returnRoute:null});await f.settle();expect(f.sent).toHaveLength(1);
    await f.register(b,[]);f.advance(70000);await f.call(a,'notify',{to:b.account,kind:'message',event:token(),returnRoute:null});await f.settle();expect(f.sent).toHaveLength(1);
  });
  it('supports a reverse notification across two providers only for a live outstanding send',async()=>{
    const f=await fixture(),g=await fixture({origin:'https://custom.automesh.online'}),a=await person(),b=await person();await f.register(a,[b]);await g.register(b,[a]);
    const t=token();expect((await f.call(a,'waiting',{peer:b.account,token:t,pending:true})).body.waiting).toBe(true);
    const returnRoute={provider:f.origin+'/api/notifications',device:a.device,token:t,expires:f.time()+3600000};
    await g.call(a,'notify',{to:b.account,kind:'message',event:token(),returnRoute});
    const ready=await g.call(b,'ready',{node:false});expect(ready.body.tickets).toEqual([{peer:a.account,...returnRoute}]);
    await f.call(b,'notify',{to:a.account,kind:'return',event:t,returnRoute:null});await f.settle();expect(f.sent).toHaveLength(0);
    f.advance(91000);await f.settle();expect(f.sent.map(s=>s.payload.kind)).toEqual(['return']);
    await g.call(b,'ready-ack',{peer:a.account,token:t});expect((await g.call(b,'ready',{node:false})).body.tickets).toEqual([]);
    f.advance(70000);await f.call(b,'notify',{to:a.account,kind:'return',event:token(),returnRoute:null});await f.settle();expect(f.sent).toHaveLength(1);
  });
  it('suppresses reverse notifications with a node on either side, including a late node attachment',async()=>{
    const f=await fixture(),a=await person(),b=await person();await f.register(a,[b],true);await f.register(b,[a]);const t=token();
    expect((await f.call(a,'waiting',{peer:b.account,token:t,pending:true})).body.waiting).toBe(false);
    await f.register(a,[b]);await f.call(a,'waiting',{peer:b.account,token:t,pending:true});await f.call(b,'notify',{to:a.account,kind:'return',event:t,returnRoute:null});await f.register(a,[b],true);f.advance(91000);await f.settle();expect(f.sent).toHaveLength(0);
    await f.register(b,[a],true);await f.call(a,'notify',{to:b.account,kind:'message',event:token(),returnRoute:{provider:f.origin+'/api/notifications',device:a.device,token:t,expires:f.time()+3600000}});
    expect((await f.call(b,'ready',{node:true})).body.tickets).toEqual([]);
  });
  it('cancels reverse jobs after delivery/cancellation and removes an account without unsubscribing other profiles',async()=>{
    const f=await fixture(),a=await person(),b=await person();await f.register(a,[b]);const t=token();await f.call(a,'waiting',{peer:b.account,token:t,pending:true});await f.call(b,'notify',{to:a.account,kind:'return',event:t,returnRoute:null});await f.call(a,'waiting',{peer:b.account,token:t,pending:false});f.advance(91000);await f.settle();expect(f.sent).toHaveLength(0);
    await f.call(a,'unregister',{});await f.call(b,'notify',{to:a.account,kind:'message',event:token(),returnRoute:null});await f.settle();expect(f.sent).toHaveLength(0);
  });
  it('retains VAPID identity, registrations and bounded retry jobs after process replacement',async()=>{
    const dir=mkdtempSync(join(tmpdir(),'automesh-notifications-'));cleanup.push(()=>rmSync(dir,{recursive:true,force:true}));
    const f=await fixture({directory:dir,fail:true}),a=await person(),b=await person();await f.register(b,[a]);const key=(await invoke(f.service,'GET','config')).body.publicKey;
    await f.call(a,'notify',{to:b.account,kind:'message',event:token(),returnRoute:null});await f.settle();await f.service.close();
    const g=await fixture({directory:dir});g.advance(60000);expect((await invoke(g.service,'GET','config')).body.publicKey).toBe(key);await g.settle();expect(g.sent).toHaveLength(1);
  });
  it('isolates unavailable notification storage instead of throwing into application startup',async()=>{
    const service=createNotifications({origin:'https://automesh.online',enabled:false});cleanup.push(()=>service.close());expect((await invoke(service,'GET','config')).status).toBe(503);
  });
  it('retains per-device mute policy across provider replacement',async()=>{
    const dir=mkdtempSync(join(tmpdir(),'automesh-notification-policy-'));cleanup.push(()=>rmSync(dir,{recursive:true,force:true}));
    const f=await fixture({directory:dir}),a=await person(),b=await person();await f.register(b,[a]);await f.call(b,'policy',{muted:{[a.account]:-1},viewing:''});await f.service.close();
    const g=await fixture({directory:dir});await g.call(a,'notify',{to:b.account,kind:'message',event:token(),returnRoute:null});await g.settle();expect(g.sent).toHaveLength(0);
    await g.call(b,'policy',{muted:{},viewing:''});await g.call(a,'notify',{to:b.account,kind:'message',event:token(),returnRoute:null});await g.settle();expect(g.sent).toHaveLength(1);
  });
});
