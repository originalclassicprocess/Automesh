import { isValidAccountId } from '../addressing/bech32m.js';
export const NOTIFICATION_PROTOCOL = 'automesh-notifications-v1';
export type NotificationRoute = { provider:string; device:string; updatedAt:number; enabled:boolean; hasNode:boolean };
export type NotificationState = { enabled:boolean; provider:string; peers:Record<string,NotificationRoute[]>; muted?:Record<string,number>; muteDurations?:Record<string,number> };
export const emptyNotifications = ():NotificationState => ({enabled:false,provider:'',peers:{}});
export function providerUrl(value:string, localOrigin?:string):string | null {
  try {
    const u=new URL(value);
    const local=u.origin===localOrigin && ['127.0.0.1','localhost','[::1]'].includes(u.hostname);
    if (u.username || u.password || u.search || u.hash || !['/api/notifications','/api/notifications/'].includes(u.pathname) ||
      (!local && (u.protocol!=='https:' || u.port && u.port!=='443' ||
      !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(u.hostname) || /\.(?:localhost|local|internal|test|invalid|example)$/.test(u.hostname)))) return null;
    return `${u.origin}/api/notifications`;
  } catch {return null;}
}
export function notificationRoute(value:unknown):NotificationRoute | null {
  if (!value || typeof value!=='object' || Array.isArray(value)) return null;
  const r=value as NotificationRoute;
  if (typeof r.provider!=='string' || !providerUrl(r.provider) || typeof r.device!=='string' || !/^[A-Za-z0-9_-]{22,86}$/.test(r.device) ||
    !Number.isSafeInteger(r.updatedAt) || r.updatedAt<0 || r.updatedAt>Date.now()+300000 || typeof r.enabled!=='boolean' || typeof r.hasNode!=='boolean') return null;
  return {provider:providerUrl(r.provider)!,device:r.device,updatedAt:r.updatedAt,enabled:r.enabled,hasNode:r.hasNode};
}
export function normalizeNotifications(value:unknown):NotificationState {
  const s=emptyNotifications(); if (!value || typeof value!=='object') return s;
  const raw=value as NotificationState;
  s.enabled=raw.enabled===true;
  s.provider=typeof raw.provider==='string' && providerUrl(raw.provider) || '';
  if(raw.muted && typeof raw.muted==='object' && !Array.isArray(raw.muted)) {
    s.muted={};
    for(const [peer,until] of Object.entries(raw.muted).slice(0,500))if(isValidAccountId(peer)&&Number.isSafeInteger(until)&&(until===-1||until>Date.now()))s.muted[peer]=until;
  }
  if (raw.peers && typeof raw.peers==='object') for (const [peer,routes] of Object.entries(raw.peers).slice(0,500)) {
    if (!isValidAccountId(peer) || !Array.isArray(routes)) continue;
    s.peers[peer]=routes.slice(0,8).map(notificationRoute).filter((r):r is NotificationRoute=>!!r);
  }
  if(raw.muteDurations&&typeof raw.muteDurations==='object'&&!Array.isArray(raw.muteDurations)){
    const durations=Object.fromEntries(Object.entries(raw.muteDurations).slice(0,500).filter(([peer,hours])=>s.muted?.[peer]!==-1&&!!s.muted?.[peer]&&[1,8,24].includes(hours)));
    if(Object.keys(durations).length)s.muteDurations=durations;
  }
  return s;
}
export function chatNotificationsMuted(state:NotificationState,peer:string,now=Date.now()):boolean {
  const until=state.muted?.[peer];return until===-1 || typeof until==='number'&&until>now;
}
export function muteChatNotifications(state:NotificationState,peer:string,duration:number,now=Date.now()):NotificationState {
  if(!isValidAccountId(peer)||![-1,0,3600000,28800000,86400000].includes(duration))throw Error('notification_mute');
  const muted={...state.muted};
  if(duration===0)delete muted[peer];else {if(!Object.hasOwn(muted,peer)&&Object.keys(muted).length>=500)throw Error('notification_mute_limit');muted[peer]=duration===-1?-1:now+duration;}
  const muteDurations={...state.muteDurations};if(duration>0)muteDurations[peer]=duration/3600000;else delete muteDurations[peer];
  const next={...state,muted};if(Object.keys(muteDurations).length)next.muteDurations=muteDurations;else delete next.muteDurations;
  return next;
}
export function rememberNotificationRoute(state:NotificationState,peer:string,value:unknown):NotificationState {
  const r=notificationRoute(value); if (!r || !isValidAccountId(peer)) return state;
  const previous=state.peers[peer]??[];
  const old=previous.find(v=>v.device===r.device);
  if (old && old.updatedAt>=r.updatedAt || !state.peers[peer] && Object.keys(state.peers).length>=500) return state;
  return {...state,peers:{...state.peers,[peer]:[r,...previous.filter(v=>v.device!==r.device)].slice(0,8)}};
}
