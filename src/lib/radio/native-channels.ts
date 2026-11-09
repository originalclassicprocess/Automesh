import { networkId, networkInvite } from './network';
import type { RadioSnapshot } from './serial-radio';
import type { RadioReception } from './reception';
import { normalizeRadioReception } from './reception';
import { radioBoardName } from './board-name';

export const CHANNEL_TEXT_BYTES=200;
export type ChannelText = {id:number;from:number;channel:number;text:string;name:string;receivedAt:number;reception?:RadioReception};
export type ChannelFailure={source:'queue'|'routing';code:number};
export type ChannelStatus={id:number;channel:number;status:'accepted'|'mesh'|'failed';failure?:ChannelFailure};
export type ChannelMessage = {id:number;from:number;name:string;text:string;timestamp:number;outgoing:boolean;status:'queued'|'accepted'|'mesh'|'failed'|'unknown';failure?:ChannelFailure;reception?:RadioReception};
export type NativeChannel = {key:string;node:number;index:number;name:string;public:boolean;signature:boolean;unread:number;messages:ChannelMessage[]};
export type NativeChannels = {enabled:boolean;channels:NativeChannel[]};
export const emptyNativeChannels=():NativeChannels=>({enabled:false,channels:[]});
const validNode=(v:unknown):v is number=>Number.isInteger(v)&&(v as number)>0&&(v as number)<0xffffffff;
const textBytes=(v:string)=>new TextEncoder().encode(v).length;
export function normalizeNativeChannels(value:unknown):NativeChannels {
  const result=emptyNativeChannels();if(!value||typeof value!=='object')return result;
  const raw=value as Partial<NativeChannels>;result.enabled=raw.enabled===true;
  if(!Array.isArray(raw.channels))return result;
  for(const c of raw.channels.slice(-32)) {
    if(!c||typeof c.key!=='string'||!/^[a-f0-9]{64}$/.test(c.key)||!validNode(c.node)||!Number.isInteger(c.index)||c.index<0||c.index>7||result.channels.some(p=>p.node===c.node&&p.key===c.key))continue;
    const messages:ChannelMessage[]=[];
    if(Array.isArray(c.messages))for(const m of c.messages.slice(-100)) {
      if(!m||!Number.isInteger(m.id)||m.id<=0||m.id>0xffffffff||!validNode(m.from)||typeof m.text!=='string'||!m.text.trim()||textBytes(m.text)>512||!Number.isSafeInteger(m.timestamp)||m.timestamp<0||messages.some(p=>p.from===m.from&&p.id===m.id))continue;
      const status=m.status==='accepted'||m.status==='failed'||m.status==='mesh'?m.status:'unknown',reception=normalizeRadioReception(m.reception);
      const failure=normalizeChannelFailure(m.failure);
      messages.push({id:m.id,from:m.from,name:radioBoardName(m.name),text:m.text,timestamp:m.timestamp,outgoing:m.outgoing===true,status,...(status==='failed'&&failure?{failure}:{}),...(reception?{reception}:{})});
    }
    result.channels.push({key:c.key,node:c.node,index:c.index,name:radioBoardName(c.name),public:c.public===true,signature:c.signature===true,unread:Math.max(0,Math.min(messages.length,Number.isInteger(c.unread)?c.unread:0)),messages});
  }
  return result;
}
export async function syncNativeChannels(state:NativeChannels,snapshot:RadioSnapshot):Promise<NativeChannels> {
  let channels=[...state.channels];
  for(const c of snapshot.channels) {
    const key=await networkId(networkInvite(snapshot.profile,c));
    const previous=channels.find(p=>p.node===snapshot.node&&p.key===key);
    const next:NativeChannel={...previous,key,node:snapshot.node,index:c.index,name:radioBoardName(c.name),public:c.psk.length<16,signature:previous?.signature??false,unread:previous?.unread??0,messages:previous?.messages??[]};
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
    if(c.key!==key||c.node!==node||c.messages.some(m=>m.from===message.from&&m.id===message.id))return c;
    return {...c,messages:[...c.messages,message].sort((a,b)=>a.timestamp-b.timestamp).slice(-100),unread:visible?0:message.outgoing?c.unread:Math.min(100,c.unread+1)};
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
