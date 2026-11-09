import { afterEach, expect, it } from 'vitest';
import { once } from 'node:events';
import WebSocket from 'ws';
import { createApplicationServer, deploymentConfig } from './application.js';

let runtime;
const sockets = [];
afterEach(async () => { for (const ws of sockets) ws.terminate(); sockets.length = 0; await runtime?.close(); runtime = undefined; });
async function start(handler = (_request, response) => { response.end('client shell'); }, maxConnections = 256) {
  runtime = createApplicationServer(handler, { origin: 'https://automesh.space', maxConnections });
  runtime.app.listen(0, '127.0.0.1'); await once(runtime.app, 'listening');
  return `http://127.0.0.1:${runtime.app.address().port}`;
}
it('requires an explicit HTTPS origin for a public production server', () => {
  expect(() => deploymentConfig({ NODE_ENV: 'production' })).toThrow();
  for (const ORIGIN of ['http://automesh.space', 'https://a:b@automesh.space', 'https://automesh.space/path', 'https://automesh.space/#x'])
    expect(() => deploymentConfig({ ORIGIN })).toThrow();
  expect(deploymentConfig({ NODE_ENV: 'production', ORIGIN: 'https://automesh.space', PORT: '4321' }).port).toBe(4321);
});
it('keeps origin permissions operator-configured and separate from client discovery defaults', () => {
  const env = { NODE_ENV: 'production', ORIGIN: 'https://first.example' };
  expect(deploymentConfig(env).allowedSignalingOrigins).toEqual(['https://first.example']);
  expect(deploymentConfig({ ...env, SIGNALING_ALLOWED_ORIGINS: 'https://second.example, https://first.example' }).allowedSignalingOrigins)
    .toEqual(['https://first.example','https://second.example']);
  for (const value of ['*','http://public.example','https://user:secret@second.example','https://second.example/path',
    'https://second.example/?token=secret',Array(17).fill('https://second.example').join(',')])
    expect(() => deploymentConfig({ ...env, SIGNALING_ALLOWED_ORIGINS: value })).toThrow();
});
it('admits an explicitly permitted second app origin but still requires account proof and rejects unrelated sites', async () => {
  runtime = createApplicationServer((_request,response)=>response.end('shell'),
    deploymentConfig({ORIGIN:'https://first.example',SIGNALING_ALLOWED_ORIGINS:'https://second.example'}));
  runtime.app.listen(0,'127.0.0.1'); await once(runtime.app,'listening');
  const url=`ws://127.0.0.1:${runtime.app.address().port}/signal`;
  const foreign=new WebSocket(url,{origin:'https://unrelated.example'}); sockets.push(foreign); foreign.on('error',()=>{});
  const [,response]=await once(foreign,'unexpected-response'); expect(response.statusCode).toBe(401); response.destroy();
  for(const origin of ['https://first.example','https://second.example']) {
    const ws=new WebSocket(url,{origin}); sockets.push(ws); await once(ws,'open');
    const reply=once(ws,'message'); ws.send(JSON.stringify({type:'probe'}));
    expect(JSON.parse((await reply)[0].toString()).protocol).toBe('mesh-signaling-v1');
    const closed=once(ws,'close'); ws.send(JSON.stringify({type:'register',address:'peer-aaaaaaaa'}));
    expect((await closed)[0]).toBe(1008);
  }
});
it('serves the client, hides fixtures and rejects uploads without exposing account state', async () => {
  const url = await start(); const shell = await fetch(url);
  expect(await shell.text()).toBe('client shell'); expect(shell.headers.get('x-frame-options')).toBe('DENY');
  expect(shell.headers.get('referrer-policy')).toBe('no-referrer');
  expect(shell.headers.get('strict-transport-security')).toBe('max-age=31536000');
  for (const path of ['/dev', '/dev/', '/%64ev']) expect((await fetch(url + path)).status).toBe(404);
  expect((await fetch(url, { method: 'POST', body: 'seed' })).status).toBe(405);
  expect(await (await fetch(url + '/healthz')).json()).toEqual({ status: 'ok', protocol: 'mesh-signaling-v1' });
});
it('does not set HSTS for HTTP localhost development, irrespective of forwarded headers', async () => {
  runtime = createApplicationServer((_request, response) => response.end('local'), { origin: 'http://localhost:5173' });
  runtime.app.listen(0, '127.0.0.1'); await once(runtime.app, 'listening');
  const shell = await fetch(`http://127.0.0.1:${runtime.app.address().port}`, { headers: { 'X-Forwarded-Proto': 'https' } });
  expect(shell.headers.get('strict-transport-security')).toBeNull();
});
it('serves the opaque pairing relay before the read-only application handler', async () => {
  const url = await start(), id = 'a'.repeat(64), ownerToken = 'b'.repeat(64), joinToken = 'c'.repeat(64);
  const call = (action, body, token, origin = 'https://automesh.space') => fetch(url + '/api/device-pair/' + action, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body)
  });
  expect((await call('create', { id, ownerToken, joinToken }, undefined, 'https://foreign.example')).status).toBe(403);
  const created = await call('create', { id, ownerToken, joinToken });
  expect(created.status).toBe(201); expect(created.headers.get('cache-control')).toBe('no-store');
  expect((await call('read', { id }, joinToken)).status).toBe(404);
  expect((await call('request', { id, packet: 'd'.repeat(80) }, joinToken)).status).toBe(200);
  expect((await (await call('read', { id }, ownerToken)).json()).request).toBe('d'.repeat(80));
  expect((await fetch(url + '/api/device-pair/read')).status).toBe(405);
  expect(await (await fetch(url + '/')).text()).toBe('client shell');
});
it('prevents long-lived caching of the worker and version even when the static handler sets it', async () => {
  const url = await start((_request, response) => { response.setHeader('Cache-Control', 'public, max-age=999'); response.writeHead(200, { 'Cache-Control': 'public, max-age=999' }); response.end('static'); });
  for (const path of ['/', '/service-worker.js', '/_app/version.json'])
    expect((await fetch(url + path)).headers.get('cache-control')).toBe('no-store');
});
it('provides same-port WebSocket signaling but rejects unauthenticated diagnostic accounts', async () => {
  const url = await start(); const ws = new WebSocket(url.replace('http:', 'ws:') + '/signal', { origin: 'https://automesh.space' }); sockets.push(ws);
  await once(ws, 'open'); const message = once(ws, 'message'); ws.send(JSON.stringify({ type: 'probe' }));
  expect(JSON.parse((await message)[0].toString()).protocol).toBe('mesh-signaling-v1');
  const closed = once(ws, 'close'); ws.send(JSON.stringify({ type: 'register', address: 'peer-aaaaaaaa' }));
  expect((await closed)[0]).toBe(1008);
});
it('rejects a foreign browser origin before registration and bounds total live sockets', async () => {
  const url = (await start(undefined, 1)).replace('http:', 'ws:') + '/signal';
  const foreign = new WebSocket(url, { origin: 'https://evil.example' }); sockets.push(foreign);
  const rejected = once(foreign, 'unexpected-response'); foreign.on('error', () => {});
  const [, response] = await rejected; expect(response.statusCode).toBe(401); response.destroy();
  const first = new WebSocket(url, { origin: 'https://automesh.space' }); sockets.push(first); await once(first, 'open');
  const second = new WebSocket(url, { origin: 'https://automesh.space' }); sockets.push(second);
  const full = once(second, 'unexpected-response'); second.on('error', () => {});
  const [, fullResponse] = await full; expect(fullResponse.statusCode).toBe(401); fullResponse.destroy();
});
