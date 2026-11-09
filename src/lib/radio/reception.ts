import { int32Field, numberField, floatField } from './meshtastic-wire';
export type RadioReception = { receivedAt: number; rssi?: number; snr?: number; hops?: number };
export function normalizeRadioReception(value: unknown): RadioReception | undefined {
  if(!value||typeof value!=='object')return;
  const raw=value as RadioReception;
  if(!Number.isSafeInteger(raw.receivedAt)||raw.receivedAt<0)return;
  return {receivedAt:raw.receivedAt,
    ...(Number.isFinite(raw.rssi)&&raw.rssi!>=-160&&raw.rssi!<=20?{rssi:raw.rssi}:{}),
    ...(Number.isFinite(raw.snr)&&raw.snr!>=-40&&raw.snr!<=40?{snr:raw.snr}:{}),
    ...(Number.isInteger(raw.hops)&&raw.hops!>=0&&raw.hops!<=7?{hops:raw.hops}:{})};
}
export function packetReception(packet:Parameters<typeof numberField>[0],now=Date.now()):RadioReception|undefined {
  if(numberField(packet,14))return; // MQTT metadata is not a radio observation.
  const time=numberField(packet,7),start=numberField(packet,15),remaining=numberField(packet,9);
  const rssi=packet.has(12)?int32Field(packet,12):undefined,snr=floatField(packet,8);
  // Without physical receive metrics this can be a local echo, not RF reception.
  if(rssi===undefined&&snr===undefined)return;
  const reception = normalizeRadioReception({receivedAt:time>0&&time*1000<=now+300000?Math.min(now,time*1000):now,rssi,snr,
    // Old firmware may omit hop_start: do not turn missing data into "direct".
    hops:start>0&&start<=7&&remaining<=start?start-remaining:undefined});
  return reception&&(reception.rssi!==undefined||reception.snr!==undefined)?reception:undefined;
}
export function weakestReception(a:RadioReception|undefined,b:RadioReception):RadioReception {
  if(!a)return b;
  const low=(x:number|undefined,y:number|undefined)=>x===undefined?y:y===undefined?x:Math.min(x,y);
  return {receivedAt:Math.min(a.receivedAt,b.receivedAt),rssi:low(a.rssi,b.rssi),snr:low(a.snr,b.snr),
    hops:a.hops===undefined?b.hops:b.hops===undefined?a.hops:Math.max(a.hops,b.hops)};
}
export function radioQuality(reception:RadioReception) {
  // Approximate receiving-link quality, not an end-to-end availability promise.
  const value=reception.snr!==undefined?reception.snr:reception.rssi;
  if(value===undefined)return undefined;
  const limits=reception.snr!==undefined?[-13,-7,0,5]:[-118,-108,-95,-80];
  const level=limits.filter(limit=>value>=limit).length+1;
  const labels=['Очень плохо','Плохо','Средне','Хорошо','Отлично'];
  return {level,label:labels[level-1],tone:level<=2?'danger':level===3?'warning':'success'};
}
export function radioRecentlyHeard(at:number|undefined,now=Date.now()) {return at!==undefined&&at<=now&&now-at<15*60000;}
export function recordRadioHeard(prior:Record<string,number>,node:number,at:number):Record<string,number>{
  if(!Number.isInteger(node)||node<=0||node>=0xffffffff||!Number.isSafeInteger(at)||at<0||at<=(prior[node]??0))return prior;
  return Object.fromEntries(Object.entries({...prior,[String(node)]:at}).sort((a,b)=>b[1]-a[1]).slice(0,256));
}
