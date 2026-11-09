import { it, expect } from 'vitest';
import { publicCourierSignal, COURIER_ROUTE_PROTOCOL, validateCourierRoute } from './courier-route.js';
import { WebCryptoIdentity } from '../identity/webcrypto';
import { accountIdFromPublicKey } from '../addressing/account-id.js';
import { createCourierJob, generateCourierKey, signCourier, verifyCourier, type CourierRoute } from './courier-crypto';
import { COURIER_PROTOCOL } from './courier-protocol.js';

it('only discovers canonical WSS public DNS names on the standard TLS port', () => {
  expect(publicCourierSignal('wss://node.example/signal')).toBe('wss://node.example/signal');
  for (const url of ['ws://node.example/signal','wss://localhost/signal','wss://127.0.0.1/signal','wss://[::1]/signal',
    'wss://192.168.0.1/signal','wss://node.local/signal','wss://node.internal/signal','wss://node.example:3003/signal',
    'wss://user:pass@node.example/signal','wss://node.example/signal?token=secret','wss://node.example/other',
    'wss://node.example/signal#fragment','https://node.example/signal','wss://2130706433/signal'])
    expect(() => publicCourierSignal(url)).toThrow();
});
it('binds an optional route to the recipient and sender, preserving legacy and LAN jobs', async () => {
  const a=new WebCryptoIdentity(),b=new WebCryptoIdentity(); await Promise.all([a.create(),b.create()]);
  try {
    const [from,to]=await Promise.all([a,b].map(async k=>accountIdFromPublicKey(await k.getPublicKeyBytes())));
    const expiresAt=Date.now()+60000, key=await generateCourierKey(from,expiresAt);
    const body={protocol:COURIER_ROUTE_PROTOCOL,from:to,to:from,nodeAddress:to,nodeId:'a'.repeat(32),
      signalingUrl:'wss://recipient.example/signal',issuedAt:Date.now(),expiresAt};
    const route:CourierRoute=await signCourier('route',body,b);
    validateCourierRoute(route,to,from); await verifyCourier(route,'route',to);
    const bundle=await signCourier('prekeys',{protocol:COURIER_PROTOCOL,from:to,to:from,expiresAt,
      keys:[{id:key.id,publicKey:key.publicKey}],route},b);
    const routed=await createCourierJob(a,from,from,bundle,key,crypto.randomUUID(),Date.now(),'text');
    expect(routed.body.route).toEqual(route);
    expect((await createCourierJob(a,from,from,bundle,key,crypto.randomUUID(),Date.now(),'lan',true)).body.route).toBeUndefined();
    const legacy=await signCourier('prekeys',{...bundle.body,route:undefined},b);
    expect((await createCourierJob(a,from,from,legacy,key,crypto.randomUUID(),Date.now(),'legacy')).body.route).toBeUndefined();
    for(const changed of [{...body,from},{...body,to},{...body,expiresAt:Date.now()-1},{...body,signalingUrl:'wss://127.0.0.1/signal'}])
      expect(()=>validateCourierRoute({...route,body:changed},to,from)).toThrow();
    const forged=await signCourier('prekeys',{...bundle.body,route:await signCourier('route',body,a)},b);
    await expect(createCourierJob(a,from,from,forged,key,crypto.randomUUID(),Date.now(),'bad')).rejects.toThrow('invalid_courier_signature');
  } finally { a.dispose();b.dispose(); }
});
