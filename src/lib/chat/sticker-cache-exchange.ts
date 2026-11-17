import{normalizeFileOffer,FILE_UUID_RE,type FileOffer}from'./file-transfer';
import{reusableMedia}from'./media-cache';
export type CachePacket={op:'probe';request:string;offer:FileOffer;timestamp:number}|{op:'hit'|'miss';request:string;id:string};
export function cachePacket(value:unknown):CachePacket|null{
 if(!value||typeof value!=='object'||JSON.stringify(value).length>4096)return null;
 const p=value as Record<string,unknown>;if(typeof p.request!=='string'||!FILE_UUID_RE.test(p.request))return null;
 if(p.op==='probe'){
  const offer=normalizeFileOffer(p.offer);if(!offer||!reusableMedia(offer)||!Number.isSafeInteger(p.timestamp)||Math.abs(Date.now()-(p.timestamp as number))>120000||Object.keys(p).some(k=>!['op','request','offer','timestamp'].includes(k)))return null;
  return {op:'probe',request:p.request,offer,timestamp:p.timestamp as number};
 }
 if(['hit','miss'].includes(p.op as string)&&typeof p.id==='string'&&FILE_UUID_RE.test(p.id)&&Object.keys(p).every(k=>['op','request','id'].includes(k)))return p as CachePacket;
 return null;
}
type Pending={peer:string;id:string;request:string;done:boolean;processing?:boolean;promise:Promise<boolean>;resolve(value:boolean):void;timer:ReturnType<typeof setTimeout>};
export class StickerCacheExchange{
 private pending=new Map<string,Pending>();private attempted=new Set<string>();private lastProbe=new Map<string,number>();private stopped=false;private receiving=0;
 constructor(private port:{current():boolean;accepted(peer:string):boolean;ready(peer:string):boolean;send(peer:string,value:CachePacket):Promise<void>;receive(peer:string,offer:FileOffer,timestamp:number):Promise<boolean>;delivered(peer:string,id:string):Promise<void>}){}
 private live(peer:string){return !this.stopped&&this.port.current()&&this.port.accepted(peer);}
 defer(peer:string,offer:FileOffer):boolean{
  const key=peer+':'+offer.id;
  if(!this.live(peer)||!this.port.ready(peer)||!reusableMedia(offer))return false;
  if(!this.attempted.has(key))void this.probe(peer,offer);
  return !!this.pending.get(key)&&!this.pending.get(key)!.done;
 }
 probe(peer:string,offer:FileOffer):Promise<boolean>{
  const key=peer+':'+offer.id,old=this.pending.get(key);if(old)return old.promise;
  if(!this.live(peer)||!this.port.ready(peer)||!reusableMedia(offer)||this.attempted.has(key)||this.pending.size>=16||this.attempted.size>=2000)return Promise.resolve(false);
  this.attempted.add(key);let resolve!:(value:boolean)=>void;const promise=new Promise<boolean>(r=>resolve=r);
  const item:Pending={peer,id:offer.id,request:crypto.randomUUID(),done:false,promise,resolve,timer:setTimeout(()=>this.finish(key,false),2000)};
  this.pending.set(key,item);
  void this.port.send(peer,{op:'probe',request:item.request,offer,timestamp:Date.now()}).catch(()=>this.finish(key,false));return promise;
 }
 private finish(key:string,value:boolean){const p=this.pending.get(key);if(!p||p.done)return;p.done=true;clearTimeout(p.timer);this.pending.delete(key);p.resolve(value);}
 async receive(peer:string,raw:unknown):Promise<void>{
  if(!this.live(peer))return;const packet=cachePacket(raw);if(!packet)return;
  if(packet.op==='probe'){
   if(this.receiving>=2)return;
   const last=this.lastProbe.get(peer)??0;if(Date.now()-last<100)return;
   if(this.lastProbe.size>=500&&!this.lastProbe.has(peer))return;
   this.lastProbe.set(peer,Date.now());
   this.receiving++;let hit=false;try{hit=await this.port.receive(peer,packet.offer,packet.timestamp);}catch{/* Optional cache cannot gate ordinary delivery. */}finally{this.receiving--;}
   if(this.live(peer))await this.port.send(peer,{op:hit?'hit':'miss',request:packet.request,id:packet.offer.id});return;
  }
  const key=peer+':'+packet.id,p=this.pending.get(key);if(!p||p.processing||p.request!==packet.request)return;
  if(packet.op==='hit'){
   p.processing=true;
   try{await this.port.delivered(peer,p.id);if(this.live(peer))this.finish(key,true);}catch{this.finish(key,false);}
  }else this.finish(key,false);
 }
 close(){this.stopped=true;for(const key of this.pending.keys())this.finish(key,false);this.attempted.clear();this.lastProbe.clear();}
}
