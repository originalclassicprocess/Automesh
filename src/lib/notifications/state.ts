import { isValidAccountId } from '../addressing/bech32m.js';
export const NOTIFICATION_PROTOCOL = 'automesh-notifications-v1';
export type NotificationRoute = { provider:string; device:string; updatedAt:number; enabled:boolean; hasNode:boolean };
export type NotificationState = { enabled:boolean; provider:string; peers:Record<string,NotificationRoute[]> };
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
  if (raw.peers && typeof raw.peers==='object') for (const [peer,routes] of Object.entries(raw.peers).slice(0,500)) {
    if (!isValidAccountId(peer) || !Array.isArray(routes)) continue;
    s.peers[peer]=routes.slice(0,8).map(notificationRoute).filter((r):r is NotificationRoute=>!!r);
  }
  return s;
}
export function rememberNotificationRoute(state:NotificationState,peer:string,value:unknown):NotificationState {
  const r=notificationRoute(value); if (!r || !isValidAccountId(peer)) return state;
  const previous=state.peers[peer]??[];
  const old=previous.find(v=>v.device===r.device);
  if (old && old.updatedAt>=r.updatedAt || !state.peers[peer] && Object.keys(state.peers).length>=500) return state;
  return {...state,peers:{...state.peers,[peer]:[r,...previous.filter(v=>v.device!==r.device)].slice(0,8)}};
}
