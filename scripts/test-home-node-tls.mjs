import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { request as httpsRequest } from 'node:https';
import { createHash, randomBytes, webcrypto } from 'node:crypto';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import WebSocket from 'ws';
import assert from 'node:assert/strict';
import { readNodeConfig, windowsSecretProtector } from '../server/node/secrets.js';
import { accountIdFromPublicKey } from '../src/lib/addressing/account-id.js';
import { nodeProofBytes, MAILBOX_PROTOCOL } from '../src/lib/node/protocol.js';
import { registrationProofBytes } from '../src/lib/transport/registration-proof.js';

const configFile = process.argv[2];
const saved = JSON.parse(await readFile(configFile, 'utf8'));
assert.equal(saved.version, 2);
assert.equal(saved.adminToken, undefined);
assert.equal(saved.pfxPassword, undefined);
const config = await readNodeConfig(configFile, windowsSecretProtector());
const courierKey = JSON.parse(await readFile(join(config.dataDirectory, 'courier-key.json'), 'utf8'));
assert.equal(courierKey.protection, 'windows-dpapi-current-user');
assert.equal(courierKey.privateKey, undefined);
const ca = await readFile(config.caFile || join(dirname(configFile), 'node-ca.cer'));
const pem = `-----BEGIN CERTIFICATE-----\n${ca.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`;
const base = `https://${config.lanAddress}:${config.port}`;
const { deploymentDefaults } = await import('../nodes/packages/deployment/src/defaults.js');
const origin = deploymentDefaults.appOrigin;
function request(url, { method = 'GET', body, headers = {}, trust = pem, servername } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, { ca: trust, timeout: 5000, method, ...(servername ? { servername } : {}), headers: { Origin: origin, ...headers } }, response => {
      let data = ''; response.setEncoding('utf8'); response.on('data', part => { data += part; });
      response.on('end', () => {
        try { resolve({ status: response.statusCode, headers: response.headers, body: data ? JSON.parse(data) : null }); }
        catch (error) { reject(error); }
      });
      response.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('test_timeout'))); req.on('error', reject); req.end(body);
  });
}
const loopback = await request(`https://127.0.0.1:${config.port}/node/info`);
assert.equal(loopback.status, 200);
const lan = await request(`${base}/node/info`);
assert.equal(lan.status, 200); assert.equal(lan.headers['access-control-allow-origin'], origin);
assert.deepEqual(lan.body, loopback.body);
const info = lan.body;
const preflight = await request(`${base}/mailbox/list`, { method: 'OPTIONS', headers: {
  'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-automesh-proof' } });
