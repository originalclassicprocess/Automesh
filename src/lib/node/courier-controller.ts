import type { IdentityProvider } from '$lib/identity/identity';
import { deliveryIssueForError, deliveryIssueText, safeDeliveryErrorCode, type DeliveryIssue } from '$lib/application/delivery-issues';
import type { ChatMessage } from '$lib/chat/ChatService';
import type { SessionChats } from '$lib/chat/session-chats';
import type {CourierStage} from '$lib/chat/node-transfer';
import { encodeChatContent, decodeChatContent } from '$lib/chat/message-details';
import { signedNodeRequest, requireNodeNetwork } from './client';
import { unbase64, cipherDigest } from './offline-crypto';
import { createCourierJob, createAllocatedCourierJob, generateCourierKey, openCourier, signCourier, validateCourierBundle, verifyCourier,
  type CourierBundle, type CourierJob, type CourierHop, type CourierPacket, type CourierRoute, type KeySource, type QueueSource, type PrekeyAllocation, type PrekeyCertificate } from './courier-crypto';
import {COURIER_PREKEY_PROTOCOL,PREKEY_TARGET,PREKEY_LOW,MAX_PRIVATE_COURIER_KEYS,MAX_DIRECTORY_KEYS,validateAllocation} from './courier-prekeys.js';
import { COURIER_ROUTE_PROTOCOL, publicCourierSignal,validateCourierRoute } from './courier-route.js';
import { COURIER_PROTOCOL, COURIER_TTL, validateCourierJob } from './courier-protocol.js';
import type {RemoteKeyStock} from './key-stock';
import type { CourierState } from './courier-state';
import { createAttachmentManifest, decryptAttachmentPart, encryptAttachmentPart, attachmentHash, FILE_CONTENT_PREFIX, EPHEMERAL_FILE_PREFIX, validateManifest } from './attachment-crypto';
import { ATTACHMENT_PROTOCOL, FILE_POLICY_BYTES } from './attachment-protocol.js';
import { manifestContent, type CourierFileIO } from './courier-files';
import {readQueueSnapshot,type QueueSnapshot} from './queue-quota';
import type {QueueCleanup} from './queue-cleanup';
import { base64 } from './offline-crypto';
import { emptyDeliveryDiagnostics, deliveryFailure, type DeliveryDiagnostics } from './delivery-diagnostics';
export type CourierDelivery = { from: string; job: CourierJob; hop: CourierHop };
export type CourierReply = ((id: string, receipt: string) => unknown) & {
  source?:QueueSource;
  pull?: boolean;
  chunk?(request: import('./offline-crypto').Signed<{ protocol: string; from: string; to: string; id: string; index: number; requestId: string; expiresAt: number }>, signal: AbortSignal): Promise<Uint8Array>;
};
export type CourierStatus = { connection: 'idle' | 'checking' | 'connected' | 'offline'; relay: string; lan?: string; stored: number; keyStocks?:Record<string,RemoteKeyStock>;queue?:QueueSnapshot;cleanup?:QueueCleanup };
export const idleCourierStatus = (): CourierStatus => ({ connection: 'idle', relay: 'disabled', stored: 0 });
const keyLookupIssue=(error:unknown):DeliveryIssue=>error instanceof Error&&['prekeys_unavailable','prekey_capacity'].includes(error.message)?'keys_exhausted':'keys_source_unavailable';
type Port = { address: string; identity: IdentityProvider; state(): CourierState; update(s: CourierState): void;
  chats(): SessionChats; persist(): Promise<boolean>; receive(m: ChatMessage): void;
  authorize?(peer: string): Promise<void>; issue?(peer: string, id: string, issue: DeliveryIssue | undefined, error?: unknown): void;
  activity?(peer:string,id:string,stage:CourierStage|undefined):void;
  outcome?(peer:string,id:string,status:'canceling'|'canceled'|'expired'):void;
  usage?(bytes:number,files:number):void;
  delivery(peer: string, id: string, status: 'queued' | 'stored' | 'delivered'): void;
  publish(peer: string, bundle: CourierBundle): Promise<void>; error(message: string): void; signalingRoutes?(): string[];
  approvedKeySource?(source:KeySource):boolean;
  status?(value: CourierStatus): void; diagnostics?(value: DeliveryDiagnostics): void; request?: typeof signedNodeRequest; lanOnly?(): boolean; files?: CourierFileIO };
