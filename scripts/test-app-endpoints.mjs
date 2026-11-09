// Smoke-test a running unified LAN/PWA instance without browser storage.
// node scripts/test-app-endpoints.mjs https://<IP>:5174 [http://localhost:5173]
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { get as getHttps } from 'node:https';
import { get as getHttp } from 'node:http';
import { once } from 'node:events';
import { webcrypto } from 'node:crypto';
import WebSocket from 'ws';
import { accountIdFromPublicKey } from '../src/lib/addressing/account-id.js';
import { registrationProofBytes } from '../src/lib/transport/registration-proof.js';

const lan = new URL(process.argv[2]);
const local = new URL(process.argv[3] || 'http://localhost:5173/');
const ca = readFileSync(new URL('../.local-certs/ca.pem', import.meta.url));
const sockets = [];
async function page(url) {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? getHttps : getHttp)(url, { ca }, (response) => {
      let body = '';
      response.on('data', (chunk) => body += chunk);
      response.on('end', () => {
        try { assert.equal(response.statusCode, 200, url.href); resolve(body); } catch (error) { reject(error); }
      });
    });
    request.setTimeout(5000, () => request.destroy(new Error('HTTP timeout')));
    request.on('error', reject);
  });
}
function nextMessage(socket) {
  return once(socket, 'message', { signal: AbortSignal.timeout(5000) }).then(([data]) => JSON.parse(data.toString()));
}
async function connect(url, origin) {
  const socket = new WebSocket(url, { ca, origin });
  sockets.push(socket);
  await once(socket, 'open', { signal: AbortSignal.timeout(5000) });
  const keys = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publicKey = new Uint8Array(await webcrypto.subtle.exportKey('raw', keys.publicKey));
  const address = await accountIdFromPublicKey(publicKey, webcrypto.subtle);
  let response = nextMessage(socket);
  socket.send(JSON.stringify({ type: 'register', address }));
  const challenge = await response;
  assert.equal(challenge.type, 'register_challenge');
  const signature = await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey,
    registrationProofBytes(address, challenge.challenge));
  response = nextMessage(socket);
  socket.send(JSON.stringify({ type: 'register_proof', address, publicKey: Buffer.from(publicKey).toString('hex'),
    signature: Buffer.from(signature).toString('hex') }));
  assert.equal((await response).type, 'registered');
  return { socket, address };
}
try {
  const [lanHtml, localHtml] = await Promise.all([page(lan), page(local)]);
  const assets = (html) => [...new Set(html.match(/\.?\/_app\/immutable\/[A-Za-z0-9_./-]+/g))];
  assert.deepEqual(assets(lanHtml), assets(localHtml), 'Both entry points must serve the same build');
  for (const origin of [lan, local]) {
    for (const path of assets(lanHtml)) await page(new URL(path, origin));
  }
  const config = (html) => JSON.parse(html.match(/<script id="mesh-runtime-config" type="application\/json">(.*?)<\/script>/s)[1]);
  assert.equal(new URL(config(lanHtml).signalingUrl).hostname, lan.hostname);
  assert.equal(new URL(config(localHtml).signalingUrl).hostname, '127.0.0.1');
  assert.equal(config(lanHtml).lanSignalingUrl, config(lanHtml).signalingUrl);
  assert.equal(config(localHtml).lanSignalingUrl, config(lanHtml).signalingUrl,
    'Both cached app shells must retain the same independent LAN fallback');
  // Exercise both same-origin proxies, then both independent offline endpoints.
  for (const independent of [false, true]) {
    const url = (origin, html) => independent ? config(html).signalingUrl :
      new URL('/signal', origin).href.replace(/^http/, 'ws');
    const a = await connect(url(local, localHtml), local.origin);
    const b = await connect(url(lan, lanHtml), lan.origin);
    const incoming = nextMessage(b.socket);
    a.socket.send(JSON.stringify({ type: 'connect_request', to: b.address }));
    assert.deepEqual(await incoming, { type: 'connect_request', to: b.address, from: a.address });
    a.socket.close(); b.socket.close();
  }
  console.log('PASS: matching client assets, runtime config, authenticated localhost ↔ LAN routing through proxies and independent signaling');
} finally {
  for (const socket of sockets) socket.terminate();
}