assert.equal(preflight.status, 204);
const safariPreflight = await request(`${base}/node/info`, { method: 'OPTIONS', headers: {
  'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'cache-control,pragma' } });
assert.equal(safariPreflight.status, 204);
const safariHeaders=safariPreflight.headers['access-control-allow-headers'].toLowerCase().split(',').map(s=>s.trim());
assert.ok(safariHeaders.includes('cache-control') && safariHeaders.includes('pragma'));
assert.equal((await request(`${base}/node/info`, { headers: { Origin: 'https://evil.example' } })).status, 403);
// Authenticate the known localhost SAN at TLS, then exercise HTTP Host rejection.
assert.equal((await request(`${base}/node/info`, { servername: 'localhost', headers: { Host: 'evil.example' } })).status, 403);
assert.equal((await request(`${base}/mailbox/list`, { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } })).status, 403);
await assert.rejects(request(`${base}/node/info`, { trust: [] })); // No insecure TLS fallback.
assert.equal(info.protocol, 'automesh-node-v1'); assert.equal(info.chatOfflineDelivery, true); assert.equal(info.multiMailbox, true);
const snapshotFile = join(dirname(configFile), 'test-public-identities.json');
const identities = { nodeId: info.nodeId, courierAddress: info.courierAddress };
try { assert.deepEqual(identities, JSON.parse(await readFile(snapshotFile, 'utf8'))); }
catch (error) { if (error.code !== 'ENOENT') throw error; await writeFile(snapshotFile, JSON.stringify(identities)); }
const admin = async () => {
  const status = await fetch(`http://127.0.0.1:${config.controlPort}/status`, { headers: { Authorization: `Bearer ${config.adminToken}` } });
  assert.equal(status.status, 200); return status.json();
};
assert.equal((await admin()).nodeId, info.nodeId);
const localQrUrl = `http://127.0.0.1:${config.controlPort}/qr/pair-local`;
assert.equal((await fetch(localQrUrl)).status, 403);
const localQr = await fetch(localQrUrl, { headers: { Authorization: `Bearer ${config.adminToken}` } });
assert.equal(localQr.status, 200);
assert.equal(localQr.headers.get('content-type'), 'image/png');
assert.deepEqual(new Uint8Array(await localQr.arrayBuffer()).slice(0, 4), new Uint8Array([137, 80, 78, 71]));
assert.equal((await request(`${base}/qr/pair-local`)).status, 404);
// The packaged courier must authenticate on its OWN TLS signaling registry,
// using the node's CA, without relaxing certificate/hostname verification.
for (let attempt = 0; attempt < 50 && (await admin()).courier.routes.lan !== 'connected'; attempt++)
  await new Promise(resolve => setTimeout(resolve, 100));
assert.equal((await admin()).courier.routes.lan, 'connected');
assert.equal(info.deliveryScopes, true);
assert.equal((await fetch(`http://127.0.0.1:${config.controlPort}/status`)).status, 403);
await assert.rejects(fetch(`http://${config.lanAddress}:${config.controlPort}/status`, { signal: AbortSignal.timeout(1500) }));

// Throwaway fixture keys only, in the isolated test directory. Persist them to
// verify retrieval of the previous envelope after the bundled backend restarts.
const fixtureFile = join(dirname(configFile), 'test-fixture.json');
let fixture;
try { fixture = JSON.parse(await readFile(fixtureFile, 'utf8')); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  const make = async () => {
    const keys = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const pub = new Uint8Array(await webcrypto.subtle.exportKey('raw', keys.publicKey));
    return { address: await accountIdFromPublicKey(pub, webcrypto.subtle), publicKey: Buffer.from(pub).toString('hex'),
      privateKey: Buffer.from(await webcrypto.subtle.exportKey('pkcs8', keys.privateKey)).toString('base64') };
  };
  fixture = { alice: await make(), bob: await make(), aes: randomBytes(32).toString('base64'), iv: randomBytes(12).toString('base64') };
}
for (const who of [fixture.alice, fixture.bob]) who.key = await webcrypto.subtle.importKey('pkcs8', Buffer.from(who.privateKey, 'base64'), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
const aes = await webcrypto.subtle.importKey('raw', Buffer.from(fixture.aes, 'base64'), 'AES-GCM', false, ['encrypt', 'decrypt']);
async function signed(who, path, value = {}) {
  const body = JSON.stringify(value), digest = createHash('sha256').update(body).digest('hex');
  const challenge = await request(`${base}/node/challenge`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: who.address, method: 'POST', path, digest }) });
  assert.equal(challenge.status, 200);
  const signature = await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, who.key,
    nodeProofBytes(challenge.body.nodeId, who.address, challenge.body.challenge, 'POST', path, digest));
  const proof = Buffer.from(JSON.stringify({ address: who.address, publicKey: who.publicKey, challenge: challenge.body.challenge,
    signature: Buffer.from(signature).toString('hex') })).toString('base64url');
  return request(`${base}${path}`, { method: 'POST', body, headers: { 'Content-Type': 'application/json', 'X-Automesh-Proof': proof } });
}
if (!info.paired) {
  assert.equal((await signed(fixture.alice, '/node/pair', { code: (await admin()).pairCode })).status, 200);
  assert.equal((await signed(fixture.alice, '/mailbox/grant', { address: fixture.bob.address })).status, 200);
}
const sockets = [];
function message(socket) { return once(socket, 'message', { signal: AbortSignal.timeout(5000) }).then(([data]) => JSON.parse(data)); }
async function register(who, host) {
  const socket = new WebSocket(`wss://${host}:${config.port}/signal`, { ca: pem, origin, handshakeTimeout: 5000 }); sockets.push(socket);
  await once(socket, 'open');
  let next = message(socket); socket.send(JSON.stringify({ type: 'register', address: who.address }));
  const challenge = await next; assert.equal(challenge.type, 'register_challenge');
  const signature = await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, who.key, registrationProofBytes(who.address, challenge.challenge));
  next = message(socket); socket.send(JSON.stringify({ type: 'register_proof', address: who.address, publicKey: who.publicKey, signature: Buffer.from(signature).toString('hex') }));
  assert.equal((await next).type, 'registered'); return socket;
}
try {
  const alice = await register(fixture.alice, config.lanAddress), bob = await register(fixture.bob, '127.0.0.1');
  const incoming = message(alice);
  bob.send(JSON.stringify({ type: 'offer', to: fixture.alice.address, from: 'forged', attemptId: 'smoke-lan-1', sdp: { type: 'offer', sdp: 'v=0\r\n' } }));
  assert.deepEqual(await incoming, { type: 'offer', to: fixture.alice.address, from: fixture.bob.address, attemptId: 'smoke-lan-1', sdp: { type: 'offer', sdp: 'v=0\r\n' } });
  // Regression against the packaged backend, not just source modules: hostile
  // JSON must not stop its HTTPS API or either signaling listener.
  const rejected = message(bob);
  bob.send(JSON.stringify({ type: 'courier_receipt', to: fixture.alice.address, id: { toString: null }, receipt: '{}' }));
  assert.deepEqual(await rejected, { type: 'error', reason: 'invalid_courier_receipt' });
  assert.equal((await request(`${base}/node/info`)).status, 200);
} finally { for (const socket of sockets) socket.terminate(); }
const list = await signed(fixture.alice, '/mailbox/list'); assert.equal(list.status, 200);
if (fixture.envelope) {
  const previous = list.body.envelopes.find(item => item.id === fixture.envelope.id); assert.ok(previous, 'Envelope survived restart');
  const opened = await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(fixture.iv, 'base64') }, aes, Buffer.from(previous.ciphertext, 'base64url'));
  assert.equal(new TextDecoder().decode(opened), 'LAN encrypted smoke, sender offline');
  assert.equal((await signed(fixture.alice, '/mailbox/ack', { ids: [previous.id] })).status, 200);
}
fixture.iv = randomBytes(12).toString('base64');
const ciphertext = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv: Buffer.from(fixture.iv, 'base64') }, aes, new TextEncoder().encode('LAN encrypted smoke, sender offline'));
fixture.envelope = { protocol: MAILBOX_PROTOCOL, id: randomBytes(16).toString('hex'), expiresAt: Date.now() + 60_000, ciphertext: Buffer.from(ciphertext).toString('base64url') };
assert.equal((await signed(fixture.bob, '/mailbox/put', fixture.envelope)).status, 200);
assert.equal((await signed(fixture.bob, '/mailbox/list')).status, 403);
assert.ok(!(await readFile(join(config.dataDirectory, 'mailbox', fixture.envelope.id + '.json'), 'utf8')).includes('LAN encrypted smoke'));
await writeFile(fixtureFile, JSON.stringify(fixture, (name, value) => name === 'key' ? undefined : value));
const check = spawnSync(process.execPath, [join(dirname(process.execPath), 'node.cjs'), '--check-lan', configFile], { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
assert.equal(check.status, 0, 'Built-in LAN check');
assert.deepEqual(JSON.parse(check.stdout), { loopback: true, lanHttps: true, signaling: true,
  addresses: (config.lanAddresses ?? [config.lanAddress]).map(address => ({ address, https: true })) });
const stop = await fetch(`http://127.0.0.1:${config.controlPort}/shutdown`, { method: 'POST', headers: { Authorization: `Bearer ${config.adminToken}` } });
assert.equal(stop.status, 200);
process.stdout.write('Bundled Node 24 + real launcher: LAN/loopback TLS, CORS, signed WSS exchange, encrypted mailbox persistence, DPAPI and built-in LAN check passed. No trusted-root/firewall changes.\n');
