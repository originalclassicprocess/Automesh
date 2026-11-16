// Separate scopes per notification provider, independent of app-shell updates.
// No vault, identity keys, sender names or message content are available here.
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
function messageNotification(locale) {
  return self.registration.showNotification('Automesh',{body:locale==='ru'?'В Automesh есть новые сообщения.':'You have new messages in Automesh.',icon:'/icon-192.png',badge:'/icon-192.png',tag:'automesh-message',renotify:false});
}
self.addEventListener('message',event=>{
  if(event.data?.type==='automesh-local-message' && event.source && new URL(event.source.url).origin===self.location.origin)
    event.waitUntil(messageNotification(event.data.locale));
});
self.addEventListener('push',event=>{
  event.waitUntil((async()=>{
    let data;try{data=event.data?.json();}catch{}
    const ru=data?.locale==='ru',kind=data?.protocol==='automesh-notifications-v1'&&['message','attempt','return','test'].includes(data.kind)?data.kind:'message';
    const body=kind==='return'?(ru?'Собеседник готов получить сообщение. Откройте Automesh для отправки.':'Your contact is ready to receive a message. Open Automesh to send it.'):
      kind==='attempt'?(ru?'Собеседник пытается отправить сообщение. Откройте Automesh.':'Your contact is trying to send a message. Open Automesh.'):
      kind==='test'?(ru?'Уведомления на этом устройстве работают.':'Notifications are working on this device.'):
      (ru?'В Automesh есть новые сообщения.':'You have new messages in Automesh.');
    await self.registration.showNotification('Automesh',{body,icon:'/icon-192.png',badge:'/icon-192.png',tag:`automesh-${kind}`,renotify:false});
  })());
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of clients)if(new URL(client.url).origin===self.location.origin && new URL(client.url).pathname==='/'){
      await client.focus();client.postMessage({type:'automesh-notification-open'});return;
    }
    await self.clients.openWindow('/');
  })());
});