export class CourierController {
  private active = true; private abort = new AbortController(); private chain = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | undefined; private queued = 0;
  private started = false; private running = false; private requested = false;
  private uploaded = new Set<string>(); private uploadOffset = 0;
  private activities=new Map<string,{peer:string;stage:CourierStage}>();
  private activity(peer:string,id:string,stage:CourierStage|undefined){
    if(!this.active)return;
    if(stage===undefined){if(!this.activities.delete(id))return;}
    else {if(this.activities.get(id)?.stage===stage)return;this.activities.set(id,{peer,stage});}
    this.port.activity?.(peer,id,stage);
  }
  private health = idleCourierStatus();
  private outboxCursor='';
  private outboxScanAt=0;
  private quotaDirty=false;
  private cleanupRun:Promise<void>|null=null;
  private remotePolls=new Map<string,Promise<void>>();
  private remoteInbox=new Map<string,{at:number;cursor:string}>();
  private remoteOffset=0;
  private routeNode = '';
  private syncedRoutes = new Map<string,string>();
  private diagnostic = emptyDeliveryDiagnostics();
  private trace(patch: Partial<DeliveryDiagnostics>) {
    if (!this.active) return;
    this.diagnostic = { ...this.diagnostic, ...patch }; this.port.diagnostics?.({ ...this.diagnostic });
  }
  private fileReplies = new Map<string, CourierReply>();
  private inboxCursor = '';
  private inboxSupported = false;
  private downloadOffset = 0;
  private retryAfter = 0;
  private prekeysSupported=false;
  private keyStocks:Record<string,RemoteKeyStock>={};
  private stockPolls=new Map<string,Promise<void>>();
  private stockEpoch=new Map<string,number>();
  private directReplies=new Map<string,ReturnType<typeof setTimeout>>();
  private directRefillAt=new Map<string,number>();
  private prekeysChecked=new Map<string,number>();
  private prekeysRevoked=new Set<string>();
  private prekeysRevokeChecked=new Map<string,number>();
  private keySourceRetryAt=new Map<string,{at:number;issue:DeliveryIssue}>();
  constructor(private port: Port) {}
  stop() { for(const [id,{peer}] of this.activities)this.activity(peer,id,undefined);this.active = false; this.abort.abort(); clearTimeout(this.timer); this.fileReplies.clear();for(const timer of this.directReplies.values())clearTimeout(timer);this.directReplies.clear(); }
  settled() { return Promise.allSettled([this.chain,...this.stockPolls.values(),...this.remotePolls.values(),this.cleanupRun]); }
  private current() { if (!this.active) throw new Error('courier_session_closed'); }
  private serial(work: () => Promise<void>) {
    if (!this.active || this.queued >= 32) return Promise.reject(new Error('courier_busy'));
    this.queued++;
    const result = this.chain.then(async () => { this.current(); await work(); }).finally(() => { this.queued--; });
    this.chain = result.catch(() => {}); return result;
  }
  private update(s: CourierState) { this.current(); this.port.update(s); }
  private async persist() { this.current(); if (!await this.port.persist()) throw new Error('courier_not_saved'); this.current(); }
  private async pace(ms: number) {
    this.current(); await new Promise<void>((resolve, reject) => {
      const done = () => { clearTimeout(timer); this.abort.signal.removeEventListener('abort', abort); resolve(); };
      const abort = () => { clearTimeout(timer); this.abort.signal.removeEventListener('abort', abort); reject(new Error('courier_session_closed')); };
      const timer = setTimeout(done, ms); this.abort.signal.addEventListener('abort', abort, { once: true });
    }); this.current();
  }
  private async request(path: string, value: unknown): Promise<any> {
    let result;
    try {result=await this.requestAt(this.port.state().node!,path,value);}
    catch(error){if(this.active&&(error instanceof TypeError||error instanceof Error&&error.name==='AbortError'))this.report('offline');throw error;}
    // HTTPS queue access and signaling are independent connections.
    if(this.health.connection!=='connected')this.report('connected');
    if(['/outbox/put','/outbox/cancel','/outbox/file/start','/inbox/ack'].includes(path))this.quotaDirty=true;
    return result;
  }
  private async requestAt(node:KeySource,path:string,value:unknown,optional=false):Promise<any>{
    this.current(); const timeout = new AbortController();
    requireNodeNetwork(node.url, this.port.lanOnly?.());
    const abort = () => timeout.abort(); this.abort.signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, optional||path==='/prekeys/allocate'||path==='/prekeys/availability'?6000:15000);
    try { const result = await (this.port.request ?? signedNodeRequest)(node.url, node.nodeId, this.port.identity, this.port.address, path, value, timeout.signal);
      this.current(); return result;
    } catch (error) { if (this.active&&!optional&&path!=='/prekeys/availability') this.retryAfter = Date.now() + 5000; throw error;
    } finally { clearTimeout(timer); this.abort.signal.removeEventListener('abort', abort); }
  }
  private report(connection: CourierStatus['connection'], relay = this.health.relay, lan = this.health.lan) {
    this.health = { connection, relay, lan, keyStocks:{...this.keyStocks},queue:this.health.queue,cleanup:this.health.cleanup, stored: this.port.state().pending.filter(j => this.uploaded.has(j.body.id)).length };
    this.port.status?.(this.health);
  }
  start() { if (this.started) return; this.started = true; this.wake(); }
  // Coalesce bursts without adding competing polls to the serialized actor.
  wake() {
    if (!this.active || !this.started) return;
    this.requested = true;
    if (!this.running) { clearTimeout(this.timer); this.timer = setTimeout(() => void this.tick(), 50); }
  }
  private async tick() {
    if (!this.active || this.running) return;
    this.running = true; this.requested = false;
    try { await this.poll(); } catch (error) { if (this.active) {
      this.requested = false;
      for(const [id,{peer}] of this.activities)this.activity(peer,id,'retrying');
      const reason = deliveryIssueForError(error,'node_unavailable');
      for (const peer of this.port.chats().order) for (const m of this.port.chats().byPeer[peer].messages)
        if (!m.restoredFromBackup && !m.deviceMessage && m.direction === 'outgoing' && ['queued','sent','stored'].includes(m.delivery ?? '') &&
            (this.port.chats().byPeer[peer].connection !== 'connected' || m.directFallback || this.port.state().pending.some(j => j.body.id === m.id))) this.port.issue?.(peer,m.id,reason,error);
      this.port.error(deliveryIssueText(reason,error));
    } } finally {
      this.running = false;
      if (this.active) this.timer = setTimeout(() => void this.tick(), Math.max(this.requested ? 50 : 5000, this.retryAfter - Date.now()));
    }
  }
  configure(node: NonNullable<CourierState['node']>, enabled: boolean) { return this.serial(async () => {
    const s = this.port.state();
    if (s.pending.length && s.node?.address !== node.address) throw new Error('courier_change_pending');
    // Temporarily use the proposed endpoint; revert on failure, never lose reserved jobs.
    this.update({ ...s, node });
    try { const status = await this.request('/outbox/status', {});
      if (status.address !== node.address || (enabled && !(status.enabled ?? Boolean(status.relay)))) throw new Error('courier_disabled');
      this.health.queue=readQueueSnapshot(status);this.outboxCursor='';this.outboxScanAt=0;
      this.prekeysSupported=status.prekeyProtocol===COURIER_PREKEY_PROTOCOL;
      this.routeNode = status.signalingEnabled === true || status.routes?.localInternet && status.routes.localInternet !== 'disabled' ? node.address : '';
      if (enabled && this.port.lanOnly?.() && (!status.deliveryScopes || !status.lanEnabled)) throw new Error('courier_lan_update_required');
      if (s.node?.address !== node.address) { this.uploaded.clear(); this.syncedRoutes.clear();this.prekeysChecked.clear();this.prekeysRevoked.clear();this.prekeysRevokeChecked.clear(); }
      this.report('connected', status.routes?.localInternet === 'connected' ? 'connected' : status.routes?.internet ?? status.status ?? 'connecting', status.routes?.lan);
      this.update({ ...this.port.state(), enabled }); await this.persist();
      this.wake();
    } catch (e) { if (this.active) this.update(s); throw e; }
  }); }
  accept(peer: string, value: unknown) { return this.serial(async () => {
    if (this.port.chats().byPeer[peer]?.contact !== 'accepted') return;
    const bundle = validateCourierBundle(value as CourierBundle, peer, this.port.address);
    await verifyCourier(bundle, 'prekeys', peer); this.current();
    if(bundle.body.senderQueue){await verifyCourier(bundle.body.senderQueue.grant,'recipient-inbox',peer);this.current();}
    const s = this.port.state();
    if (bundle.body.route) { await verifyCourier(bundle.body.route, 'route', peer); this.current(); }
    if (!s.bundles[peer] && Object.keys(s.bundles).length >= 50) throw new Error('courier_contact_limit');
    const consumed=new Set(bundle.body.consumedKeys??[]);
    const keys=s.keys.map(k=>k.peer===peer&&!k.directory&&consumed.has(k.id)?{...k,retired:true as const}:k);
    this.update({ ...s, ...(keys.some(k=>k.retired)?{version:3 as const}:{}), keys, bundles: { ...s.bundles, [peer]: bundle } });
    await this.persist(); this.wake();
    if(bundle.body.requestKeys&&Date.now()-(this.directRefillAt.get(peer)??0)>=5000){
      this.directRefillAt.set(peer,Date.now());
      // Finish accepting this frame before replying. A transport may await its
      // peer's handler, so responding inside the actor can deadlock both peers.
      const timer=setTimeout(()=>{this.directReplies.delete(peer);if(!this.active)return;
        void this.publish(peer).catch(()=>{if(this.active)this.port.error('Не удалось обновить ключи прямого обмена. Повторим при подключении.');});
      },0);this.directReplies.set(peer,timer);
    }
  }); }
  publish(peer: string) { return this.serial(()=>this.publishNow(peer)); }
  private async publishNow(peer:string) {
    if (peer === this.port.address) return;
    if (this.port.chats().byPeer[peer]?.contact !== 'accepted') return;
    const now = Date.now(); const keys = this.port.state().keys.filter(k => k.expiresAt > now);
    let batch = keys.filter(k => !k.retired&&!k.directory&&k.peer === peer && (k.publishUntil??k.expiresAt) > now + 3600000).slice(0, 32);
    if (batch.length <= PREKEY_LOW) {
      const needed=PREKEY_TARGET-batch.length;
      if (keys.length + needed > MAX_PRIVATE_COURIER_KEYS) throw new Error('courier_prekey_limit');
      const extra=[]; for(let i=0;i<needed;i++){extra.push(await generateCourierKey(peer,now+COURIER_TTL,{retainUntil:now+2*COURIER_TTL}));this.current();}
      batch=[...batch,...extra];
      this.update({...this.port.state(),version:this.port.state().version===3?3:2,keys:[...keys,...extra]});
    }
    await this.persist(); // Also covers a reusable batch left in memory by a failed previous save.
    const node = this.port.state().node,known=this.port.state().bundles[peer];
    const consumedKeys=known?.body.keys.filter(k=>this.port.state().used[k.id]).map(k=>k.id)??[];
    const requestKeys=!known||known.body.expiresAt<=now||known.body.keys.length-consumedKeys.length<=PREKEY_LOW;
    const route=await this.advertisedRoute(peer,Math.min(...batch.map(k=>k.publishUntil??k.expiresAt)));
    const senderQueue=node?{url:node.url,nodeId:node.nodeId,address:node.address,grant:await signCourier('recipient-inbox',{
      protocol:'automesh-recipient-inbox-v1',from:this.port.address,to:peer,courier:node.address,nodeId:node.nodeId,issuedAt:now,expiresAt:now+2*COURIER_TTL
    },this.port.identity)}:undefined;
    this.current();
    const bundle = await signCourier('prekeys', { protocol: COURIER_PROTOCOL, from: this.port.address, to: peer,
      ...(route ? { route } : {}), consumedKeys, requestKeys,
      ...(this.port.files ? { attachmentProtocol: ATTACHMENT_PROTOCOL, maxFileBytes: FILE_POLICY_BYTES } : {}),
      ...(batch.every(k=>k.publishUntil!==undefined)?{deliveryTtlMs:COURIER_TTL,retainUntil:Math.min(...batch.map(k=>k.publishUntil!))+COURIER_TTL}:{}),
      ...(this.prekeysSupported&&node?{keySource:{url:node.url,nodeId:node.nodeId}}:{}),
      ...(senderQueue?{senderQueue}:{}),
      expiresAt: Math.min(...batch.map(k => k.publishUntil??k.expiresAt)), keys: batch.map(({ id, publicKey }) => ({ id, publicKey })) }, this.port.identity);
    this.current(); await this.port.publish(peer, bundle);
  }
  private async advertisedRoute(peer:string,expiresAt:number):Promise<CourierRoute|undefined>{
    const node=this.port.state().node,now=Date.now();
    if (node && node.address === this.routeNode && !this.port.lanOnly?.()) {
      let signalingUrl: string | undefined;
      try { signalingUrl = publicCourierSignal(node.url.replace(/^https:/, 'wss:') + '/signal'); } catch { /* Explicit LAN/custom-port routes remain unchanged. */ }
      if (signalingUrl){const route=await signCourier('route', { protocol: COURIER_ROUTE_PROTOCOL, from: this.port.address, to: peer,
        nodeAddress: node.address, nodeId: node.nodeId, signalingUrl, issuedAt: now, expiresAt }, this.port.identity);this.current();return route;}
    }
    if (!this.port.lanOnly?.()) for (const url of this.port.signalingRoutes?.() ?? []) {
      let signalingUrl: string;
      try { signalingUrl = publicCourierSignal(url); } catch { continue; }
      const route=await signCourier('route', { protocol: COURIER_ROUTE_PROTOCOL, kind: 'signaling' as const, from: this.port.address, to: peer,
        signalingUrl, issuedAt: now, expiresAt }, this.port.identity);this.current();return route;
    }
  }
  private sourceAllowed(source:KeySource):boolean{
    const own=this.port.state().node;
    if(own?.url===source.url&&own.nodeId===source.nodeId)return true;
    if(this.port.approvedKeySource?.(source))return true;
    try{publicCourierSignal(source.url.replace(/^https:/,'wss:')+'/signal');return !this.port.lanOnly?.();}catch{return false;}
  }
  private refreshKeyStocks(){
    const chats=this.port.chats(),now=Date.now();
    for(const peer of Object.keys(this.keyStocks))if(chats.byPeer[peer]?.contact!=='accepted')delete this.keyStocks[peer];
    const peers=[...new Set([chats.activePeer,...this.port.state().pending.map(j=>j.body.to)])].filter(peer=>{
      const source=this.port.state().bundles[peer]?.body.keySource,previous=this.keyStocks[peer];
      return source&&!this.stockPolls.has(peer)&&chats.byPeer[peer]?.contact==='accepted'&&this.sourceAllowed(source)&&
        (!previous||previous.url!==source.url||previous.nodeId!==source.nodeId||now-previous.checkedAt>=(previous.status==='empty'||previous.status==='ready'&&(previous.available??0)<=PREKEY_LOW?5000:30000));
    }).slice(0,2);
    for(const peer of peers){
      const source=this.port.state().bundles[peer]!.body.keySource!,epoch=this.stockEpoch.get(peer)??0;
      const stillCurrent=()=>this.active&&this.port.chats().byPeer[peer]?.contact==='accepted'&&
        this.port.state().bundles[peer]?.body.keySource?.url===source.url&&this.port.state().bundles[peer]?.body.keySource?.nodeId===source.nodeId&&
        (this.stockEpoch.get(peer)??0)===epoch;
      const work=(async()=>{
        try{
          const value=await this.requestAt(source,'/prekeys/availability',{owner:peer});
          if(value.protocol!==COURIER_PREKEY_PROTOCOL||!Number.isInteger(value.available)||value.available<0||value.available>PREKEY_TARGET)throw Error('invalid_prekey_status');
          if(stillCurrent())this.keyStocks[peer]={...source,available:value.available,status:value.available?'ready':'empty',checkedAt:Date.now()};
        }catch{if(stillCurrent())this.keyStocks[peer]={...source,status:'unavailable',checkedAt:Date.now()};}
        if(stillCurrent())this.report(this.health.connection);
      })().finally(()=>{this.stockPolls.delete(peer);});
      this.stockPolls.set(peer,work);
    }
  }
  private async replenishPrekeys(summary:unknown){
    const node=this.port.state().node;if(!node||!this.prekeysSupported)return;
    const now=Date.now();
    const ready=new Map<string,number>();
    if(Array.isArray(summary)&&summary.length<=50)for(const item of summary){
      if(item&&typeof item.peer==='string'&&Number.isInteger(item.available)&&item.available>=0&&item.available<=PREKEY_TARGET)ready.set(item.peer,item.available);
    }
    const urgent=(peer:string)=>(ready.get(peer)??PREKEY_TARGET)>PREKEY_LOW?0:1;
    let revoked=0;
    for(const peer of new Set(this.port.state().keys.filter(k=>k.directory?.nodeId===node.nodeId).map(k=>k.peer))){
      if(this.port.chats().byPeer[peer]?.contact==='accepted'){this.prekeysRevoked.delete(peer);continue;}
      if(revoked>=2)break;
      if(!this.prekeysRevoked.has(peer)&&now-(this.prekeysRevokeChecked.get(peer)??0)>=30000){
        this.prekeysRevokeChecked.set(peer,now);revoked++;
        try{await this.request('/prekeys/revoke',{peer});this.prekeysRevoked.add(peer);}catch{this.current();}
      }
    }
    const peers=this.port.chats().order.filter(p=>p!==this.port.address&&this.port.chats().byPeer[p]?.contact==='accepted'&&
      now-(this.prekeysChecked.get(p)??0)>=(urgent(p)?5000:30000)).sort((a,b)=>urgent(b)-urgent(a)||(this.prekeysChecked.get(a)??0)-(this.prekeysChecked.get(b)??0)).slice(0,2);
    for(const peer of peers){
      this.prekeysChecked.set(peer,now);
      try{
        const status=await this.request('/prekeys/status',{peer});
        const ids=(value:unknown,max:number):value is string[]=>Array.isArray(value)&&value.length<=max&&value.every(id=>typeof id==='string'&&/^[a-f0-9]{32}$/.test(id))&&new Set(value).size===value.length;
        if(status.protocol!==COURIER_PREKEY_PROTOCOL||!ids(status.available,PREKEY_TARGET)||!ids(status.known,MAX_DIRECTORY_KEYS)||
          status.available.some((id:string)=>!status.known.includes(id)))throw Error('invalid_prekey_status');
        let local=this.port.state().keys.filter(k=>k.peer===peer&&k.directory?.nodeId===node.nodeId&&k.directory.url===node.url&&
          (k.publishUntil??0)>now+3600000);
        const keep=local.filter(k=>status.available.includes(k.id)).map(k=>k.id);
        if(keep.length>PREKEY_LOW&&keep.length===status.available.length)continue;
        // If a node lost its directory (or restored an older backup), a missing
        // key might already have been allocated. Always create fresh additions;
        // never republish an old private key just because the node forgot it.
        const target=Number.isInteger(status.capacity)&&status.capacity>=0&&status.capacity<=PREKEY_TARGET?status.capacity:PREKEY_TARGET;
        const count=Math.max(0,target-keep.length),extra=[];
        if(count){
          const keys=this.port.state().keys;
          if(keys.length+count>MAX_PRIVATE_COURIER_KEYS)continue;
          for(let n=0;n<count;n++){extra.push(await generateCourierKey(peer,now+COURIER_TTL,{retainUntil:now+2*COURIER_TTL,directory:{url:node.url,nodeId:node.nodeId},issuedAt:now}));this.current();}
          this.update({...this.port.state(),version:this.port.state().version===3?3:2,keys:[...keys,...extra]});
          try{await this.persist();}catch(error){this.current();const ids=new Set(extra.map(k=>k.id));
            this.update({...this.port.state(),keys:this.port.state().keys.filter(k=>!ids.has(k.id))});throw error;}
        }
        if(!count&&keep.length===status.available.length)continue;
        await this.persist();
        const keys:PrekeyCertificate[]=[];
        for(const k of extra)keys.push(await signCourier('prekey',{protocol:COURIER_PREKEY_PROTOCOL,from:this.port.address,to:peer,id:k.id,publicKey:k.publicKey,
          issuedAt:k.issuedAt!,acceptUntil:k.publishUntil!,retainUntil:k.expiresAt,deliveryTtlMs:COURIER_TTL,node:{url:node.url,nodeId:node.nodeId}},this.port.identity));
        const route=await this.advertisedRoute(peer,now+COURIER_TTL);
        this.current();await this.request('/prekeys/publish',{peer,keep,keys,...(route?{route}:{})});
      }catch(error){this.current();if(error instanceof Error&&error.message==='courier_not_saved')throw error;
        // Directory maintenance is optional: a failure cannot block direct
        // transport or an envelope already reserved with a valid cached key.
      }
    }
  }
  poll() { return this.serial(async () => {
    for (const job of [...this.port.state().pending]) if (this.port.chats().byPeer[job.body.to]?.messages.some(m => m.id === job.body.id && (m.nodeQueue === 'canceling' || job.body.attachment && m.fileStatus === 'canceled'))) {
      try { await this.cancelStoredFile(job); } catch { this.current(); }
    }
    const s = this.port.state(); const now = Date.now();
    this.update({ ...s, keys: s.keys.filter(k => k.expiresAt > now), acks: s.acks.filter(a => a.expiresAt > now),
      used: Object.fromEntries(Object.entries(s.used).filter(([, e]) => e > now)),
      pending: s.pending.filter(j => { const c = this.port.chats().byPeer[j.body.to]; const m = c?.messages.find(m => m.id === j.body.id);
        return c?.contact === 'accepted' && !!m; }) });
    this.update({ ...this.port.state(), outgoingFiles: Object.fromEntries(Object.entries(this.port.state().outgoingFiles).filter(([id]) => this.port.state().pending.some(j => j.body.id === id))) });
    for (const id of this.uploaded) if (!this.port.state().pending.some(j => j.body.id === id)) this.uploaded.delete(id);
    for(const [id,{peer}] of this.activities)if(!this.port.state().pending.some(j=>j.body.id===id))this.activity(peer,id,undefined);
    this.refreshRemoteInboxes();
    for(const r of this.port.state().incomingFiles)if(r.source&&this.sourceAllowed(r.source))this.fileReplies.set(r.job.body.id,this.httpReply(r.source));
    if (!this.port.state().node) { await this.downloadFiles(); this.report('idle', 'disabled'); return; }
    const health = await this.request('/outbox/status', {});
    if (health.address !== this.port.state().node!.address) throw new Error('courier_identity_changed');
    this.health.queue=readQueueSnapshot(health);
    this.report('connected',health.routes?.localInternet==='connected'?'connected':health.routes?.internet??health.status??'connecting',health.routes?.lan);
    this.releaseDeliveredCopies(health.inventoryProtocol==='automesh-outbox-inventory-v1');
    this.port.usage?.((health.bytes ?? 0) + (health.attachments?.bytes ?? 0),health.attachments?.files ?? 0);
    await this.pollReceipts();
    if (health.queueLifecycle === 'automesh-queue-v1') await this.pollOutcomes();
    if (health.queueLifecycle !== 'automesh-queue-v1') for (const job of [...this.port.state().pending]) if (job.body.expiresAt <= Date.now()) await this.finishQueue(job,'expired');
    this.prekeysSupported=health.prekeyProtocol===COURIER_PREKEY_PROTOCOL;
    this.routeNode = health.signalingEnabled === true || health.routes?.localInternet && health.routes.localInternet !== 'disabled' ? this.port.state().node!.address : '';
    if (!this.port.lanOnly?.() && health.routingProtocol === COURIER_ROUTE_PROTOCOL) {
      let synced = 0;
      for (const [peer,bundle] of Object.entries(this.port.state().bundles)) {
        const route = bundle.body.route;
        if (!route || this.port.chats().byPeer[peer]?.contact !== 'accepted' || route.body.expiresAt <= Date.now()) continue;
        const stamp = JSON.stringify(route);
        if (this.syncedRoutes.get(peer) === stamp) continue;
        try {
          const result = await this.request('/outbox/route', { route });
          if (result.protocol !== COURIER_ROUTE_PROTOCOL) throw new Error('invalid_courier_route');
          this.syncedRoutes.set(peer,stamp);
        } catch { this.current(); /* Optional route refresh must not gate delivery. */ }
        if (++synced >= 2) break;
      }
    }
    const lanOnly = this.port.lanOnly?.() === true;
    if (lanOnly && (!health.deliveryScopes || !health.lanEnabled)) {
      this.report('connected', health.routes?.localInternet === 'connected' ? 'connected' : health.routes?.internet ?? health.status ?? 'connecting', health.routes?.lan);
      this.port.error('Для режима «Только LAN» обновите ноду и включите LAN-сигналинг. Конверты не отправлены.'); return;
    }
    this.inboxSupported = health.inboxProtocol === 'automesh-inbox-v1';
    this.trace({ inboxSupported: this.inboxSupported });
    if (this.inboxSupported) {
      try {
        const result = await this.request('/inbox/list', { cursor: this.inboxCursor });
        if (result.protocol !== 'automesh-inbox-v1' || !Array.isArray(result.deliveries) || result.deliveries.length > 8 ||
            typeof result.cursor !== 'string' || (result.cursor !== '' && !/^[a-f0-9]{32}$/.test(result.cursor))) throw new Error('invalid_courier_inbox');
        this.inboxCursor = result.cursor;
        this.trace({ inboxAt: Date.now(), inboxFailure: '' });
        for (const data of result.deliveries) {
          try {
            if (data?.from !== this.port.state().node!.address) throw new Error('courier_identity_changed');
            await this.acceptDelivery(data, this.httpReply());
          } catch (error) {
            this.current(); this.trace({ failure: deliveryFailure(error) });
            if (error instanceof Error && error.message === 'courier_not_saved') throw error;
          }
        }
        if (this.inboxCursor) this.wake();
      } catch (error) {
        this.current(); this.trace({ inboxFailure: 'Не удалось проверить входящую очередь. Повторим автоматически.' });
        if (error instanceof Error && error.message === 'courier_not_saved') throw error;
      }
      // Durable partial files do not need another WebSocket push after unlock.
      for (const r of this.port.state().incomingFiles)
        if (r.job.body.courier === this.port.state().node!.address) this.fileReplies.set(r.job.body.id, this.httpReply());
    }
    await this.downloadFiles();
    await this.replenishPrekeys(health.prekeyPeers);
    this.refreshKeyStocks();
    let count = 0; let keyWait = false; let fileWait = false;let sourceFailures=0;
    const eligible = (m: import('$lib/chat/session-chats').ChatEntry) => !m.radioDelivery && !m.nodeQueue && !m.restoredFromBackup && !m.deviceMessage && m.direction === 'outgoing' && (m.file
      ? !m.fileDeleted && !['ready', 'rejected', 'canceled'].includes(m.fileStatus ?? '') && !!this.port.files
      : ['queued', 'sent', 'stored'].includes(m.delivery ?? ''));
    // Authorization and file uploads await external work. Re-read user intent
    // and direct receipts afterwards rather than uploading a captured snapshot.
    // Skip stale reservations without recycling their one-time encryption keys.
    const uploadable = (job: CourierJob) => {
      const c = this.port.chats().byPeer[job.body.to];
      const m = c?.messages.find(m => m.id === job.body.id);
      return c?.contact === 'accepted' && !!m && eligible(m) && !!m.file === !!job.body.attachment;
    };
    for (const peer of this.port.state().enabled ? this.port.chats().order : []) {
      const c = this.port.chats().byPeer[peer]; const bundle = this.port.state().bundles[peer];
      if (peer === this.port.address) continue;
      const routeReady = (m: import('$lib/chat/session-chats').ChatEntry) => c.connection !== 'connected' || !m.file && m.directFallback === true;
      const unreserved = c.messages.filter(m => eligible(m) && routeReady(m) &&
        !this.port.state().pending.some(j => j.body.id === m.id));
      if (!unreserved.length) continue;
      const issue = (code: DeliveryIssue, error?: unknown) => { for (const m of unreserved) this.port.issue?.(peer,m.id,code,error); };
      if (c.contact !== 'accepted') { if (c.contact === 'outgoing' || c.contact === 'new') issue('contact_connecting'); continue; }
      try { await this.port.authorize?.(peer); this.current(); } catch(error) { this.current(); issue(deliveryIssueForError(error,'primary_policy_invalid'),error); continue; }
      if (!bundle) { keyWait = true; issue('keys_missing'); continue; }
      try { validateCourierBundle(bundle, peer, this.port.address,true); await verifyCourier(bundle, 'prekeys', peer); } catch { keyWait = true; issue('keys_missing'); continue; }
      this.current();
      for (const m of c.messages.filter(m => eligible(m) && routeReady(m))) {
        const s = this.port.state(); if (s.pending.some(j => j.body.id === m.id)) continue;
        if (m.file && (health.fileQueue?.protocol !== ATTACHMENT_PROTOCOL || bundle.body.attachmentProtocol !== ATTACHMENT_PROTOCOL ||
            m.file.size > Math.min(FILE_POLICY_BYTES, health.fileQueue?.maxFileBytes ?? 0, bundle.body.maxFileBytes ?? 0) || Object.keys(s.outgoingFiles).length >= 16)) { fileWait = true; continue; }
        if (count >= 10 || s.pending.length >= 100 || Object.keys(s.used).length >= 4096) break;
        const cached=bundle.body.expiresAt>Date.now()?bundle.body.keys.filter(k=>!s.used[k.id]):[];
        let allocation:PrekeyAllocation|undefined;
        let allocationFailure:unknown;
        const source=bundle.body.keySource;
        if(source&&!this.sourceAllowed(source))allocationFailure=new Error('prekey_source_not_approved');
        if(cached.length<=PREKEY_LOW&&source&&this.sourceAllowed(source)&&sourceFailures<2&&Date.now()>=(this.keySourceRetryAt.get(peer)?.at??0)){
          try{
            const value=await this.requestAt(source,'/prekeys/allocate',{owner:peer,reservation:m.id});
            validateAllocation(value,peer,this.port.address,m.id);
            if(value.key.body.node.nodeId!==source.nodeId||value.key.body.node.url!==source.url)throw Error('invalid_prekey_allocation');
            await verifyCourier(value.key,'prekey',peer);this.current();
            if(this.port.state().used[value.key.body.id])throw Error('prekey_already_used');
            allocation=value;this.keySourceRetryAt.delete(peer);
            if(value.route&&health.routingProtocol===COURIER_ROUTE_PROTOCOL&&!lanOnly)try{
              validateCourierRoute(value.route,peer,this.port.address);await verifyCourier(value.route,'route',peer);this.current();
              const stamp=JSON.stringify(value.route);
              if(this.syncedRoutes.get(peer)!==stamp){await this.request('/outbox/route',{route:value.route});this.syncedRoutes.set(peer,stamp);}
            }catch{this.current();} // Existing optional route update never gates delivery.
          }catch(error){this.current();if(error instanceof Error&&error.message==='courier_not_saved')throw error;
            allocationFailure=error;sourceFailures++;
            this.keySourceRetryAt.set(peer,{at:Date.now()+(error instanceof Error&&error.message==='prekeys_unavailable'?5000:15000),issue:keyLookupIssue(error)});}
        }
        const k=allocation?.key.body??cached[0];
        if (!k) { keyWait = true;
          const reason=allocationFailure?keyLookupIssue(allocationFailure):this.keySourceRetryAt.get(peer)?.issue??(bundle.body.expiresAt<=Date.now()?'keys_expired':'keys_exhausted');
          issue(reason,allocationFailure);break; }
        let manifest;
        this.activity(peer,m.id,'preparing');
        if (m.file) {
          const bytes = await this.port.files!.load(peer, m.id); this.current();
          if (!bytes) { this.activity(peer,m.id,undefined);fileWait = true; continue; }
          try { manifest = await createAttachmentManifest(m.file, bytes, this.port.address, peer); } finally { bytes.fill(0); }
          this.current();
        }
        const content=manifest ? manifestContent(manifest) : encodeChatContent(m.text, m.details);
        const job = allocation?await createAllocatedCourierJob(this.port.identity,this.port.address,s.node!.address,peer,allocation,m.id,m.timestamp,content,lanOnly,manifest?.attachment)
          :await createCourierJob(this.port.identity, this.port.address, s.node!.address, bundle, k, m.id, m.timestamp,content, lanOnly, manifest?.attachment);
        this.current(); const latest = this.port.chats().byPeer[peer]?.messages.find(v => v.id === m.id);
        if (!latest || latest.delivery === 'delivered' || latest.delivery === 'read') {this.activity(peer,m.id,undefined);continue;}
        this.update({ ...this.port.state(), used: { ...this.port.state().used, [k.id]: (allocation?.key.body.retainUntil??job.body.expiresAt) + 86400000 }, pending: [...this.port.state().pending, job],
          outgoingFiles: { ...this.port.state().outgoingFiles, ...(manifest ? { [m.id]: manifest } : {}) } });
        await this.persist(); if(allocation){delete this.keyStocks[peer];this.stockEpoch.set(peer,(this.stockEpoch.get(peer)??0)+1);} count++;
      }
    }
    // Reserve AND durably commit before sending, within this pass (no extra timer).
    await this.persist();
    if (this.health.connection !== 'connected') this.report('checking');
    this.report('connected', health.routes?.localInternet === 'connected' ? 'connected' : health.routes?.internet ?? health.status ?? 'connecting', health.routes?.lan);
    const waiting = this.port.state().pending.filter(j => j.body.expiresAt > Date.now() && !this.uploaded.has(j.body.id) && (!lanOnly || j.body.lanOnly) &&
      (!j.body.attachment || this.port.chats().byPeer[j.body.to]?.messages.some(m => m.id === j.body.id && m.fileStatus !== 'canceled' && !m.fileDeleted)));
    const offset = waiting.length ? this.uploadOffset % waiting.length : 0;
    const batch = [...waiting.slice(offset), ...waiting.slice(0, offset)].slice(0, 20);
    this.uploadOffset = offset + batch.length;
    let failed = false; let fileUploads = 0;
    for (const job of batch) {
      if (this.port.lanOnly?.() && !job.body.lanOnly) continue;
      if (!uploadable(job)) {this.activity(job.body.to,job.body.id,undefined);continue;}
      try { await this.port.authorize?.(job.body.to); this.current(); }
      catch(error) { this.current();this.activity(job.body.to,job.body.id,'retrying'); this.port.issue?.(job.body.to,job.body.id,deliveryIssueForError(error,'primary_policy_invalid'),error); continue; }
      if (!uploadable(job)) continue;
      try {
        if(!this.activities.has(job.body.id))this.activity(job.body.to,job.body.id,'preparing');
        if (job.body.attachment) {
          if (fileUploads++ >= 1) { this.wake(); continue; }
          if (health.fileQueue?.protocol !== ATTACHMENT_PROTOCOL) { fileWait = true; continue; }
          if (!await this.uploadFile(job)) { this.wake(); continue; }
          if (!uploadable(job)) continue;
        }
        const result = await this.request('/outbox/put', { job });
        if (['canceled','expired'].includes(result.status)) { await this.finishQueue(job,result.status); continue; }
        if (!['stored', 'acknowledged'].includes(result.status)) throw new Error('invalid_courier_store');
        this.activity(job.body.to,job.body.id,undefined);
        this.port.issue?.(job.body.to,job.body.id,undefined);
        this.port.delivery(job.body.to, job.body.id, 'stored');
        await this.persist(); this.uploaded.add(job.body.id);
        this.report('connected');
      } catch (error) { this.current(); failed = true;
        this.activity(job.body.to,job.body.id,'retrying');
        if (!uploadable(job)) continue;
        const reason = deliveryIssueForError(error,'node_unavailable');
        this.port.issue?.(job.body.to,job.body.id,reason,error); this.port.error(deliveryIssueText(reason,error));
        if (error instanceof TypeError || (error instanceof Error && error.name === 'AbortError') ||
            (error instanceof Error && error.message === 'courier_not_saved')) throw error;
      }
    }
    await this.pollReceipts();
    this.refreshKeyStocks();
    if(this.quotaDirty){this.quotaDirty=false;try{const latest=await this.request('/outbox/status',{});if(latest.address===this.port.state().node?.address)this.health.queue=readQueueSnapshot(latest);}catch{this.current();}}
    this.report('connected');
    if (!failed) {
      this.port.error(lanOnly && this.port.state().pending.some(j => !j.body.lanOnly && !this.uploaded.has(j.body.id))
        ? 'Ранее подготовленные интернет-конверты не загружаются в режиме «Только LAN». Уже сохранённая на ноде очередь не отзывается.'
        : keyWait ? 'Для части сообщений нет свободных ключей. Пробуем получить новый запас через ноду собеседника, если он опубликован. Прямое соединение также обновляет ключи; сообщения остаются в клиенте.'
        : fileWait ? 'Файлы остаются на устройстве: обновите ноду и клиент собеседника, соединитесь напрямую для обновления ключей и проверьте лимиты.' : '');
      if (count === 10 || waiting.length > batch.length) this.wake();
    }
  }); }
  receive(data: CourierDelivery, reply: CourierReply) { return this.serial(() => this.acceptDelivery(data, reply))
    .catch(error => { this.trace({ failure: deliveryFailure(error) }); throw error; }); }
  private async acceptDelivery(data: CourierDelivery, reply: CourierReply) {
    const { job, hop } = data; validateCourierJob(job, data.from);
    if (job.body.to !== this.port.address || this.port.chats().byPeer[job.body.from]?.contact !== 'accepted') return;
    await verifyCourier(job, 'job', job.body.from); this.current();
    const digest = await cipherDigest(job.body.packet);
    if (hop?.body?.protocol !== COURIER_PROTOCOL || hop.body.id !== job.body.id || hop.body.courier !== data.from || hop.body.digest !== digest) throw new Error('invalid_courier_hop');
    await verifyCourier(hop, 'hop', data.from); this.current();
    this.trace({ envelopeAt: Date.now() });
    const ack = this.port.state().acks.find(a => a.id === job.body.id);
    if (ack) {
      if (ack.digest !== digest || ack.sender !== job.body.from) throw new Error('courier_replay_conflict');
      await this.persist(); this.port.error(''); await reply(ack.id.replaceAll('-', ''), ack.receipt); this.current();
      this.fileReplies.delete(job.body.id);
      if (job.body.attachment && this.port.files) {
        try { await this.port.files.cleanup(job.body.from, job.body.id, job.body.attachment.chunks); this.current(); } catch { this.current(); }
      }
      this.trace({ savedAt: Date.now(), receiptAt: Date.now(), failure: '' }); return;
    }
    if (job.body.attachment && !reply.chunk) throw new Error('attachment_relay_update_required');
    const pendingFile = this.port.state().incomingFiles.find(r => r.job.body.id === job.body.id);
    if (pendingFile) {
      if (pendingFile.job.body.packet !== job.body.packet || pendingFile.job.body.from !== job.body.from || JSON.stringify(pendingFile.job.body.attachment) !== JSON.stringify(job.body.attachment)) throw new Error('courier_replay_conflict');
      if(reply.source)pendingFile.source=reply.source;
      this.fileReplies.set(job.body.id, reply); await this.persist(); return;
    }
    const raw: CourierPacket = JSON.parse(new TextDecoder().decode(unbase64(job.body.packet)));
    const key = this.port.state().keys.find(k => k.id === raw.body?.keyId);
    if (!key || this.port.state().acks.length >= 2000) throw new Error('courier_key_unavailable');
    const packet = await openCourier(job, hop, key, this.port.address); this.current();
    if (job.body.attachment) {
      const prefix = packet.content.startsWith(EPHEMERAL_FILE_PREFIX) ? EPHEMERAL_FILE_PREFIX : FILE_CONTENT_PREFIX;
      if (!this.port.files || !packet.content.startsWith(prefix) || this.port.state().incomingFiles.length >= 16) throw new Error('invalid_attachment_manifest');
      const manifest = validateManifest(JSON.parse(packet.content.slice(prefix.length)), job.body.from, this.port.address, job.body.id);
      if ((prefix === EPHEMERAL_FILE_PREFIX) !== !!manifest.offer.details?.ephemeral) throw new Error('invalid_attachment_manifest');
      if (JSON.stringify(manifest.attachment) !== JSON.stringify(job.body.attachment)) throw new Error('invalid_attachment_manifest');
      this.port.files.offer(job.body.from, manifest.offer, packet.body.timestamp, data.from);
      this.update({ ...this.port.state(), keys: this.port.state().keys.filter(k => k.id !== key.id),
        incomingFiles: [...this.port.state().incomingFiles, { job, hop, manifest, nextIndex: 0,...reply.source?{source:reply.source}:{} }] });
      await this.persist(); this.fileReplies.set(job.body.id, reply); this.wake(); return;
    }
    const content = decodeChatContent(packet.content); if (!content) throw new Error('invalid_courier_content');
    const receipt = JSON.stringify(await signCourier('receipt', { protocol: COURIER_PROTOCOL, from: this.port.address, to: job.body.from,
      id: job.body.id, digest }, this.port.identity)); this.current();
    this.port.receive({ ...content, id: packet.body.id, from: packet.body.from, timestamp: packet.body.timestamp, verified: true, via: 'courier', courierVia: data.from });
    this.update({ ...this.port.state(), keys: this.port.state().keys.filter(k => k.id !== key.id),
      acks: [...this.port.state().acks, { id: job.body.id, sender: job.body.from, digest, receipt, expiresAt: job.body.expiresAt }] });
    await this.persist(); // Commit message, consumed key and receipt together before acknowledgement.
    this.trace({ savedAt: Date.now(), failure: '' });
    this.port.error('');
    await reply(job.body.id.replaceAll('-', ''), receipt); this.current();
    this.trace({ receiptAt: Date.now() });
  }
  private httpReply(source?:QueueSource): CourierReply {
    const parts = new Map<number, Uint8Array>(); let attachmentId = '';
    const request=(path:string,value:Record<string,unknown>)=>source?this.requestAt(source,path.replace('/inbox/','/receive/'),{...value,grant:source.grant},true):this.request(path,value);
    return Object.assign(async (id: string, receipt: string) => {
      const result = await request('/inbox/ack', { id, receipt });
      if (result.acknowledged !== true) throw new Error('invalid_courier_receipt');
    }, { pull: true,...source?{source}:{}, chunk: async (proof: Parameters<NonNullable<CourierReply['chunk']>>[0], signal: AbortSignal) => {
      this.current(); if (signal.aborted) throw new Error('courier_session_closed');
      const { id, index } = proof.body;
      if (attachmentId !== id) { parts.clear(); attachmentId = id; }
      if (!parts.has(index)) {
        parts.clear();
        const result = await request('/inbox/file/parts', { request:proof });
        if (result.id !== id || !Array.isArray(result.parts) || result.parts.length < 1 || result.parts.length > 4) throw new Error('invalid_attachment_part');
        for (let n = 0; n < result.parts.length; n++) {
          const part = result.parts[n];
          if (part.index !== index + n || typeof part.cipher !== 'string' || part.cipher.length > 43720) throw new Error('invalid_attachment_part');
          const cipher = unbase64(part.cipher);
          if (cipher.length < 16 || cipher.length > 32768 + 16) throw new Error('invalid_attachment_part');
          parts.set(part.index, cipher);
        }
      }
      const cipher = parts.get(index)!; parts.delete(index); return cipher;
    } });
  }
  // Independent recipient pulls require the accepted sender's explicit signed
  // capability. They neither register this recipient as a member nor choose
  // this server for its outgoing messages. Private URLs keep the usual policy.
  private refreshRemoteInboxes(){
    const sources=new Map<string,QueueSource>();
    for(const [peer,bundle]of Object.entries(this.port.state().bundles)){
      const source=bundle.body.senderQueue;
      if(!source||source.grant.body.expiresAt<=Date.now()||this.port.chats().byPeer[peer]?.contact!=='accepted'||!this.sourceAllowed(source))continue;
      const own=this.port.state().node;
      if(own?.url===source.url&&own.nodeId===source.nodeId&&own.address===source.address)continue;
      sources.set(source.url+'|'+source.nodeId+'|'+peer,source);
    }
    for(const key of this.remoteInbox.keys())if(!sources.has(key)&&!this.remotePolls.has(key))this.remoteInbox.delete(key);
    if((this.diagnostic.remoteInboxSources??0)!==sources.size||!sources.size&&this.diagnostic.remoteInboxFailure)
      this.trace({remoteInboxSources:sources.size,...(!sources.size?{remoteInboxFailure:''}:{})});
    const entries=[...sources],offset=entries.length?this.remoteOffset%entries.length:0;this.remoteOffset=offset+2;
    for(const [key,source]of [...entries.slice(offset),...entries.slice(0,offset)].slice(0,2)){
      if(this.remotePolls.size>=2)break;
      if(this.remotePolls.has(key)||Date.now()-(this.remoteInbox.get(key)?.at??0)<5000)continue;
      const previous=this.remoteInbox.get(key);this.remoteInbox.set(key,{at:Date.now(),cursor:previous?.cursor??''});
      const task=(async()=>{
        const result=await this.requestAt(source,'/receive/list',{cursor:previous?.cursor??'',grant:source.grant},true);this.current();
        if(result.protocol!=='automesh-inbox-v1'||!Array.isArray(result.deliveries)||result.deliveries.length>8||typeof result.cursor!=='string'||result.cursor!==''&&!/^[a-f0-9]{32}$/.test(result.cursor))throw Error('invalid_courier_inbox');
        let rejected=0,reason='';
        for(const data of result.deliveries){
          try{
            if(data?.from!==source.address||data.job?.body?.from!==source.grant.body.from)throw Error('courier_identity_changed');
            await this.receive(data,this.httpReply(source));
          }catch(error){this.current();rejected++;reason ||= deliveryFailure(error);}
        }
        // A failed save/verification MUST retain the previous page cursor.
        // Successful entries have their own durable receipts; retrying the page
        // neither loses the failed entry nor acknowledges it prematurely.
        this.remoteInbox.set(key,{at:Date.now(),cursor:rejected?previous?.cursor??'':result.cursor});
        this.trace({remoteInboxAt:Date.now(),remoteInboxFailure:rejected?`Не принято конвертов: ${rejected}. ${reason}`:''});
        if(result.deliveries.length||result.cursor)this.wake();
      })().catch(error=>{if(this.active)this.trace({remoteInboxFailure:`Не удалось получить очередь ноды собеседника. ${deliveryFailure(error)}`});})
        .finally(()=>this.remotePolls.delete(key));
      this.remotePolls.set(key,task);
    }
  }
  private async uploadFile(job: CourierJob): Promise<boolean> {
    const m = this.port.state().outgoingFiles[job.body.id], io = this.port.files;
    if (!m || !io) throw new Error('attachment_source_missing');
    const status = await this.request('/outbox/file/start', { job });
    if (['canceled','expired'].includes(status.status)) { await this.finishQueue(job,status.status); return false; }
    if (status.acknowledged || status.complete) {this.activity(job.body.to,job.body.id,'uploading');this.port.issue?.(job.body.to,job.body.id,undefined);io.progress(job.body.to,job.body.id,m.offer.size,true);return true;}
    if (!Array.isArray(status.received) || status.received.length > m.attachment.chunks || status.received.some((i: number) => !Number.isSafeInteger(i) || i < 0 || i >= m.attachment.chunks)) throw new Error('invalid_attachment_status');
    const received = new Set<number>(status.received), missing = Array.from({ length: m.attachment.chunks }, (_, i) => i).filter(i => !received.has(i));
    this.activity(job.body.to,job.body.id,'uploading');
    this.port.issue?.(job.body.to,job.body.id,undefined);this.port.error('');
    io.progress(job.body.to,job.body.id,Math.min(m.offer.size,received.size*m.attachment.chunkBytes),true);
    const bytes = await io.load(job.body.to, job.body.id); this.current();
    if (!bytes) throw new Error('attachment_source_missing');
    try {
      if (bytes.length !== m.offer.size || await attachmentHash(bytes) !== m.offer.sha256) throw new Error('attachment_source_changed');
      this.current();
      for (const index of missing.slice(0, 8)) {
        if (this.port.chats().byPeer[job.body.to]?.messages.some(m => m.id === job.body.id && (m.fileStatus === 'canceled' || m.fileDeleted))) return false;
        const cipher = await encryptAttachmentPart(m, index, bytes.subarray(index * m.attachment.chunkBytes, Math.min(bytes.length, (index + 1) * m.attachment.chunkBytes))); this.current();
        const result = await this.request('/outbox/file/part', { id: m.attachment.id, index, cipher: base64(cipher) });
        if (result.stored !== index) throw new Error('invalid_attachment_status'); received.add(index);
        io.progress(job.body.to, job.body.id, Math.min(m.offer.size, received.size * m.attachment.chunkBytes), true);
        await this.pace(150);
      }
      await this.persist(); return received.size === m.attachment.chunks;
    } finally { bytes.fill(0); }
  }
  // A direct durable receipt does not acknowledge the node's ciphertext. Use
  // the author's existing signed cancellation instead, and keep retry state
  // until the node confirms cleanup. Optional inventory repairs old forgotten
  // reservations, but never deletes jobs absent from this client's history.
  private releaseDeliveredCopies(inventory:boolean) {
    if(this.cleanupRun||Date.now()<this.outboxScanAt||!this.port.state().node)return;
    this.outboxScanAt=Date.now()+15000;
    const node={...this.port.state().node!};
    const sameNode=()=>this.active&&this.port.state().node?.nodeId===node.nodeId&&this.port.state().node?.url===node.url;
    const received=(job:CourierJob)=>{
      const m=this.port.chats().byPeer[job.body.to]?.messages.find(m=>m.id===job.body.id);
      return !!m&&m.direction==='outgoing'&&!m.restoredFromBackup&&!m.importedFromDevice&&
        (m.file?m.fileStatus==='ready':['delivered','read'].includes(m.delivery??''));
    };
    this.cleanupRun=(async()=>{
      const jobs=new Map(this.port.state().pending.filter(received).map(j=>[j.body.id,j]));
      this.health.cleanup={count:jobs.size,stage:'list',error:this.health.cleanup?.error};
      if(inventory&&jobs.size<2){
        const page=await this.requestAt(node,'/outbox/list',{cursor:this.outboxCursor},true);
        if(!sameNode())return;
        if(page.protocol!=='automesh-outbox-inventory-v1'||!Array.isArray(page.jobs)||page.jobs.length>8||typeof page.cursor!=='string'||page.cursor!==''&&!/^[a-f0-9]{32}$/.test(page.cursor))throw Error('invalid_courier_inventory');
        for(const job of page.jobs){
          this.health.cleanup.stage='verify';
          validateCourierJob(job,node.address,Math.min(Date.now(),(job?.body?.expiresAt??0)-1));
          if(job.body.from!==this.port.address)throw Error('invalid_courier_author');
          await verifyCourier(job,'job',this.port.address);this.current();
          if(received(job))jobs.set(job.body.id,job);
        }
        this.outboxCursor=page.cursor;
      }
      let changed=false;
      for(const job of [...jobs.values()].slice(0,2)){
        if(!sameNode()||!received(job))return;
        this.health.cleanup={count:jobs.size,stage:'cancel',error:this.health.cleanup?.error};
        const result=await this.requestAt(node,'/outbox/cancel',{job},true);
        if(!['canceled','expired','acknowledged'].includes(result.status))throw Error('invalid_courier_outcome');
        await this.serial(async()=>{
          if(!sameNode())return;
          this.health.cleanup={count:jobs.size,stage:'save',error:this.health.cleanup?.error};
          this.update({...this.port.state(),pending:this.port.state().pending.filter(j=>j.body.id!==job.body.id),
            outgoingFiles:Object.fromEntries(Object.entries(this.port.state().outgoingFiles).filter(([id])=>id!==job.body.id))});
          await this.persist();this.uploaded.delete(job.body.id);changed=true;
        });
      }
      if(changed&&sameNode()){
        this.health.cleanup={count:0,stage:'refresh',error:this.health.cleanup?.error};
        const at=Date.now(),health=await this.requestAt(node,'/outbox/status',{},true);
        await this.serial(async()=>{if(sameNode()&&health.address===node.address&&(this.health.queue?.checkedAt??0)<=at){this.health.queue=readQueueSnapshot(health);this.report(this.health.connection);}});
      }
      this.health.cleanup=undefined;this.report(this.health.connection);
    })().catch(error=>{if(sameNode()){this.health.cleanup={count:this.health.cleanup?.count??0,stage:this.health.cleanup?.stage??'list',error:safeDeliveryErrorCode(error)};this.report(this.health.connection);}}).finally(()=>{this.cleanupRun=null;});
  }
  private async pollReceipts() {
    const pending = [...this.port.state().pending];
    for (let i = 0; i < pending.length; i += 50) {
      const jobs = pending.slice(i, i + 50);
      const result = await this.request('/outbox/receipts', { ids: jobs.map(j => j.body.id.replaceAll('-', '')) });
      if (!Array.isArray(result.receipts) || result.receipts.length > jobs.length) throw new Error('invalid_courier_receipts');
      for (const item of result.receipts) {
        const receipt = JSON.parse(item.receipt); const b = receipt?.body;
        const job = jobs.find(j => j.body.id === b?.id);
        if (!job || b.protocol !== COURIER_PROTOCOL || b.from !== job.body.to || b.to !== this.port.address ||
            b.digest !== await cipherDigest(job.body.packet)) throw new Error('invalid_courier_receipt');
        await verifyCourier(receipt, 'receipt', b.from); this.current();
        this.port.delivery(b.from, b.id, 'delivered'); this.uploaded.delete(b.id);
        this.update({ ...this.port.state(), pending: this.port.state().pending.filter(j => j.body.id !== b.id),
          outgoingFiles: Object.fromEntries(Object.entries(this.port.state().outgoingFiles).filter(([id]) => id !== b.id)) });
      }
      await this.persist();
    }
  }
  private async pollOutcomes() {
    const pending = [...this.port.state().pending];
    for (let i=0;i<pending.length;i+=50) {
      const jobs=pending.slice(i,i+50), result=await this.request('/outbox/outcomes',{ids:jobs.map(j=>j.body.id.replaceAll('-',''))});
      if (!Array.isArray(result.outcomes) || result.outcomes.length>jobs.length) throw Error('invalid_courier_outcomes');
      for (const item of result.outcomes) {
        const job=jobs.find(j=>j.body.id.replaceAll('-','')===item.id);
        if (!job || !['canceled','expired'].includes(item.status) || item.digest!==await cipherDigest(base64(new TextEncoder().encode(JSON.stringify(job))))) throw Error('invalid_courier_outcomes');
        this.current(); await this.finishQueue(job,item.status);
      }
      // The node's clock determines its TTL. A fast client clock must not
      // declare deletion while the node is still storing the job.
      if(Number.isSafeInteger(result.checkedAt)&&result.checkedAt>=0) for(const job of jobs)
        if(job.body.expiresAt<=result.checkedAt&&this.port.state().pending.some(j=>j.body.id===job.body.id))await this.finishQueue(job,'expired');
    }
  }
  private async finishQueue(job:CourierJob,status:'canceled'|'expired') {
    this.activity(job.body.to,job.body.id,undefined);
    this.port.outcome?.(job.body.to,job.body.id,status);
    this.update({...this.port.state(),pending:this.port.state().pending.filter(j=>j.body.id!==job.body.id),
      outgoingFiles:Object.fromEntries(Object.entries(this.port.state().outgoingFiles).filter(([id])=>id!==job.body.id))});
    await this.persist(); this.uploaded.delete(job.body.id);
  }
  cancel(id:string) { return this.serial(async()=>{
    const job=this.port.state().pending.find(j=>j.body.id===id);
    if(job) { this.activity(job.body.to,id,undefined);this.port.outcome?.(job.body.to,id,'canceling'); await this.persist(); await this.cancelStoredFile(job); }
  }); }
  cancelFile(id:string) { return this.cancel(id); }
  private async cancelStoredFile(job:CourierJob) {
    const result=await this.request('/outbox/cancel',{job});
    if(result.status==='acknowledged') { await this.pollReceipts(); return; }
    if(!['canceled','expired'].includes(result.status)) throw Error('courier_cancel_failed');
    await this.finishQueue(job,result.status);
  }
  private async downloadFiles() {
    const io = this.port.files; if (!io) return;
    // Each pass is bounded; text, receipts and the other profiles' lifecycle must
    // not sit behind an entire video. Durable local parts survive a browser lock.
    let downloads = 0;
    const pending = [...this.port.state().incomingFiles], offset = pending.length ? this.downloadOffset % pending.length : 0;
    this.downloadOffset = offset + 2;
    for (const r of [...pending.slice(offset), ...pending.slice(0, offset)]) {
      const { job, manifest: m } = r, peer = job.body.from, id = job.body.id;
      if (job.body.expiresAt <= Date.now()) {
        await io.cleanup(peer, id, m.attachment.chunks); this.current();
        this.update({ ...this.port.state(), incomingFiles: this.port.state().incomingFiles.filter(v => v !== r) }); await this.persist(); continue;
      }
      const reply = this.fileReplies.get(id);
      if (!reply?.chunk || !io.accepted(peer, id) || this.port.chats().byPeer[peer]?.contact !== 'accepted') continue;
      if (downloads++ >= 2) { this.wake(); continue; }
      let receiptSent = false, fileCommitted = false;
      try {
      validateCourierJob(job, job.body.courier); validateManifest(m, peer, this.port.address, id);
      if (job.body.to !== this.port.address || r.hop.body.id !== id || r.hop.body.courier !== job.body.courier || r.hop.body.digest !== await cipherDigest(job.body.packet)) throw new Error('invalid_courier_hop');
      if (JSON.stringify(m.attachment) !== JSON.stringify(job.body.attachment)) throw new Error('invalid_attachment_manifest');
      await verifyCourier(job, 'job', peer); await verifyCourier(r.hop, 'hop', job.body.courier); this.current();
      for (let n = 0; n < 8 && r.nextIndex < m.attachment.chunks; n++) {
        if (!io.accepted(peer, id) || this.port.chats().byPeer[peer]?.contact !== 'accepted') break;
        const index = r.nextIndex;
        const request = await signCourier('attachment-request', { protocol: ATTACHMENT_PROTOCOL, from: this.port.address, to: job.body.courier,
          id: m.attachment.id, index, requestId: crypto.randomUUID().replaceAll('-', ''), expiresAt: Date.now() + 30000 }, this.port.identity); this.current();
        const cipher = await reply.chunk(request, this.abort.signal); this.current();
        const plain = await decryptAttachmentPart(m, index, cipher); this.current();
        try { await io.savePart(peer, id, index, plain); } finally { plain.fill(0); } this.current();
        r.nextIndex++;
        io.progress(peer, id, Math.min(m.offer.size, r.nextIndex * m.attachment.chunkBytes), false);
        await this.persist(); await this.pace(reply.pull ? 250 : 75);
      }
      if (r.nextIndex < m.attachment.chunks) { if (io.accepted(peer, id)) this.wake(); continue; }
      const plain = new Uint8Array(m.offer.size); let offset = 0;
      try {
        for (let index = 0; index < m.attachment.chunks; index++) {
          let bytes: Uint8Array | null = null;
          try { bytes = await io.loadPart(peer, id, index); } catch { this.current(); } this.current();
          if (!bytes || bytes.length !== Math.min(m.attachment.chunkBytes, Math.max(0, m.offer.size - offset))) {
            bytes?.fill(0); r.nextIndex = index; await this.persist(); this.wake(); return;
          }
          plain.set(bytes, offset); offset += bytes.length; bytes.fill(0);
        }
        if (await attachmentHash(plain) !== m.offer.sha256) throw new Error('attachment_digest_mismatch'); this.current();
        await io.complete(peer, id, plain); this.current();
        const digest = await cipherDigest(job.body.packet);
        const receipt = JSON.stringify(await signCourier('receipt', { protocol: COURIER_PROTOCOL, from: this.port.address, to: peer, id, digest }, this.port.identity)); this.current();
        if (this.port.state().acks.length >= 2000) throw new Error('courier_ack_limit');
        this.update({ ...this.port.state(), incomingFiles: this.port.state().incomingFiles.filter(v => v.job.body.id !== id),
          acks: [...this.port.state().acks, { id, sender: peer, digest, receipt, expiresAt: job.body.expiresAt }] });
        await this.persist(); fileCommitted = true; this.trace({ savedAt: Date.now(), failure: '' });
        await reply(id.replaceAll('-', ''), receipt); this.current(); receiptSent = true; this.trace({ receiptAt: Date.now() }); this.fileReplies.delete(id);
        await io.cleanup(peer, id, m.attachment.chunks); this.current();
      } finally { plain.fill(0); }
      } catch (error) {
        this.current();
        if(!r.source)this.retryAfter = Date.now() + 5000;
        if (fileCommitted) {
          // The full file and retryable signed receipt are durable already.
          // Losing an ACK response must not leak the temporary chunk cache.
          this.fileReplies.delete(id);
          try { await io.cleanup(peer, id, m.attachment.chunks); this.current(); } catch { this.current(); }
        }
        if (receiptSent) {
          const warning = 'Файл сохранён, подтверждение отправлено в канал. Не удалось убрать временные части из локального хранилища.';
          this.port.error(warning); this.trace({ failure: warning }); continue;
        }
        this.port.error('Получение файла прервалось. Проверенные части сохранены; повторим при подключении.');
        this.trace({ failure: error instanceof Error && error.message === 'courier_not_saved' ? deliveryFailure(error) : 'Получение файла прервалось. Проверенные части сохранены; повторим при подключении. Подтверждение не отправлено.' });
        if (error instanceof Error && error.message === 'courier_not_saved') throw error;
      }
    }
  }
}
