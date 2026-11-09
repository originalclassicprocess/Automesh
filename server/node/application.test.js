import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { randomBytes, createHash, webcrypto } from 'node:crypto';
import WebSocket from 'ws';
import { createHomeNode } from './application.js';
import { testProtector } from './test-protection.fixture.js';
const secretProtector = testProtector();
import { accountIdFromPublicKey } from '../../src/lib/addressing/account-id.js';
import { nodeProofBytes, MAILBOX_PROTOCOL } from '../../src/lib/node/protocol.js';
import { registrationProofBytes } from '../../src/lib/transport/registration-proof.js';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
import { courierBytes, COURIER_PROTOCOL } from '../../src/lib/node/courier-protocol.js';

const nodes = [], directories = [];
async function account() {
  const keys = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const pub = new Uint8Array(await webcrypto.subtle.exportKey('raw', keys.publicKey));
  return { keys, publicKey: Buffer.from(pub).toString('hex'), address: await accountIdFromPublicKey(pub, webcrypto.subtle) };
}
const [alice, bob, outsider] = await Promise.all([account(), account(), account()]);
async function start(directory, options = {}) {
  directory ??= await mkdtemp(join(tmpdir(), 'automesh-node-api-test-')); if (!directories.includes(directory)) directories.push(directory);
  const hosts = ['127.0.0.1:0']; const adminToken = randomBytes(32).toString('hex');
  const node = await createHomeNode({ directory, hosts, adminToken, origins: ['http://localhost:5173'], testHttp: true, secretProtector, ...options }); nodes.push(node);
  const listener = node.createPublicServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  hosts.push(`127.0.0.1:${listener.address().port}`); const base = `http://${hosts[1]}`;
  if (options.qrHost) hosts.push(options.qrHost);
  node.control.listen(0, '127.0.0.1'); await once(node.control, 'listening');
  const control = `http://127.0.0.1:${node.control.address().port}`;
  return { node, base, control, directory, adminToken };
}
async function admin(app) {
  return (await fetch(`${app.control}/status`, { headers: { Authorization: `Bearer ${app.adminToken}` } })).json();
}
async function proof(app, who, path, body) {
  const digest = createHash('sha256').update(body).digest('hex');
  const challenge = await (await fetch(`${app.base}/node/challenge`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: who.address, method: 'POST', path, digest }) })).json();
  const signature = await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, who.keys.privateKey,
    nodeProofBytes(challenge.nodeId, who.address, challenge.challenge, 'POST', path, digest));
  return Buffer.from(JSON.stringify({ address: who.address, publicKey: who.publicKey, challenge: challenge.challenge,
    signature: Buffer.from(signature).toString('hex') })).toString('base64url');
}
async function signed(app, who, path, value = {}) {
  const body = JSON.stringify(value); const header = await proof(app, who, path, body);
  return fetch(`${app.base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Automesh-Proof': header }, body });
}
async function pair(app) {
  const code = (await admin(app)).pairCode;
  const result = await signed(app, alice, '/node/pair', { code }); expect(result.status).toBe(200);
}
async function joinMember(app, who) {
  const invitation = await (await fetch(`${app.control}/pair-code`, { method: 'POST', headers: { Authorization: `Bearer ${app.adminToken}` } })).json();
  return signed(app, who, '/node/join', { code: invitation.pairCode });
}
async function removeMember(app, address, extra = {}) {
  return fetch(`${app.control}/members/remove`, { method: 'POST', headers: { Authorization: `Bearer ${app.adminToken}`, 'Content-Type': 'application/json', ...extra },
    body: JSON.stringify({ address, confirm: 'remove-node-data' }) });
}
async function courierJob(app, who, to) {
  const body = { protocol: COURIER_PROTOCOL, from: who.address, to, courier: app.node.courier.address,
    id: crypto.randomUUID(), packet: randomBytes(64).toString('base64url'), expiresAt: Date.now() + 60000 };
  return { body, publicKey: who.publicKey, signature: Buffer.from(await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, who.keys.privateKey, courierBytes('job', body))).toString('hex') };
}
const item = () => ({ protocol: MAILBOX_PROTOCOL, id: randomBytes(16).toString('hex'), expiresAt: Date.now() + 60_000,
  ciphertext: randomBytes(64).toString('base64url') });
afterEach(async () => {
  for (const node of nodes.splice(0)) await node.close();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});
describe('home node authenticated API', () => {
  it('enforces an aggregate disk quota across independently bound inboxes', async () => {
    const app = await start(undefined, { maxBytes: 32 * 1024 }); await pair(app); await joinMember(app, bob);
    const large = { ...item(), ciphertext: randomBytes(16000).toString('base64url') };
    expect((await signed(app, alice, '/mailbox/put', large)).status).toBe(200);
    const response = await signed(app, bob, '/mailbox/put', { ...large, id: randomBytes(16).toString('hex'), recipient: bob.address });
    expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: 'mailbox_full', limit: 'storage' });
    expect((await admin(app)).bytes).toBeLessThan(32 * 1024);
  });
  it('isolates secondary inboxes and outgoing statistics from other bound profiles', async () => {
    const app = await start(); await pair(app); expect((await joinMember(app, bob)).status).toBe(200);
    const first = item(), second = item();
    await signed(app, alice, '/mailbox/put', first);
    await signed(app, bob, '/mailbox/put', { ...second, recipient: bob.address });
    expect((await (await signed(app, alice, '/mailbox/list')).json()).envelopes.map(e => e.id)).toEqual([first.id]);
    expect((await (await signed(app, bob, '/mailbox/list')).json()).envelopes.map(e => e.id)).toEqual([second.id]);
    await signed(app, bob, '/mailbox/ack', { ids: [first.id] });
    expect((await (await signed(app, alice, '/mailbox/list')).json()).envelopes).toHaveLength(1);
    await signed(app, alice, '/outbox/put', { job: await courierJob(app, alice, outsider.address) });
    expect(await (await signed(app, bob, '/outbox/status')).json()).toMatchObject({ messages: 0, bytes: 0 });
    expect(await (await signed(app, alice, '/outbox/status')).json()).toMatchObject({ messages: 1 });
  });
  it('removes access and pending data only for the selected profile, including a proof issued before removal', async () => {
    const app = await start(); await pair(app); await joinMember(app, bob);
    await signed(app, alice, '/mailbox/grant', { address: bob.address });
    await signed(app, alice, '/mailbox/put', item());
    await signed(app, bob, '/mailbox/put', { ...item(), recipient: bob.address });
    await signed(app, bob, '/outbox/put', { job: await courierJob(app, bob, outsider.address) });
    const pendingProof = await proof(app, bob, '/mailbox/list', '{}');
    expect((await removeMember(app, bob.address, { Origin: 'http://localhost:5173' })).status).toBe(403);
    expect((await removeMember(app, bob.address)).status).toBe(200);
    expect((await fetch(`${app.base}/mailbox/list`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Automesh-Proof': pendingProof }, body: '{}' })).status).toBe(403);
    expect((await signed(app, bob, '/mailbox/put', item())).status).toBe(403);
    expect((await admin(app)).members).toHaveLength(1);
    expect(app.node.courier.box.stats().messages).toBe(0);
    expect((await (await signed(app, alice, '/mailbox/list')).json()).envelopes).toHaveLength(1);
    await joinMember(app, bob);
    expect((await (await signed(app, bob, '/mailbox/list')).json()).envelopes).toEqual([]);
  });
  it('keeps the secondary inbox isolated when the original primary profile is disconnected', async () => {
    const app = await start(); await pair(app); await joinMember(app, bob);
    const kept = item(); await signed(app, bob, '/mailbox/put', { ...kept, recipient: bob.address });
    await signed(app, alice, '/mailbox/put', item());
    await removeMember(app, alice.address);
    await app.node.close(); nodes.splice(nodes.indexOf(app.node), 1);
    const restarted = await start(app.directory);
    expect((await (await signed(restarted, bob, '/mailbox/list')).json()).envelopes.map(e => e.id)).toEqual([kept.id]);
    await joinMember(restarted, alice);
    expect((await (await signed(restarted, alice, '/mailbox/list')).json()).envelopes).toEqual([]);
  });
  it('finishes an interrupted profile cleanup before opening routes on restart', async () => {
    const app = await start(); await pair(app); await joinMember(app, bob);
    await signed(app, bob, '/outbox/put', { job: await courierJob(app, bob, outsider.address) });
    const cleanup = app.node.courier.removeMember;
    app.node.courier.removeMember = async () => { throw new Error('simulated_disk_failure'); };
    expect((await removeMember(app, bob.address)).status).toBe(503);
    expect(app.node.state.value.pendingRemovals).toEqual([bob.address]);
    expect((await signed(app, bob, '/outbox/status')).status).toBe(403);
    app.node.courier.removeMember = cleanup;
    await app.node.close(); nodes.splice(nodes.indexOf(app.node), 1);
    const restarted = await start(app.directory);
    expect(restarted.node.state.value.pendingRemovals).toEqual([]);
    expect(restarted.node.courier.box.stats().messages).toBe(0);
    expect((await admin(restarted)).members).toHaveLength(1);
  });
  it('frees a slot at the eight-member limit and can remove the last member without resetting the node identity', async () => {
    const app = await start(); await pair(app);
    const members = await Promise.all(Array.from({ length: 8 }, account));
    for (const member of members.slice(0, 7)) expect((await joinMember(app, member)).status).toBe(200);
    expect((await joinMember(app, members[7])).status).toBe(400);
    await removeMember(app, members[0].address);
    expect((await joinMember(app, members[7])).status).toBe(200);
    const nodeId = app.node.state.value.nodeId, courierId = app.node.courier.address;
    for (const member of [...app.node.state.value.members]) expect((await removeMember(app, member.address)).status).toBe(200);
    expect(app.node.state.value.owner).toBeNull(); expect(app.node.state.value.nodeId).toBe(nodeId);
    expect(app.node.courier.address).toBe(courierId);
    expect((await joinMember(app, bob)).status).toBe(200);
  });
  it('serves distinct signal/pair QR only to authenticated loopback admin, with a single-use pairing code', async () => {
    const app = await start(undefined, { qrHost: '192.168.1.25:3003' });
    // Allowlisted LAN endpoint used in QR; no real LAN listener is opened by this fixture.
    const nodeStatus = await admin(app);
    expect(nodeStatus).toMatchObject({ memberLimit: 8, internetIncoming: false, protection: 'test-only-aes-gcm', members: [] });
    expect((await fetch(`${app.control}/qr/pair`)).status).toBe(403);
    expect((await fetch(`${app.base}/qr/pair`)).status).toBe(404);
    const read = async kind => {
      const response = await fetch(`${app.control}/qr/${kind}`, { headers: { Authorization: `Bearer ${app.adminToken}` } });
      expect(response.headers.get('cache-control')).toBe('no-store');
      const image = PNG.sync.read(Buffer.from(await response.arrayBuffer()));
      return jsQR(new Uint8ClampedArray(image.data), image.width, image.height)?.data;
    };
    expect(await read('signal')).toBe('wss://192.168.1.25:3003/signal');
    expect(JSON.parse(await read('pair'))).toMatchObject({ protocol: 'automesh-node-pair-v1', url: 'https://192.168.1.25:3003/', nodeId: nodeStatus.nodeId, code: nodeStatus.pairCode });
    await pair(app);
    expect((await fetch(`${app.control}/qr/pair`, { headers: { Authorization: `Bearer ${app.adminToken}` } })).status).toBe(409);
  });
  it('can disable LAN signaling without disabling HTTPS mailboxes and reports it correctly', async () => {
    const app = await start(undefined, { signalingEnabled: false, maxMessages: 2 });
    expect((await admin(app)).signaling).toMatchObject({ enabled: false, clients: 0 });
    expect(await (await fetch(`${app.base}/node/info`)).json()).toMatchObject({ signalingEnabled: false, capabilities: ['opaque-mailbox', 'device-directory-v2'] });
    const socket = new WebSocket(app.base.replace('http:', 'ws:') + '/signal');
    await once(socket, 'error'); socket.terminate();
    await pair(app);
    expect((await signed(app, alice, '/mailbox/status')).status).toBe(200);
  });
  it('reports zeroes for a newly paired secondary LAN inbox before its first request', async () => {
    const app = await start(); await pair(app);
    const invitation = await (await fetch(`${app.control}/pair-code`, { method: 'POST', headers: { Authorization: `Bearer ${app.adminToken}` } })).json();
    expect((await signed(app, bob, '/node/join', { code: invitation.pairCode })).status).toBe(200);
    expect((await admin(app)).members.find(member => member.address === bob.address)).toMatchObject({ messages: 0, bytes: 0, senders: 0 });
  });
  it('requires TLS outside explicit test mode', async () => {
    await expect(createHomeNode({})).rejects.toThrow('tls_required');
  });
  it('exposes capabilities but not owner, codes or envelope data publicly', async () => {
    const app = await start(); await pair(app);
    const publicInfo = await (await fetch(`${app.base}/node/info`)).json();
    expect(publicInfo).toMatchObject({ paired: true, chatOfflineDelivery: true, multiMailbox: true });
    expect(JSON.stringify(publicInfo)).not.toContain(alice.address);
    expect(publicInfo.pairCode).toBeUndefined();
    expect((await fetch(`${app.control}/status`)).status).toBe(403);
    expect((await fetch(`${app.control}/status`, { headers: { Authorization: `Bearer ${app.adminToken}`, Origin: 'http://localhost:5173' } })).status).toBe(403);
  });
  it('requires a local pairing code AND a valid account proof; cannot overwrite ownership', async () => {
    const app = await start();
    expect((await signed(app, alice, '/node/pair', { code: 'bad' })).status).toBe(403);
    await pair(app);
    expect((await signed(app, bob, '/node/pair', { code: (await admin(app)).pairCode })).status).toBe(403);
    expect((await signed(app, bob, '/mailbox/status')).status).toBe(403);
  });
  it('binds request proofs to exact body/path and consumes challenges once', async () => {
    const app = await start(); await pair(app);
    const body = JSON.stringify({ address: bob.address }); const header = await proof(app, alice, '/mailbox/grant', body);
    const headers = { 'Content-Type': 'application/json', 'X-Automesh-Proof': header };
    expect((await fetch(`${app.base}/mailbox/revoke`, { method: 'POST', headers, body })).status).toBe(403);
    expect((await fetch(`${app.base}/mailbox/grant`, { method: 'POST', headers, body })).status).toBe(403);
    const second = await proof(app, alice, '/mailbox/grant', body);
    expect((await fetch(`${app.base}/mailbox/grant`, { method: 'POST', headers: { ...headers, 'X-Automesh-Proof': second },
      body: JSON.stringify({ address: outsider.address }) })).status).toBe(403);
  });
  it('only approved senders deposit; only owner retrieves/acks; revocation is immediate', async () => {
    const app = await start(); await pair(app); const envelope = item();
    expect((await signed(app, bob, '/mailbox/put', envelope)).status).toBe(403);
    expect((await signed(app, alice, '/mailbox/grant', { address: bob.address })).status).toBe(200);
    expect((await signed(app, bob, '/mailbox/put', envelope)).status).toBe(200);
    expect((await signed(app, bob, '/mailbox/list')).status).toBe(403);
    expect((await signed(app, bob, '/mailbox/ack', { ids: [envelope.id] })).status).toBe(403);
    expect((await (await signed(app, alice, '/mailbox/list')).json()).envelopes[0]).toMatchObject({ ...envelope, sender: bob.address });
    await signed(app, alice, '/mailbox/revoke', { address: bob.address });
    expect((await signed(app, bob, '/mailbox/put', item())).status).toBe(403);
    await signed(app, alice, '/mailbox/ack', { ids: [envelope.id] });
    expect((await (await signed(app, alice, '/mailbox/list')).json()).envelopes).toEqual([]);
  });
  it('receives an opaque encrypted test envelope after sender disconnect and node restart', async () => {
    const app = await start(); await pair(app); await signed(app, alice, '/mailbox/grant', { address: bob.address });
    const key = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const iv = randomBytes(12); const plaintext = 'test: sender is now offline';
    const cipher = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
    const envelope = { ...item(), ciphertext: Buffer.from(cipher).toString('base64url') };
    expect((await signed(app, bob, '/mailbox/put', envelope)).status).toBe(200);
    expect(await readFile(join(app.directory, 'mailbox', `${envelope.id}.json`), 'utf8')).not.toContain(plaintext);
    await app.node.close(); nodes.splice(nodes.indexOf(app.node), 1);
    const restarted = await start(app.directory);
    const delivered = (await (await signed(restarted, alice, '/mailbox/list')).json()).envelopes[0];
    const opened = await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, Buffer.from(delivered.ciphertext, 'base64url'));
    expect(new TextDecoder().decode(opened)).toBe(plaintext);
  });
  it('rejects unknown Origin, rebinding Host and unsigned requests', async () => {
    const app = await start();
    expect((await fetch(`${app.base}/node/info`, { headers: { Origin: 'https://evil.example' } })).status).toBe(403);
    const rebinding = await new Promise(resolve => {
      const req = httpRequest(`${app.base}/node/info`, { headers: { Host: 'evil.example' } }, response => {
        response.resume(); resolve(response.statusCode);
      }); req.end();
    });
    expect(rebinding).toBe(403);
    expect((await fetch(`${app.base}/mailbox/list`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(403);
  });
  it('still supports the existing authenticated signaling protocol', async () => {
    const app = await start(); const ws = new WebSocket(`${app.base.replace('http:', 'ws:')}/signal`); await once(ws, 'open');
    try {
      ws.send(JSON.stringify({ type: 'register', address: alice.address }));
      const challenge = JSON.parse((await once(ws, 'message'))[0].toString());
      const signature = await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, alice.keys.privateKey,
        registrationProofBytes(alice.address, challenge.challenge));
      ws.send(JSON.stringify({ type: 'register_proof', address: alice.address, publicKey: alice.publicKey,
        signature: Buffer.from(signature).toString('hex') }));
      expect(JSON.parse((await once(ws, 'message'))[0].toString())).toMatchObject({ type: 'registered', address: alice.address });
    } finally { ws.terminate(); }
  });
});
