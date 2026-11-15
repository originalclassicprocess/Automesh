import assert from 'node:assert/strict';
import {registerHooks,builtinModules} from 'node:module';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {Readable} from 'node:stream';
import {createECDH,randomBytes} from 'node:crypto';
const directory=process.argv[2];if(!directory)throw Error('Supply packaged app directory');
const hooks=registerHooks({resolve(specifier,context,next){
  if(!specifier.startsWith('file:')&&!specifier.startsWith('node:')&&!builtinModules.includes(specifier))throw Error('Unbundled push dependency: '+specifier);
  return next(specifier,context);
}});
const module=await import(pathToFileURL(resolve(directory,'server/notifications.js')).href);
const service=module.createNotifications({origin:'https://automesh.online',directory:':memory:'});
try {
  const request=Readable.from([]);request.method='GET';request.headers={};request.socket={remoteAddress:'127.0.0.1'};
  let status,result;await service.handle(request,{writeHead(s){status=s;},end(value){result=JSON.parse(value);}},'/api/notifications/config');
  assert.equal(status,200);assert.match(result.publicKey,/^[A-Za-z0-9_-]{87}$/);
  const device=createECDH('prime256v1');device.generateKeys();const vapid=createECDH('prime256v1');vapid.generateKeys();
  const details=module.notificationRequestDetails({endpoint:'https://fcm.googleapis.com/fcm/send/disposable-package-test',keys:{p256dh:device.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}},'{"kind":"test"}',{
    vapidDetails:{subject:'https://automesh.online',publicKey:vapid.getPublicKey().toString('base64url'),privateKey:vapid.getPrivateKey().toString('base64url')},TTL:60});
  assert.equal(details.headers['Content-Encoding'],'aes128gcm');assert.match(details.headers.Authorization,/^vapid /);assert.ok(details.body.length>32);
  assert.ok(!details.body.includes(Buffer.from('kind')),'payload must be encrypted');
  console.log('Packaged provider, VAPID signing and Web Push encryption passed with Node built-ins only; no network notification sent.');
}finally{await service.close();hooks.deregister();}
