import { describe,it,expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
function worker(){const listeners={},shown=[],opened=[],messages=[];let focused=0;
  const self={location:{origin:'https://automesh.online'},addEventListener:(type,cb)=>listeners[type]=cb,skipWaiting:async()=>{},registration:{showNotification:async(title,options)=>shown.push({title,options})},clients:{claim:async()=>{},matchAll:async()=>[{url:'https://automesh.online/',focus:async()=>{focused++;},postMessage:m=>messages.push(m)}],openWindow:async url=>opened.push(url)}};
  runInNewContext(readFileSync(new URL('../static/notification-worker.js',import.meta.url),'utf8'),{self,URL});
  async function dispatch(type,extra={}){let pending;listeners[type]({waitUntil:p=>pending=p,...extra});await pending;}
  return {self,shown,opened,messages,dispatch,get focused(){return focused;}};
}
describe('notification worker without unlocked account access',()=>{
  it('describes a node-less pending send as an attempt, without claiming the file is ready',async()=>{const w=worker();await w.dispatch('push',{data:{json:()=>({protocol:'automesh-notifications-v1',kind:'attempt',locale:'ru'})}});expect(w.shown[0].options.body).toContain('пытается отправить');expect(w.shown[0].options.body).not.toContain('есть новые');});
  it('shows generic localized notifications and never trusts URLs/content from push payloads',async()=>{const w=worker();await w.dispatch('push',{data:{json:()=>({protocol:'automesh-notifications-v1',kind:'return',locale:'ru',url:'https://evil.org',text:'private'})}});expect(w.shown[0].options.body).toContain('Собеседник готов');expect(JSON.stringify(w.shown)).not.toContain('private');await w.dispatch('notificationclick',{notification:{close(){}}});expect(w.focused).toBe(1);expect(w.opened).toEqual([]);expect(w.messages).toEqual([{type:'automesh-notification-open'}]);});
  it('still displays a safe visible notification for missing/malformed push data',async()=>{const w=worker();await w.dispatch('push',{data:{json(){throw Error('invalid');}}});expect(w.shown[0].options.body).toBe('You have new messages in Automesh.');});
  it('opens only the app root when no app window is available',async()=>{const w=worker();w.self.clients.matchAll=async()=>[];await w.dispatch('notificationclick',{notification:{close(){}}});expect(w.opened).toEqual(['/']);});
  it('accepts local incoming-message notifications only from the app origin',async()=>{const w=worker();await w.dispatch('message',{source:{url:'https://evil.org/'},data:{type:'automesh-local-message',locale:'ru'}});expect(w.shown).toEqual([]);await w.dispatch('message',{source:{url:'https://automesh.online/'},data:{type:'automesh-local-message',locale:'ru'}});expect(w.shown).toHaveLength(1);});
});
