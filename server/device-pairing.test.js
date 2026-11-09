import { afterEach, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createDevicePairingRelay } from './device-pairing.js';
let relay, server;
afterEach(async () => { relay?.close(); if (server) await new Promise(resolve => server.close(resolve)); });
async function fixture(options = {}) {
  relay = createDevicePairingRelay({ origin: 'https://app.example', ...options });
  server = createServer((req,res) => { void relay.handle(req,res,new URL(req.url,'http://local').pathname); });
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const url = `http://127.0.0.1:${server.address().port}/api/device-pair/`;
  return (action, body, token, extra = {}) => fetch(url+action, { method:'POST', headers:{ Origin:'https://app.example', 'Content-Type':'application/json', ...(token ? { Authorization:'Bearer '+token } : {}), ...extra }, body:JSON.stringify(body) });
}
const id = 'a'.repeat(64), ownerToken = 'b'.repeat(64), joinToken = 'c'.repeat(64), packet = 'd'.repeat(80);
it('isolates owner and scanning capabilities, makes deposits immutable and does not expose an account index', async () => {
  const call = await fixture(); expect((await call('create',{id,ownerToken,joinToken})).status).toBe(201);
  expect((await call('read',{id},joinToken)).status).toBe(404);
  expect((await call('request',{id,packet},ownerToken)).status).toBe(404);
  expect((await call('request',{id,packet},joinToken)).status).toBe(200);
  expect((await call('request',{id,packet},joinToken)).status).toBe(200);
  expect((await call('request',{id,packet:'e'.repeat(80)},joinToken)).status).toBe(409);
  expect((await (await call('read',{id},ownerToken)).json()).request).toBe(packet);
  expect((await call('approve',{id,packet},joinToken)).status).toBe(404);
  expect((await call('approve',{id,packet},ownerToken)).status).toBe(200);
  expect((await (await call('mine',{id},joinToken)).json()).approval).toBe(packet);
  expect((await call('cancel',{id},ownerToken)).status).toBe(200);
  expect((await call('mine',{id},joinToken)).status).toBe(404);
});
it('bounds expiry, capacity, input, browser origins and authorization', async () => {
  let now = 1000; const call = await fixture({now:()=>now,capacity:1});
  expect((await call('create',{id,ownerToken,joinToken},undefined,{Origin:'https://evil.example'})).status).toBe(403);
  expect((await call('create',{id,ownerToken,joinToken,secret:'rejected'})).status).toBe(400);
  await call('create',{id,ownerToken,joinToken});
  expect((await call('create',{id:'f'.repeat(64),ownerToken,joinToken})).status).toBe(429);
  expect((await call('request',{id,packet:'x'.repeat(92000)},joinToken)).status).toBe(413);
  now += 600001; expect((await call('read',{id},ownerToken)).status).toBe(404);
  expect((await call('create',{id,ownerToken,joinToken})).status).toBe(201);
});
