import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebCryptoIdentity } from '../identity/webcrypto';
import { getAccountId } from '../addressing/address';
import { bytesToHex } from '../message/encoding';
import { emptySessionChats, ensureConversation, recordSentMessage, setContactState, setDeliveryStatus } from '../chat/session-chats';
import { NotificationController, notificationRequest, pendingNotificationPeers, type NotificationPort } from './client';
import { emptyNotifications, normalizeNotifications, rememberNotificationRoute } from './state';
import { normalizeLocalChatData } from '../chat/local-store';
import { portableChatData } from '../backup/full-backup';
const clean:Array<()=>void>=[];
afterEach(()=>{clean.splice(0).forEach(f=>f());vi.restoreAllMocks();});
async function person(n:number){const identity=new WebCryptoIdentity(),seed=new Uint8Array(32);seed[31]=n;const pub=await identity.fromSeed(seed);clean.push(()=>identity.dispose());return {identity,account:await getAccountId(bytesToHex(pub.publicKey))};}
async function fixture(overrides:Partial<NotificationPort>={}) {
  const a=await person(2),b=await person(3);let chats=setContactState(ensureConversation(emptySessionChats(),b.account),b.account,'accepted');
  chats=recordSentMessage(chats,b.account,{id:crypto.randomUUID(),text:'private content',from:a.account,timestamp:Date.now()-20000,direction:'outgoing',delivery:'queued'});
  let state=emptyNotifications();const calls:any[]=[],announced:any[]=[],statuses:string[]=[];
  const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/example',toJSON:()=>({endpoint:'https://fcm.googleapis.com/fcm/send/example',keys:{p256dh:'b'.repeat(87),auth:'a'.repeat(22)}})} as unknown as PushSubscription;
  const request=vi.fn(async(url:any,options:any)=>{
    if(String(url).endsWith('/config'))return new Response(JSON.stringify({protocol:'automesh-notifications-v1',publicKey:'a'.repeat(87)}));
    const input=JSON.parse(options.body);calls.push({url:String(url),input});return new Response(JSON.stringify(String(url).endsWith('/ready')?{tickets:[],waiting:[]}:String(url).endsWith('/waiting')?{waiting:input.body.pending}:{accepted:true}));
  }) as unknown as typeof fetch;
  const port:NotificationPort={...a,device:'d'.repeat(43),defaultProvider:'https://automesh.online/api/notifications',current:()=>true,internet:()=>true,hasNode:()=>false,state:()=>state,chats:()=>chats,locale:()=> 'ru',save:async value=>{state=value;return true;},sendRoute:async(peer,route)=>{announced.push({peer,route});},connected:()=>false,subscription:async()=>subscription,request,status:value=>{statuses.push(value);},...overrides};
  const controller=new NotificationController(port);clean.push(()=>controller.close());
  return {a,b,controller,port,calls,announced,statuses,request,get chats(){return chats;},set chats(value){chats=value;},get state(){return state;},set state(value){state=value;}};
}
describe('notification side channel',()=>{
  it('sends only an opaque wake signal without requiring a subscription or changing delivery',async()=>{
    const f=await fixture();const before=JSON.stringify(f.chats);await f.controller.tick(true);
    const notify=f.calls.find(c=>c.url.endsWith('/notify'));expect(notify.input.body.returnRoute).toBeNull();expect(JSON.stringify(notify)).not.toContain('private content');expect(JSON.stringify(f.chats)).toBe(before);
    await f.controller.tick(true);expect(f.calls.filter(c=>c.url.endsWith('/notify'))).toHaveLength(1);
  });
  it('suppresses reverse tickets with a node but still wakes the recipient for a node-stored message',async()=>{
    const f=await fixture({hasNode:()=>true});f.state={...f.state,enabled:true};const m=f.chats.byPeer[f.b.account].messages[0];f.chats=setDeliveryStatus(f.chats,f.b.account,m.id,'stored');await f.controller.tick(true);
    expect(f.calls.find(c=>c.url.endsWith('/register')).input.body.node).toBe(true);
    expect(f.calls.filter(c=>c.url.endsWith('/waiting'))).toHaveLength(0);expect(f.calls.find(c=>c.url.endsWith('/notify')).input.body.returnRoute).toBeNull();
  });
  it('creates an authenticated reverse ticket without a node and cancels it immediately after receipt',async()=>{
    const f=await fixture();f.state={...f.state,enabled:true};await f.controller.tick(true);
    const n=f.calls.find(c=>c.url.endsWith('/notify'));expect(n.input.body.returnRoute.provider).toBe(f.port.defaultProvider);expect(n.input.body.returnRoute.token).toHaveLength(43);
    const m=f.chats.byPeer[f.b.account].messages[0];f.chats=setDeliveryStatus(f.chats,f.b.account,m.id,'delivered');await f.controller.delivered(f.b.account);
    expect(f.calls.filter(c=>c.url.endsWith('/waiting')).at(-1).input.body.pending).toBe(false);
  });
  it('excludes blocked contacts, historical imports, radio-only and terminal jobs from wake signals',async()=>{
    const f=await fixture();const m=f.chats.byPeer[f.b.account].messages[0];
    for(const patch of [{restoredFromBackup:true},{importedFromDevice:true},{delivery:'delivered'},{nodeQueue:'canceled'},{radioDelivery:'queued'},{details:{pin:{messageId:crypto.randomUUID(),action:'pin'}}}]) {
      const c=structuredClone(f.chats);Object.assign(c.byPeer[f.b.account].messages[0],patch);expect(pendingNotificationPeers(c,f.a.account)).toEqual([]);
    }
    expect(pendingNotificationPeers(setContactState(f.chats,f.b.account,'blocked'),f.a.account)).toEqual([]);
    expect(pendingNotificationPeers(f.chats,f.a.account,m.timestamp+25*3600000)).toEqual([]);
  });
  it('sends to an accepted custom provider, tolerates its failure and preserves primary delivery',async()=>{
    const f=await fixture();f.state=rememberNotificationRoute(f.state,f.b.account,{provider:'https://custom.automesh.online/api/notifications',device:'a'.repeat(43),updatedAt:Date.now(),enabled:true,hasNode:false});
    const request=f.port.request!;f.port.request=async(url,options)=>{if(String(url).includes('custom.'))throw Error('outage');return request(url,options);};
    const before=JSON.stringify(f.chats);await f.controller.tick(true);expect(f.calls.some(c=>c.url===f.port.defaultProvider+'/notify')).toBe(true);expect(JSON.stringify(f.chats)).toBe(before);
  });
  it('does no work after lock/profile change and does not import notification subscriptions from a backup',async()=>{
    const f=await fixture({current:()=>false});await f.controller.tick(true);expect(f.calls).toEqual([]);
    const data=normalizeLocalChatData({notifications:{enabled:true,provider:'',peers:{}},chats:{order:[],byPeer:{}}});expect(portableChatData(data).notifications).toBeUndefined();
  });
  it('normalizes routing metadata and ignores stale or private-network providers',async()=>{
    const f=await fixture(),route={provider:'https://notify.automesh.online/api/notifications',device:'a'.repeat(43),updatedAt:Date.now(),enabled:true,hasNode:false};
    const s=rememberNotificationRoute(f.state,f.b.account,route);expect(s.peers[f.b.account]).toHaveLength(1);expect(rememberNotificationRoute(s,f.b.account,{...route,updatedAt:route.updatedAt-1})).toBe(s);
    expect(rememberNotificationRoute(s,f.b.account,{...route,provider:'https://127.0.0.1/api/notifications'})).toBe(s);expect(normalizeNotifications({enabled:true,provider:'http://evil.org/api/notifications'}).provider).toBe('');
  });
  it('binds every request to provider, operation and account using the existing identity',async()=>{
    const a=await person(7);let packet:any;
    const fetcher=async(_url:any,options:any)=>{packet=JSON.parse(options.body);return new Response('{}');};
    await notificationRequest('https://automesh.online/api/notifications','ready',a.account,'a'.repeat(43),a.identity,{node:false},fetcher as typeof fetch);
    const key=await crypto.subtle.importKey('raw',await a.identity.getPublicKeyBytes() as Uint8Array<ArrayBuffer>,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
    const bytes=new TextEncoder().encode(JSON.stringify(['automesh-notifications-v1','https://automesh.online/api/notifications','ready',packet.account,packet.device,packet.at,packet.nonce,packet.body]));
    const sig=Uint8Array.from(atob(packet.signature.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));expect(await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,sig,bytes)).toBe(true);
  });
  it('gives a capable node only signed content-free wakes for approved providers, with no reverse route',async()=>{
    const f=await fixture({hasNode:()=>true});
    const id=f.chats.byPeer[f.b.account].messages[0].id;
    const wake=await f.controller.nodeWake(f.b.account,id,[f.port.defaultProvider,'https://unapproved.org/api/notifications']) as any;
    expect(wake.protocol).toBe('automesh-notification-wake-v1');expect(wake.requests).toHaveLength(1);
    expect(wake.requests[0].input.body.to).toBe(f.b.account);expect(wake.requests[0].input.body.returnRoute).toBeNull();expect(JSON.stringify(wake)).not.toContain('private content');
    f.chats=setContactState(f.chats,f.b.account,'blocked');expect(await f.controller.nodeWake(f.b.account,id,[f.port.defaultProvider])).toBeUndefined();
  });
});
