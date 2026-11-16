import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebCryptoIdentity } from '../identity/webcrypto';
import { getAccountId } from '../addressing/address';
import { bytesToHex } from '../message/encoding';
import { emptySessionChats, ensureConversation, recordSentMessage, setContactState, setDeliveryStatus } from '../chat/session-chats';
import { NotificationController, notificationRequest, pendingNotificationPeers, type NotificationPort } from './client';
import { emptyNotifications, normalizeNotifications, rememberNotificationRoute, muteChatNotifications, chatNotificationsMuted } from './state';
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
    const input=JSON.parse(options.body);calls.push({url:String(url),input});return new Response(JSON.stringify(String(url).endsWith('/policy')?{updated:true}:String(url).endsWith('/ready')?{tickets:[],waiting:[]}:String(url).endsWith('/waiting')?{waiting:input.body.pending}:{accepted:true}));
  }) as unknown as typeof fetch;
  const port:NotificationPort={...a,device:'d'.repeat(43),defaultProvider:'https://automesh.online/api/notifications',current:()=>true,internet:()=>true,hasNode:()=>false,state:()=>state,chats:()=>chats,locale:()=> 'ru',save:async value=>{state=value;return true;},sendRoute:async(peer,route)=>{announced.push({peer,route});},connected:()=>false,subscription:async()=>subscription,request,status:value=>{statuses.push(value);},...overrides};
  const controller=new NotificationController(port);clean.push(()=>controller.close());
  return {a,b,controller,port,calls,announced,statuses,request,get chats(){return chats;},set chats(value){chats=value;},get state(){return state;},set state(value){state=value;}};
}
describe('notification side channel',()=>{
  it('keeps per-chat mute settings local, normalizes them and expires them automatically',async()=>{
    const f=await fixture(),now=Date.now(),temporary=muteChatNotifications(f.state,f.b.account,3600000,now);
    expect(chatNotificationsMuted(temporary,f.b.account,now+3599999)).toBe(true);expect(chatNotificationsMuted(temporary,f.b.account,now+3600000)).toBe(false);
    const forever=muteChatNotifications(f.state,f.b.account,-1);expect(chatNotificationsMuted(normalizeNotifications(JSON.parse(JSON.stringify(forever))),f.b.account,now+365*86400000)).toBe(true);
    expect(chatNotificationsMuted(muteChatNotifications(forever,f.b.account,0),f.b.account)).toBe(false);expect(f.state.muted).toBeUndefined();
  });
  it('syncs mute and the focused peer without publishing either preference to contacts',async()=>{
    const f=await fixture({viewing:()=>''});f.state={...f.state,enabled:true};
    expect(await f.controller.mute(f.b.account,-1)).toBe(true);
    expect(f.calls.find(c=>c.url.endsWith('/policy')).input.body.muted[f.b.account]).toBe(-1);expect(f.announced).toEqual([]);
    f.port.viewing=()=>f.b.account;await f.controller.tick(true);expect(f.calls.filter(c=>c.url.endsWith('/policy')).at(-1).input.body.viewing).toBe(f.b.account);
    f.port.viewing=()=>'';await f.controller.tick(true);expect(f.calls.filter(c=>c.url.endsWith('/policy')).at(-1).input.body.viewing).toBe('');
  });
  it('retains an offline mute locally and reports that closed-browser enforcement is pending',async()=>{
    const f=await fixture({internet:()=>false});f.state={...f.state,enabled:true};expect(await f.controller.mute(f.b.account,86400000)).toBe(false);
    expect(chatNotificationsMuted(f.state,f.b.account)).toBe(true);expect(f.statuses).toContain('notification_policy_pending');expect(f.calls).toEqual([]);
  });
  it('distinguishes browser denial from provider failure without stopping outgoing notifications',async()=>{
    const f=await fixture({permission:()=> 'denied'});f.state={...f.state,enabled:true};await f.controller.tick(true);expect(f.statuses).toContain('notification_denied');expect(f.calls.some(c=>c.url.endsWith('/notify'))).toBe(true);
  });
  it('cancels the same opaque event used by an earlier send without changing message delivery',async()=>{
    const f=await fixture();await f.controller.tick(true);const event=f.calls.find(c=>c.url.endsWith('/notify')).input.body.event;const before=JSON.stringify(f.chats);
    await f.controller.cancelMessage(f.b.account,f.chats.byPeer[f.b.account].messages[0].id);expect(f.calls.find(c=>c.url.endsWith('/cancel')).input.body.event).toBe(event);expect(JSON.stringify(f.chats)).toBe(before);
  });
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
  it('waits through a two-minute attachment upload to an older home node, then notifies after commit even with stale direct presence',async()=>{
    const f=await fixture({hasNode:()=>true});
    const c=f.chats.byPeer[f.b.account],m=c.messages[0];c.connection='connected';
    m.file={id:m.id,name:'sticker.webp',mime:'image/webp',size:1000,sha256:'a'.repeat(64)};m.fileStatus='sending';m.fileProgress=50;
    await f.controller.tick(true);expect(f.calls.filter(c=>c.url.endsWith('/notify'))).toHaveLength(0);
    m.timestamp-=120000;m.fileProgress=900;await f.controller.tick(true);expect(f.calls.filter(c=>c.url.endsWith('/notify'))).toHaveLength(0);
    f.chats=setDeliveryStatus(f.chats,f.b.account,m.id,'stored');await f.controller.tick(true);
    const n=f.calls.filter(c=>c.url.endsWith('/notify'));expect(n).toHaveLength(1);expect(n[0].input.body.kind).toBe('message');expect(n[0].input.body.returnRoute).toBeNull();
  });
  it('notifies immediately about an attempt without a node while an attachment is still pending',async()=>{
    const f=await fixture(),m=f.chats.byPeer[f.b.account].messages[0];m.file={id:m.id,name:'sticker.webp',mime:'image/webp',size:1000,sha256:'a'.repeat(64)};m.fileStatus='queued';
    await f.controller.tick(true);expect(f.calls.find(c=>c.url.endsWith('/notify')).input.body.kind).toBe('attempt');
  });
  it('a newer incomplete upload does not hide an older committed message',async()=>{
    const f=await fixture({hasNode:()=>true}),m=f.chats.byPeer[f.b.account].messages[0];m.delivery='stored';
    f.chats=recordSentMessage(f.chats,f.b.account,{...m,id:crypto.randomUUID(),delivery:'queued',timestamp:Date.now()});
    await f.controller.tick(true);expect(f.calls.filter(c=>c.url.endsWith('/notify'))).toHaveLength(1);
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
