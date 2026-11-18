import type { IdentityProvider } from '../identity/identity';
import type { ChatEntry, SessionChats } from '../chat/session-chats';
import { localOutgoing } from '../application/delivery-work';
import { NOTIFICATION_PROTOCOL, providerUrl, muteChatNotifications, type NotificationRoute, type NotificationState } from './state';

const encode=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const decode=(s:string)=>Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
export const notificationDevice = (storage:Pick<Storage,'getItem'|'setItem'>):string => {
  const key='automesh.notification-device.v1'; let id=storage.getItem(key);
  if (!id || !/^[A-Za-z0-9_-]{43}$/.test(id)) {id=encode(crypto.getRandomValues(new Uint8Array(32)));storage.setItem(key,id);}
  return id;
};
export async function notificationRequest(provider:string,action:string,account:string,device:string,identity:IdentityProvider,body:unknown,request:typeof fetch=fetch,signal?:AbortSignal):Promise<any> {
  const input=await signedNotification(provider,action,account,device,identity,body);
  if (signal?.aborted) throw Error('notification_closed');
  const response=await request(`${provider}/${action}`,{method:'POST',mode:'cors',keepalive:action==='view-close',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(12000)]):AbortSignal.timeout(12000)});
  if (!response.ok) throw Error(response.status===429?'notification_rate':'notification_unavailable');
  return response.json();
}
export async function signedNotification(provider:string,action:string,account:string,device:string,identity:IdentityProvider,body:unknown) {
  const input={account,device,at:Date.now(),nonce:encode(crypto.getRandomValues(new Uint8Array(24))),body,publicKey:'',signature:''};
  input.publicKey=encode(await identity.getPublicKeyBytes());
  input.signature=encode(await identity.sign(new TextEncoder().encode(JSON.stringify([NOTIFICATION_PROTOCOL,provider,action,input.account,input.device,input.at,input.nonce,input.body]))));
  return input;
}
export function pendingNotificationPeers(chats:SessionChats,self:string,now=Date.now()):string[] {
  return chats.order.filter(peer=>peer!==self && chats.byPeer[peer]?.contact==='accepted' && chats.byPeer[peer].messages.some(m=>notificationCandidate(m,now)));
}
function notificationCandidate(m:ChatEntry,now:number,storedOnly=false):boolean {
  return localOutgoing(m) && ['queued','sending','sent','stored'].includes(m.delivery??'') && (!storedOnly || m.delivery==='stored') &&
    !m.details?.ephemeral && !m.details?.ephemeralOpened && !m.details?.pin && !m.fileDeleted && !['ready','rejected','canceled'].includes(m.fileStatus??'') &&
    now-m.timestamp>=0 && now-m.timestamp<24*3600000;
}
type Ticket={manual?:boolean;peer:string;provider:string;device:string;token:string;expires:number};
export interface NotificationPort {
  account:string; device:string; identity:IdentityProvider; defaultProvider:string;
  current():boolean; internet():boolean; hasNode():boolean; state():NotificationState; chats():SessionChats;
  locale():'ru'|'en'; save(state:NotificationState):Promise<boolean>;
  sendRoute(peer:string,route:NotificationRoute):Promise<void>;
  connected(peer:string):boolean;
  subscription(provider:string,key?:string):Promise<PushSubscription | null>;
  viewing?():string;
  permission?():NotificationPermission|'unsupported';
  request?:typeof fetch;
  status?(value:string):void;
}
// A side channel, never a delivery worker: no message bodies, encryption keys,
// delivery-state writes, receipts or dependencies in the actual send pipeline.
export class NotificationController {
  private abort=new AbortController();
  private busy=false;
  private rerun=false;
  private registered='';
  private registeredAt=0;
  private cycleAt=0;
  private tokens=new Map<string,string>();
  private announced=new Map<string,{value:string;at:number}>();
  private notified=new Map<string,{at:number;id:string}>();
  private returnPublished=new Map<string,number>();
  private reminding=new Set<string>();
  private ownRoute:NotificationRoute | null=null;
  private policyValue='';
  private policyAt=0;
  private policyProvider='';
  private policyChain:Promise<void>=Promise.resolve();
  constructor(private o:NotificationPort) {}
  close(){
    if(!this.abort.signal.aborted&&this.policyProvider)void notificationRequest(this.policyProvider,'view-close',this.o.account,this.o.device,this.o.identity,{},this.o.request).catch(()=>{});
    this.abort.abort();this.tokens.clear();this.announced.clear();this.returnPublished.clear();this.reminding.clear();
  }
  private current(){return !this.abort.signal.aborted && this.o.current() && this.o.internet();}
  private provider(){return this.o.state().provider || this.o.defaultProvider;}
  private call(provider:string,action:string,body:unknown){
    if (!this.current()) return Promise.reject(Error('notification_closed'));
    return notificationRequest(provider,action,this.o.account,this.o.device,this.o.identity,body,this.o.request,this.abort.signal);
  }
  async config(provider=this.provider()):Promise<{publicKey:string}> {
    if (!providerUrl(provider,new URL(this.o.defaultProvider).origin)) throw Error('notification_provider');
    const r=await (this.o.request??fetch)(`${provider}/config`,{credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',signal:AbortSignal.any([this.abort.signal,AbortSignal.timeout(8000)])});
    const c=await r.json();
    if(!r.ok || c.protocol!==NOTIFICATION_PROTOCOL || typeof c.publicKey!=='string' || !/^[A-Za-z0-9_-]{87}$/.test(c.publicKey))throw Error('notification_provider');
    return c;
  }
  private allowed(){return this.o.chats().order.filter(p=>this.o.chats().byPeer[p]?.contact==='accepted').slice(0,500);}
  private async register(subscription:PushSubscription) {
    const provider=this.provider(),allowed=this.allowed(),node=this.o.hasNode();
    const value=JSON.stringify([provider,subscription.endpoint,allowed,node,this.o.locale()]);
    if(this.registered===value && Date.now()-this.registeredAt<60000)return;
    const serialized=subscription.toJSON();
    await this.call(provider,'register',{subscription:{endpoint:serialized.endpoint,keys:serialized.keys},allowed,locale:this.o.locale(),node});
    if (!this.current()) return;
    this.registered=value;this.registeredAt=Date.now();
    this.policyValue='';
    const last=this.ownRoute;
    if(!last || last.provider!==provider || !last.enabled || last.hasNode!==node)this.ownRoute={provider,device:this.o.device,updatedAt:Date.now(),enabled:true,hasNode:node};
    this.o.status?.('notification_enabled');
  }
  async enable(provider:string) {
    if(this.busy)throw Error('notification_busy');
    this.busy=true;
    try {
      if(!this.current())throw Error('notification_closed');
      const normalized=providerUrl(provider,new URL(this.o.defaultProvider).origin);if(!normalized)throw Error('notification_provider');
      const config=await this.config(normalized);
      const subscription=await this.o.subscription(normalized,config.publicKey);
      if(!subscription || !this.current())throw Error('notification_subscription');
      const before=this.o.state(),old=this.provider();
      // Remove only this account's registration. Other profiles can share a
      // browser subscription; unsubscribing it would silently break them.
      if(before.enabled && old!==normalized)await this.call(old,'unregister',{});
      const next={...before,enabled:true,provider:normalized===this.o.defaultProvider?'':normalized};
      if(!await this.o.save(next) || !this.current())throw Error('notification_storage');
      try {this.registered='';await this.register(subscription);} catch(e) {await this.o.save({...next,enabled:false});throw e;}
      this.cycleAt=0;
    } finally {this.busy=false;}
    void this.tick();
  }
  async disable() {
    if(this.busy)throw Error('notification_busy');this.busy=true;
    try {
      await this.call(this.provider(),'unregister',{});
      if(!this.current())return;
      if(!await this.o.save({...this.o.state(),enabled:false}))throw Error('notification_storage');
      this.ownRoute={provider:this.provider(),device:this.o.device,updatedAt:Date.now(),enabled:false,hasNode:this.o.hasNode()};
      this.registered='';this.tokens.clear();this.announced.clear();this.o.status?.('notification_disabled');
    } finally {this.busy=false;}
    await this.publish();
  }
  async test(){await this.call(this.provider(),'test',{});}
  async mute(peer:string,duration:number):Promise<boolean>{
    if(this.abort.signal.aborted||!this.o.current())throw Error('notification_closed');
    if(!await this.o.save(muteChatNotifications(this.o.state(),peer,duration)))throw Error('notification_storage');
    if(!this.o.state().enabled)return true;
    try{await this.syncPolicy(true);return true;}catch{this.o.status?.('notification_policy_pending');return false;}
  }
  private syncPolicy(force=false):Promise<void>{
    const work=this.policyChain.then(()=>this.sendPolicy(force));
    this.policyChain=work.catch(()=>{});return work;
  }
  private async sendPolicy(force=false){
    const muted=Object.fromEntries(Object.entries(this.o.state().muted??{}).filter(([peer,t])=>this.allowed().includes(peer)&&(t===-1||t>Date.now())));
    const viewing=this.o.viewing?.()??'';
    const body={muted,viewing:this.allowed().includes(viewing)?viewing:''},value=JSON.stringify(body);
    if(!force&&value===this.policyValue&&(!body.viewing||Date.now()-this.policyAt<10000))return;
    const response=await this.call(this.provider(),'policy',body);
    if(response.updated!==true)throw Error('notification_policy_pending');
    if(!this.current())return;
    this.policyValue=value;this.policyAt=Date.now();
    this.policyProvider=this.provider();
    this.o.status?.('notification_enabled');
  }
  nodeChanged() {
    if(this.current() && this.o.state().enabled && this.o.hasNode())void this.call(this.provider(),'ready',{node:true}).catch(()=>{});
  }
  async nodeWake(peer:string,messageId:string,providers:unknown):Promise<unknown> {
    if(!this.current() || this.o.chats().byPeer[peer]?.contact!=='accepted' || !Array.isArray(providers))return undefined;
    const message=this.o.chats().byPeer[peer].messages.find(m=>m.id===messageId);
    if(!localOutgoing(message) || message.details?.ephemeral || message.details?.ephemeralOpened || message.details?.pin || ['delivered','read'].includes(message.delivery??''))return undefined;
    const known=this.o.state().peers[peer]??[];
    const wanted=new Set([...known.filter(r=>r.enabled).map(r=>r.provider),this.o.defaultProvider]);
    const event=encode(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${NOTIFICATION_PROTOCOL}:${this.o.account}:${peer}:${messageId}`))));
    const requests=[];
    for(const provider of providers.slice(0,8))if(typeof provider==='string'&&wanted.has(provider)&&providerUrl(provider)){
      requests.push({provider,input:await signedNotification(provider,'notify',this.o.account,this.o.device,this.o.identity,{to:peer,kind:'message',event,returnRoute:null})});
      if(requests.length>=4)break;
    }
    if(!this.current())return undefined;
    return requests.length?{protocol:'automesh-notification-wake-v1',requests}:undefined;
  }
  async delivered(peer:string) {
    if(!this.current() || !this.o.state().enabled || pendingNotificationPeers(this.o.chats(),this.o.account).includes(peer))return;
    const t=this.tokens.get(peer);if(!t)return;
    try{await this.call(this.provider(),'waiting',{peer,token:t,pending:false});this.tokens.delete(peer);}catch{/* Reconciled by ready() after reconnect. */}
  }
  async cancelMessage(peer:string,messageId:string){
    if(!this.current()||this.o.chats().byPeer[peer]?.contact!=='accepted')return;
    const event=encode(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${NOTIFICATION_PROTOCOL}:${this.o.account}:${peer}:${messageId}`))));
    const providers=[...new Set([...(this.o.state().peers[peer]??[]).filter(r=>r.enabled).map(r=>r.provider),this.o.defaultProvider])].slice(0,4);
    for(const provider of providers){if(!this.current())return;try{await this.call(provider,'cancel',{to:peer,event});}catch{/* Notification cancellation cannot gate primary cancellation. */}}
    await this.delivered(peer);
  }
  async publish(peer?:string) {
    if(!this.current() || !this.ownRoute)return;
    const route=this.ownRoute,value=JSON.stringify(route);
    for(const p of peer?[peer]:this.allowed()) {
      if(!this.o.connected(p) || !this.allowed().includes(p))continue;
      const last=this.announced.get(p);if(last?.value===value && Date.now()-last.at<60000)continue;
      this.announced.set(p,{value,at:Date.now()});
      try {await this.o.sendRoute(p,route);} catch {this.announced.delete(p);}
      if(!this.current())return;
    }
  }
  async tick(force=false) {
    if(!this.current())return;
    if(this.busy){if(force)this.rerun=true;return;}
    if(!force && Date.now()-this.cycleAt<10000)return;
    this.busy=true;this.cycleAt=Date.now();
    try {
      const state=this.o.state();
      if(state.enabled) try {
        const denied=this.o.permission?.()==='denied';
        const subscription=denied?null:await this.o.subscription(this.provider());
        if(!this.current())return;
        if(!subscription)this.o.status?.(denied?'notification_denied':'notification_reconnect');
        else {await this.register(subscription);try{await this.syncPolicy();}catch{this.o.status?.('notification_policy_pending');}await this.publish();await this.ready();}
      } catch {if(this.current())this.o.status?.('notification_unavailable');}
      await this.wakePeers();
    } catch {if(this.current())this.o.status?.('notification_unavailable');}
    finally {this.busy=false;if(this.rerun){this.rerun=false;if(this.current())void this.tick(true);}}
  }
  async remindSender(peer:string):Promise<number>{
    const c=this.o.chats().byPeer[peer];
    if(!this.current()||!this.o.state().enabled||!c||c.contact!=='accepted'||this.o.hasNode()||
       (this.o.state().peers[peer]??[]).some(r=>r.enabled&&r.hasNode))return 0;
    if(this.reminding.has(peer))return 0;
    this.reminding.add(peer);
    try{return await this.ready(peer);}finally{this.reminding.delete(peer);}
  }
  private async ready(peer?:string):Promise<number> {
    const data=await this.call(this.provider(),'ready',{node:this.o.hasNode(),...(peer?{peer}:{})});
    if(!this.current())return 0;
    const pending=new Set(pendingNotificationPeers(this.o.chats(),this.o.account));
    if(Array.isArray(data.waiting))for(const w of data.waiting.slice(0,500))if(typeof w.peer==='string'&&typeof w.token==='string'&&(!pending.has(w.peer)||this.o.hasNode()))await this.call(this.provider(),'waiting',{peer:w.peer,token:w.token,pending:false});
    if(this.o.hasNode() || !Array.isArray(data.tickets))return 0;
    let sent=0;
    for(const t of data.tickets.slice(0,32) as Ticket[]) {
      if(!this.current())return sent;
      if(peer?t.peer!==peer:t.manual===true)continue;
      if(!this.allowed().includes(t.peer)||(this.o.state().peers[t.peer]??[]).some(r=>r.enabled&&r.hasNode)||!providerUrl(t.provider)||!/^[A-Za-z0-9_-]{22,86}$/.test(t.token)||t.expires<Date.now())continue;
      await this.call(t.provider,'notify',{to:t.peer,kind:'return',event:t.token,returnRoute:null});
      if(!this.current())return sent;
      await this.call(this.provider(),'ready-ack',{peer:t.peer,token:t.token});sent++;
    }
    return sent;
  }
  private async reverseRoute(peer:string):Promise<{provider:string;device:string;token:string;expires:number}|null>{
    if(!this.o.state().enabled||this.o.hasNode()||(this.o.state().peers[peer]??[]).some(r=>r.enabled&&r.hasNode))return null;
    let t=this.tokens.get(peer);if(!t){t=encode(crypto.getRandomValues(new Uint8Array(32)));this.tokens.set(peer,t);}
    try{const w=await this.call(this.provider(),'waiting',{peer,token:t,pending:true});
      return w.waiting?{provider:this.provider(),device:this.o.device,token:t,expires:Date.now()+23*3600000}:null;
    }catch{return null;}
  }
  private async wakePeers() {
    const pending=new Set(pendingNotificationPeers(this.o.chats(),this.o.account));
    const enabled=this.o.state().enabled;
    for(const [peer,t]of this.tokens)if(!pending.has(peer) || this.o.hasNode() || !enabled) {
      if(enabled)await this.call(this.provider(),'waiting',{peer,token:t,pending:false});
      this.tokens.delete(peer);
    }
    for(const peer of [...pending].slice(0,32)) {
      if(!this.current())return;
      const hasNode=this.o.hasNode(),c=this.o.chats().byPeer[peer];
      if(!hasNode&&c.connection==='connected'){
        // Publish a bounded capability while the sender is still here. This
        // records permission for a manual return nudge, without a push/job.
        if(Date.now()-(this.returnPublished.get(peer)??0)>=60000){
          this.returnPublished.set(peer,Date.now());
          const route=await this.reverseRoute(peer);
          if(route)for(const provider of [...new Set([...(this.o.state().peers[peer]??[]).filter(r=>r.enabled).map(r=>r.provider),this.o.defaultProvider])].slice(0,4)){
            if(!this.current())return;
            if(providerUrl(provider,new URL(this.o.defaultProvider).origin))try{await this.call(provider,'return-route',{to:peer,route});}catch{/* Older providers keep ordinary delivery/notifications. */}
          }
        }
        continue;
      }
      // Node handoff is authoritative only after all attachment parts and the
      // final envelope commit. A newer queued upload must not hide older work.
      const latest=c.messages.filter(m=>notificationCandidate(m,Date.now(),hasNode)).at(-1)?.id;
      if(!latest)continue;
      const notificationId=`${hasNode?'ready':'attempt'}:${latest}`;
      const prior=this.notified.get(peer);if(prior && (prior.id===notificationId || Date.now()-prior.at<60000))continue;
      const known=this.o.state().peers[peer]??[];
      const providers=[...new Set([...known.filter(r=>r.enabled).map(r=>r.provider),this.o.defaultProvider])].slice(0,4);
      const returnRoute=await this.reverseRoute(peer);
      this.notified.set(peer,{at:Date.now(),id:notificationId});
      const event=encode(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${NOTIFICATION_PROTOCOL}:${this.o.account}:${peer}:${latest}`))));
      for(const provider of providers) {
        if(!providerUrl(provider,new URL(this.o.defaultProvider).origin))continue;
        try {await this.call(provider,'notify',{to:peer,kind:hasNode?'message':'attempt',event,returnRoute});}catch{/* Independent providers and delivery continue. */}
        if(!this.current())return;
      }
    }
  }
}

async function notificationScope(provider:string) {
  const digest=encode(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(provider)))).slice(0,24);
  return `/notifications/${digest}/`;
}
export async function showIncomingNotification(provider:string,locale:'ru'|'en'):Promise<void> {
  if(!('serviceWorker'in navigator) || !('Notification'in window) || Notification.permission!=='granted')return;
  const scope=await notificationScope(provider),registration=await navigator.serviceWorker.getRegistration(scope);
  if(registration?.scope!==new URL(scope,location.origin).href)return;
  registration.active?.postMessage({type:'automesh-local-message',locale});
}
export async function browserSubscription(provider:string,key?:string):Promise<PushSubscription | null> {
  if(!('serviceWorker'in navigator) || !('PushManager'in window) || !('Notification'in window) || Notification.permission!=='granted')return null;
  const scope=await notificationScope(provider);
  let registration=await navigator.serviceWorker.getRegistration(scope);
  if(registration?.scope!==new URL(scope,location.origin).href)registration=undefined;
  if(!registration && key) {
    registration=await navigator.serviceWorker.register('/notification-worker.js',{scope,updateViaCache:'none'});
    if(!registration.active)await new Promise<void>((resolve,reject)=>{
      const worker=registration!.installing??registration!.waiting;
      if(!worker){reject(Error('notification_worker'));return;}
      const timeout=setTimeout(()=>reject(Error('notification_worker')),15000);
      const changed=()=>{if(worker.state==='activated'){clearTimeout(timeout);resolve();}else if(worker.state==='redundant'){clearTimeout(timeout);reject(Error('notification_worker'));}};
      worker.addEventListener('statechange',changed);changed();
    });
  }
  if(!registration)return null;
  const subscription=await registration.pushManager.getSubscription();
  if(subscription)return subscription;
  return key ? registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:decode(key)}) : null;
}
