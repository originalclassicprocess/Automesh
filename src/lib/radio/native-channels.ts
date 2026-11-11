import { networkId, networkInvite } from './network';
import type { RadioSnapshot } from './serial-radio';
import type { RadioReception } from './reception';
import { normalizeRadioReception } from './reception';
import { radioBoardName } from './board-name';
import type { RadioChannel } from './network';
import type { ChatEntry } from '$lib/chat/session-chats';
import type { MessageStatus } from '$lib/chat/message-presentation';

export const CHANNEL_TEXT_BYTES=200;
export type ChannelText = {id:number;from:number;channel:number;text:string;name:string;receivedAt:number;replyId?:number;reception?:RadioReception};
export type ChannelFailure={source:'queue'|'routing';code:number};
export type ChannelStatus={id:number;channel:number;status:'accepted'|'mesh'|'failed';failure?:ChannelFailure};
export type ChannelMessage = {id:number;from:number;name:string;text:string;timestamp:number;outgoing:boolean;status:'queued'|'accepted'|'mesh'|'failed'|'unknown';failure?:ChannelFailure;reception?:RadioReception;replyId?:number;retryOf?:number};
export type NativeChannel = {key:string;node:number;index:number;name:string;public:boolean;signature:boolean;unread:number;messages:ChannelMessage[];encryption?:ChannelEncryption;boardName?:string;draft?:string;replyId?:number;deleted?:string[]};
export type NativeChannels = {enabled:boolean;channels:NativeChannel[];configured?:boolean;showAll?:boolean;historyLimit?:number};
export type ChannelEncryption='none'|'default'|'custom'|'unknown';
export const emptyNativeChannels=():NativeChannels=>({enabled:true,channels:[],historyLimit:100});
const validNode=(v:unknown):v is number=>Number.isInteger(v)&&(v as number)>0&&(v as number)<0xffffffff;
const packetId=(v:unknown):v is number=>Number.isInteger(v)&&(v as number)>0&&(v as number)<=0xffffffff;
const textBytes=(v:string)=>new TextEncoder().encode(v).length;
export function normalizeNativeChannels(value:unknown):NativeChannels {
  const result=emptyNativeChannels();if(!value||typeof value!=='object')return result;
  const raw=value as Partial<NativeChannels>;result.enabled=raw.configured===true?raw.enabled===true:true;result.configured=raw.configured===true;result.showAll=raw.showAll===true;result.historyLimit=nativeHistoryLimit(raw.historyLimit);
  if(!Array.isArray(raw.channels))return result;
  for(const c of raw.channels.slice(-32)) {
    if(!c||typeof c.key!=='string'||!/^[a-f0-9]{64}$/.test(c.key)||!validNode(c.node)||!Number.isInteger(c.index)||c.index<0||c.index>7||result.channels.some(p=>p.node===c.node&&p.key===c.key))continue;
    const deleted=Array.isArray(c.deleted)?c.deleted.filter(v=>typeof v==='string'&&/^[0-9]{1,10}:[0-9]{1,10}$/.test(v)).slice(-2000):[];
    const messages:ChannelMessage[]=[];
    if(Array.isArray(c.messages))for(const m of c.messages.slice(-nativeHistoryLimit(result.historyLimit))) {
      if(!m||!Number.isInteger(m.id)||m.id<=0||m.id>0xffffffff||!validNode(m.from)||typeof m.text!=='string'||!m.text.trim()||textBytes(m.text)>512||!Number.isSafeInteger(m.timestamp)||m.timestamp<0||messages.some(p=>p.from===m.from&&p.id===m.id)||deleted.includes(nativeMessageKey(m)))continue;
      const status=m.status==='accepted'||m.status==='failed'||m.status==='mesh'?m.status:'unknown',reception=normalizeRadioReception(m.reception);
      const failure=normalizeChannelFailure(m.failure);
      messages.push({id:m.id,from:m.from,name:radioBoardName(m.name),text:m.text,timestamp:m.timestamp,outgoing:m.outgoing===true,status,...(status==='failed'&&failure?{failure}:{}),...(reception?{reception}:{}),...(packetId(m.replyId)?{replyId:m.replyId}:{}),...(packetId(m.retryOf)?{retryOf:m.retryOf}:{})});
    }
    result.channels.push({key:c.key,node:c.node,index:c.index,name:radioBoardName(c.name),public:c.public===true,signature:c.signature===true,unread:Math.max(0,Math.min(messages.length,Number.isInteger(c.unread)?c.unread:0)),messages:messages.sort((a,b)=>a.timestamp-b.timestamp),encryption:normalizeEncryption(c.encryption),boardName:radioBoardName(c.boardName),draft:typeof c.draft==='string'?c.draft.slice(0,600):'',deleted,...(packetId(c.replyId)?{replyId:c.replyId}:{})});
  }
  return result;
}
export async function syncNativeChannels(state:NativeChannels,snapshot:RadioSnapshot):Promise<NativeChannels> {
  let channels=[...state.channels];
  for(const c of snapshot.channels) {
    const key=await networkId(networkInvite(snapshot.profile,c));
    const previous=channels.find(p=>p.node===snapshot.node&&p.key===key);
    const next:NativeChannel={...previous,key,node:snapshot.node,index:c.index,name:radioBoardName(c.name),public:channelEncryption(c)!=='custom',encryption:channelEncryption(c),boardName:radioBoardName(snapshot.name)||previous?.boardName,signature:previous?.signature??false,unread:previous?.unread??0,messages:previous?.messages??[]};
    channels=channels.filter(p=>p.node!==next.node||p.key!==key);channels.push(next);
  }
  return {...state,channels:channels.slice(-32)};
}
export function channelSignature(link:string):string {
  // Escape destination delimiters, keeping IPv6 host brackets intact.
  const destination=link.replace(/[()\\\s<>"'`]/gu,ch=>Array.from(new TextEncoder().encode(ch),b=>'%'+b.toString(16).padStart(2,'0')).join(''));
  return `[Automesh](${destination})`;
}
export function channelText(text:string,signature:boolean,link:string):string {
  if(!text.trim())throw Error('meshtastic_empty_text');
  const full=text.trim()+(signature?`\n${channelSignature(link)}`:'');
  if(textBytes(full)>CHANNEL_TEXT_BYTES)throw Error('meshtastic_text_too_large');
  return full;
}
export function appendChannelMessage(state:NativeChannels,key:string,node:number,message:ChannelMessage,visible=false):NativeChannels {
  return {...state,channels:state.channels.map(c=>{
    if(c.key!==key||c.node!==node||c.deleted?.includes(nativeMessageKey(message))||c.messages.some(m=>m.from===message.from&&m.id===message.id))return c;
    return {...c,messages:[...c.messages,message].sort((a,b)=>a.timestamp-b.timestamp).slice(-nativeHistoryLimit(state.historyLimit)),unread:visible?0:message.outgoing?c.unread:Math.min(nativeHistoryLimit(state.historyLimit),c.unread+1)};
  })};
}
export function channelMessageStatus(state:NativeChannels,key:string,node:number,id:number,status:ChannelMessage['status'],failure?:ChannelFailure):NativeChannels {
  return {...state,channels:state.channels.map(c=>c.key===key&&c.node===node?{...c,messages:c.messages.map(m=>{
    if(m.id!==id||m.from!==node||!m.outgoing||m.status==='mesh'||m.status==='failed'&&status!=='mesh'||m.status==='accepted'&&(status==='unknown'||status==='failed'&&!failure))return m;
    const {failure:_old,...rest}=m;return {...rest,status,...(failure&&status==='failed'?{failure}:{})};
  })}:c)};
}
function normalizeChannelFailure(v:unknown):ChannelFailure|undefined {
  if(!v||typeof v!=='object')return;
  const f=v as ChannelFailure;
  if((f.source==='queue'||f.source==='routing')&&Number.isInteger(f.code)&&f.code>0&&f.code<=255)return {source:f.source,code:f.code};
}
export function channelFailureLabel(failure?:ChannelFailure):string {
  if(!failure)return 'Нет подтверждения платы';
  const {source,code}=failure;
  // QueueStatus.res uses firmware ERRNO values, not the Routing.Error namespace.
  if(source==='queue'&&code>=32)return code===32?'Очередь платы заполнена':code===33?'Нет радиоинтерфейса':code===34?'Передача на плате выключена':'Плата отклонила отправку';
  return code===1?'Нет маршрута':code===2?'Узел отклонил передачу':code===3?'Истекло ожидание подтверждения сети':code===4?'Нет радиоинтерфейса':code===5?'Прошивка исчерпала повторы':code===6?'Нет подходящего радиоканала':code===7?'Слишком большой радиопакет':code===8?'Нет ответа службы Meshtastic':code===9?'Ограничение времени в эфире':code===38?'Ограничение частоты отправки':'Ошибка маршрутизации Meshtastic';
}

export function nativeHistoryLimit(value:unknown):number {return value===500||value===1000?value:100;}
function normalizeEncryption(value:unknown):ChannelEncryption {return value==='none'||value==='default'||value==='custom'?value:'unknown';}
// Classification only: no channel secret is persisted. Short PSKs and their
// expanded well-known variants provide no private channel membership.
export function channelEncryption(channel:Pick<RadioChannel,'psk'>):ChannelEncryption {
  const p=channel.psk;
  if(!p.length||p.length===1&&p[0]===0)return 'none';
  const known=[0xd4,0xf1,0xbb,0x3a,0x20,0x29,0x07,0x59,0xf0,0xbc,0xff,0xab,0xcf,0x4e,0x69];
  if(p.length===1||p.length===16&&known.every((v,i)=>p[i]===v))return 'default';
  return p.length===16||p.length===32?'custom':'unknown';
}
export const nativeChannelToken=(c:Pick<NativeChannel,'node'|'key'>)=>`${c.node}:${c.key}`;
export const nativeMessageKey=(m:Pick<ChannelMessage,'from'|'id'>)=>`${m.from}:${m.id}`;
export function visibleNativeChannels(state:NativeChannels,node:number|undefined,live:readonly string[],query=''):NativeChannel[] {
  if(!state.enabled)return [];
  const needle=query.trim().toLocaleLowerCase();
  return state.channels.filter(c=>(node!==undefined&&!state.showAll?c.node===node&&live.includes(nativeChannelToken(c)):c.messages.length>0||live.includes(nativeChannelToken(c)))&&
    (!needle||`${c.name} ${c.boardName??''} ${c.node.toString(16)} LoRa Meshtastic`.toLocaleLowerCase().includes(needle)));
}
export function nativeChatEntry(m:ChannelMessage):ChatEntry {
  return {id:nativeMessageKey(m),from:`!${m.from.toString(16).padStart(8,'0')}`,text:m.text,timestamp:m.timestamp,direction:m.outgoing?'outgoing':'incoming'};
}
export function nativeMessageStatus(m:ChannelMessage):MessageStatus {
  const label=m.status==='mesh'?'Доставлено в сеть':m.status==='accepted'?'Передано плате':m.status==='queued'?'Отправляем…':m.status==='failed'?'Доставка в сеть не подтверждена':'Нет подтверждения платы';
  return {icon:m.status==='mesh'?'✓':'◷',label,tone:m.status==='mesh'?'success':m.status==='failed'?'error':'warning',detail:m.failure?channelFailureLabel(m.failure):m.status==='mesh'?
    'Соседний узел подтвердил ретрансляцию. Это не подтверждение всех участников и не прочтение.':m.status==='accepted'?
    'Ваша плата приняла сообщение. Получение участниками канала ещё не подтверждено.':m.status==='queued'?
    'Сообщение передаётся плате. Оставьте приложение открытым.':'Подтверждение не получено. Сообщение могло дойти; ручной повтор может создать копию.'};
}
export function nativeFailureAction(f?:ChannelFailure):'wait'|'connect'|'shorten'|'retry' {
  if(!f)return 'retry';
  if(f.source==='queue'&&f.code===32||f.source==='routing'&&[9,38].includes(f.code))return 'wait';
  if(f.source==='queue'&&[33,34].includes(f.code)||f.source==='routing'&&[4,6].includes(f.code))return 'connect';
  return f.source==='routing'&&f.code===7?'shorten':'retry';
}
export function removeNativeMessages(state:NativeChannels,channel:NativeChannel,ids:readonly string[]):NativeChannels {
  const selected=new Set(ids);
  return {...state,channels:state.channels.map(c=>nativeChannelToken(c)===nativeChannelToken(channel)?{...c,deleted:[...new Set([...(c.deleted??[]),...c.messages.filter(m=>selected.has(nativeMessageKey(m))).map(nativeMessageKey)])].slice(-2000),messages:c.messages.filter(m=>!selected.has(nativeMessageKey(m))),unread:c.unread?c.messages.filter(m=>!m.outgoing).slice(-c.unread).filter(m=>!selected.has(nativeMessageKey(m))).length:0}:c)};
}

// A failed local write must preserve packets received while it was in flight.
export function mergeNativeHistory(previous:NativeChannel,current:NativeChannel,limit:number):ChannelMessage[] {
  const known=new Set(current.messages.map(nativeMessageKey)),deleted=new Set(current.deleted??[]);
  return [...current.messages,...previous.messages.filter(m=>!known.has(nativeMessageKey(m))&&!deleted.has(nativeMessageKey(m)))].sort((a,b)=>a.timestamp-b.timestamp).slice(-limit);
}
