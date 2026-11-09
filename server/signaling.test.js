import { afterEach, describe, expect, it } from 'vitest';
import { once } from 'node:events';
import { webcrypto } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import WebSocket from 'ws';
import { accountIdFromPublicKey } from '../src/lib/addressing/account-id.js';
import { registrationProofBytes } from '../src/lib/transport/registration-proof.js';
import { COURIER_PROTOCOL, courierBytes } from '../src/lib/node/courier-protocol.js';
import { ATTACHMENT_PROTOCOL } from '../src/lib/node/attachment-protocol.js';

import { createSignalingRegistry, createSignalingServer } from './signaling.js';

let server;
const clients = [];
const httpServers = [];
const extraServers = [];
async function createAccount() {
  const keys = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publicKey = new Uint8Array(await webcrypto.subtle.exportKey('raw', keys.publicKey));
  return { address: await accountIdFromPublicKey(publicKey, webcrypto.subtle), publicKey, privateKey: keys.privateKey };
}
const accounts = await Promise.all(Array.from({ length: 4 }, createAccount));
const [aliceId, bobId, missingId, fourthId] = accounts.map((account) => account.address);
const accountById = new Map(accounts.map((account) => [account.address, account]));

async function register(socket, address) {
  socket.send(JSON.stringify({ type: 'register', address }));
  const [first] = await once(socket, 'message');
  const response = JSON.parse(first.toString());
  if (address.startsWith('peer-')) {
    expect(response).toMatchObject({ type: 'registered', address });
    return response;
  }
  expect(response).toMatchObject({ type: 'register_challenge', address });
  const account = accountById.get(address);
  const signature = new Uint8Array(await webcrypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, account.privateKey,
    registrationProofBytes(address, response.challenge),
  ));
  socket.send(JSON.stringify({
    type: 'register_proof', address,
    publicKey: Buffer.from(account.publicKey).toString('hex'),
    signature: Buffer.from(signature).toString('hex'),
  }));
  const [second] = await once(socket, 'message');
  const registered = JSON.parse(second.toString());
  expect(registered).toMatchObject({ type: 'registered', address });
  return registered;
}

async function connect(address) {
  const port = server.address().port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  clients.push(ws);
  await once(ws, 'open');
  await register(ws, address);
  return ws;
}

afterEach(async () => {
  for (const ws of clients) ws.terminate();
  clients.length = 0;
  if (server) {
    await new Promise((resolve) => server.close(resolve));
    server = undefined;
  }
  for (const extraServer of extraServers) await new Promise((resolve) => extraServer.close(resolve));
  extraServers.length = 0;
  for (const httpServer of httpServers) await new Promise((resolve) => httpServer.close(resolve));
  httpServers.length = 0;
});

describe('signaling server', () => {
  it('rejects hostile JSON field types without stopping signaling or forwarding them', async () => {
    server = createSignalingServer({ port: 0 }); await once(server, 'listening');
    const sender = await connect(aliceId); const receiver = await connect(bobId);
    const poison = { toString: null };
    const frames = [
      { type: 'courier_receipt', to: bobId, id: poison, receipt: '{}' },
      { type: 'courier_receipt', to: bobId, id: ['a'.repeat(32)], receipt: '{}' },
      { type: 'courier_file_request', to: bobId, request: { body: { protocol: ATTACHMENT_PROTOCOL, id: poison } } },
      { type: 'courier_file_chunk', to: bobId, id: poison },
    ];
    const seen = []; receiver.on('message', raw => seen.push(JSON.parse(raw.toString())));
    for (const frame of frames) {
      const result = once(sender, 'message'); sender.send(JSON.stringify(frame));
      expect(JSON.parse((await result)[0].toString())).toMatchObject({ type: 'error' });
    }
    const delivery = once(receiver, 'message'); sender.send(JSON.stringify({ type: 'connect_request', to: bobId }));
    expect(JSON.parse((await delivery)[0].toString())).toMatchObject({ type: 'connect_request', from: aliceId });
    expect(seen).toHaveLength(1);
  });
  it('contains unexpected synchronous validator errors to the offending socket', async () => {
    server = createSignalingServer({ port: 0 }); await once(server, 'listening');
    const sender = await connect(aliceId); const receiver = await connect(bobId);
    const internal = [...server.clients][0]; const closed = once(sender, 'close');
    // A direct fault injection verifies the outer EventEmitter boundary, apart
    // from strict validators which now reject the real hostile JSON examples.
    // A synchronous send failure must not reach process-level exception handling.
    internal.send = () => { throw new Error('injected_send_failure'); };
    internal.emit('message', Buffer.from('{"type":"watch_peer","to":"' + bobId + '"}'), false);
    expect((await closed)[0]).toBe(1008);
    const result = once(receiver, 'message'); receiver.send(JSON.stringify({ type: 'watch_peer', to: missingId }));
    // A connect_request to an offline peer returns a barrier response.
    receiver.send(JSON.stringify({ type: 'connect_request', to: missingId }));
    expect(JSON.parse((await result)[0].toString())).toMatchObject({ type: 'peer_unavailable' });
  });
  it('charges malformed JSON against the byte budget before it can flood parsing', async () => {
    server = createSignalingServer({ port: 0 }); await once(server, 'listening');
    const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}`); clients.push(socket); await once(socket, 'open');
    const closed = once(socket, 'close');
    for (let i = 0; i < 24; i++) socket.send('!'.repeat(64 * 1024));
    expect((await closed)[0]).toBe(1008);
    await connect(aliceId);
  });
  it('routes bounded opaque courier jobs, authenticates the socket and never stores offline deliveries', async () => {
    server = createSignalingServer({ port: 0, host: '127.0.0.1' }); await once(server, 'listening');
    const courier = await connect(fourthId); const bob = await connect(bobId);
    const sign = async (who, purpose, body) => ({ body, publicKey: Buffer.from(who.publicKey).toString('hex'),
      signature: Buffer.from(await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, who.privateKey, courierBytes(purpose, body))).toString('hex') });
    const id = '12345678-1234-1234-1234-123456789abc';
    const job = await sign(accounts[0], 'job', { protocol: COURIER_PROTOCOL, from: aliceId, to: bobId, courier: fourthId,
      id, expiresAt: Date.now() + 60000, packet: Buffer.alloc(51000, 1).toString('base64url') });
    const hop = await sign(accounts[3], 'hop', { protocol: COURIER_PROTOCOL, courier: fourthId, id, digest: 'a'.repeat(64) });
    const receive = once(bob, 'message'); courier.send(JSON.stringify({ type: 'courier_delivery', from: aliceId, to: bobId, job, hop }));
    const delivered = JSON.parse((await receive)[0].toString()); expect(delivered).toMatchObject({ type: 'courier_delivery', from: fourthId, to: bobId, job });
    const ack = once(courier, 'message'); bob.send(JSON.stringify({ type: 'courier_receipt', from: aliceId, to: fourthId, id: id.replaceAll('-', ''), receipt: '{}' }));
    expect(JSON.parse((await ack)[0].toString())).toMatchObject({ type: 'courier_receipt', from: bobId });
    const invalid = once(courier, 'message'); courier.send(JSON.stringify({ type: 'courier_delivery', to: aliceId, job, hop }));
    expect(JSON.parse((await invalid)[0].toString())).toMatchObject({ type: 'error', reason: 'invalid_courier_hop' });
    courier.send(JSON.stringify({ type: 'courier_delivery', to: missingId, job: { ...job, body: { ...job.body, to: missingId } }, hop }));
    // Relay only routes opaque bytes; it neither validates author crypto nor keeps a mailbox.
    const missing = await connect(missingId); const seen = []; missing.on('message', raw => seen.push(JSON.parse(raw.toString())));
    const barrier = once(courier, 'message'); courier.send(JSON.stringify({ type: 'watch_peer', to: missingId })); await barrier;
    expect(seen).toEqual([]);
  });
  it('closes a flooding client before it can consume unbounded signaling work', async () => {
    server = createSignalingServer({ port: 0, messageRate: 1, messageBurst: 3 });
    await once(server, 'listening');
    const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}`); clients.push(socket);
    await once(socket, 'open'); const closed = once(socket, 'close');
    for (let i = 0; i < 8; i++) socket.send(JSON.stringify({ type: 'unknown' }));
    expect((await closed)[0]).toBe(1008);
  });
  it('terminates a slow receiver instead of growing an unbounded outgoing queue', async () => {
    server = createSignalingServer({ port: 0 }); await once(server, 'listening');
    const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}`); clients.push(socket); await once(socket, 'open');
    const internal = [...server.clients][0]; Object.defineProperty(internal, 'bufferedAmount', { value: 300 * 1024 });
    const closed = once(socket, 'close'); socket.send(JSON.stringify({ type: 'probe' })); expect((await closed)[0]).toBe(1006);
  });
  it('answers an anonymous protocol probe without publishing an account or peer data', async () => {
    const registry = createSignalingRegistry();
    server = createSignalingServer({ port: 0, registry, allowDiagnosticPeers: false });
    await once(server, 'listening');
    const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}`);
    clients.push(socket);
    await once(socket, 'open');
    const response = once(socket, 'message');
    socket.send(JSON.stringify({ type: 'probe' }));
    expect(JSON.parse((await response)[0].toString())).toEqual({ type: 'probe_result', protocol: 'mesh-signaling-v1', registryId: registry.id });
    expect(registry.peers.size).toBe(0);
    expect(registry.watchers.size).toBe(0);
  });
  it('routes between loopback and LAN listeners sharing one peer registry', async () => {
    const registry = createSignalingRegistry();
    server = createSignalingServer({ port: 0, registry, iceMode: 'lan', allowDiagnosticPeers: false });
    const lanServer = createSignalingServer({
      port: 0, registry, iceMode: 'lan', allowDiagnosticPeers: false,
      allowedOrigins: ['https://192.168.0.10:5174'],
    });
    extraServers.push(lanServer);
    await Promise.all([once(server, 'listening'), once(lanServer, 'listening')]);

    const local = new WebSocket(`ws://127.0.0.1:${server.address().port}`, { origin: 'http://localhost:5173' });
    clients.push(local);
    await once(local, 'open');
    expect(await register(local, aliceId)).toMatchObject({ iceMode: 'lan' });

    const lan = new WebSocket(`ws://127.0.0.1:${lanServer.address().port}`, { origin: 'https://192.168.0.10:5174' });
    clients.push(lan);
    await once(lan, 'open');
    expect(await register(lan, bobId)).toMatchObject({ iceMode: 'lan' });

    const request = once(lan, 'message');
    local.send(JSON.stringify({ type: 'connect_request', to: bobId, from: fourthId }));
    expect(JSON.parse((await request)[0].toString())).toEqual({ type: 'connect_request', to: bobId, from: aliceId });

    const answer = once(local, 'message');
    lan.send(JSON.stringify({ type: 'answer', to: aliceId, from: fourthId, attemptId: 'attempt-123', sdp: { type: 'answer', sdp: 'answer' } }));
    expect(JSON.parse((await answer)[0].toString())).toMatchObject({ type: 'answer', from: bobId, to: aliceId });
  });

  it('listens only on loopback by default', async () => {
    server = createSignalingServer({ port: 0 });
    await once(server, 'listening');
    expect(server.address().address).toBe('127.0.0.1');
  });

  it('rejects unrelated browser origins but accepts the local app origin', async () => {
    server = createSignalingServer({ port: 0 });
    await once(server, 'listening');
    const url = `ws://127.0.0.1:${server.address().port}`;
    const rejected = new WebSocket(url, { origin: 'https://unrelated.example' });
    clients.push(rejected);
    const status = await new Promise((resolve, reject) => {
      rejected.on('unexpected-response', (_request, response) => resolve(response.statusCode));
      rejected.on('error', reject);
    });
    expect(status).toBe(401);
    const accepted = new WebSocket(url, { origin: 'http://localhost:5173' });
    clients.push(accepted);
    await once(accepted, 'open');
    await register(accepted, aliceId);
  });

  it('can attach signaling to an HTTPS-capable server on a dedicated path', async () => {
    const httpServer = createHttpServer();
    httpServers.push(httpServer);
    server = createSignalingServer({
      httpServer, path: '/signal', allowedOrigins: ['https://192.168.0.10:5174'],
    });
    await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const ws = new WebSocket(`ws://127.0.0.1:${httpServer.address().port}/signal`, {
      origin: 'https://192.168.0.10:5174',
    });
    clients.push(ws);
    await once(ws, 'open');
    await register(ws, aliceId);
  });

  it('can disable unsigned diagnostic identities for LAN use', async () => {
    server = createSignalingServer({ port: 0, allowDiagnosticPeers: false });
    await once(server, 'listening');
    const url = `ws://127.0.0.1:${server.address().port}`;
    const diagnostic = new WebSocket(url);
    clients.push(diagnostic);
    await once(diagnostic, 'open');
    diagnostic.send(JSON.stringify({ type: 'register', address: 'peer-abcdefgh' }));
    expect((await once(diagnostic, 'close'))[0]).toBe(1008);
    await connect(aliceId);
  });

  it('continues serving after malformed JSON from one socket', async () => {
    server = createSignalingServer({ port: 0, host: '127.0.0.1' });
    await once(server, 'listening');
    const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}`);
    clients.push(socket);
    await once(socket, 'open');
    socket.send('{not json');
    const [response] = await once(socket, 'message');
    expect(JSON.parse(response.toString())).toEqual({ type: 'error', reason: 'invalid_json' });
    await register(socket, aliceId);
  });

  it('closes an oversized signaling socket without stopping other accounts', async () => {
    server = createSignalingServer({ port: 0, host: '127.0.0.1' });
    await once(server, 'listening');
    const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}`);
    clients.push(socket);
    await once(socket, 'open');
    const closed = once(socket, 'close');
    socket.send('x'.repeat(65 * 1024));
    const [code] = await closed;
    expect(code).toBe(1009);
    await connect(aliceId);
  });

  it('rejects a mistyped account ID before registering it', async () => {
    server = createSignalingServer({ port: 0, host: '127.0.0.1' });
    await once(server, 'listening');
    const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}`);
    clients.push(socket);
    await once(socket, 'open');
    const alteredLastChar = aliceId.endsWith('x') ? 'q' : 'x';
    socket.send(JSON.stringify({ type: 'register', address: `${aliceId.slice(0, -1)}${alteredLastChar}` }));
    const [code] = await once(socket, 'close');
    expect(code).toBe(1008);
  });

  it('routes by registered address and replaces an untrusted from field', async () => {
    server = createSignalingServer({ port: 0, host: '127.0.0.1' });
    await once(server, 'listening');
    const alice = await connect(aliceId);
    const bob = await connect(bobId);

    alice.send(JSON.stringify({
      type: 'offer',
      to: bobId,
      from: 'rSpoofed',
      attemptId: 'attempt-123',
      sdp: { type: 'offer', sdp: 'test-offer' },
    }));
    const [data] = await once(bob, 'message');
    expect(JSON.parse(data.toString())).toMatchObject({
      type: 'offer',
      from: aliceId,
      to: bobId,
      attemptId: 'attempt-123',
    });
  });

  it('routes a connection request and replaces its untrusted from field', async () => {
    server = createSignalingServer({ port: 0, host: '127.0.0.1' });
    await once(server, 'listening');
    const lower = await connect(aliceId);
    const higher = await connect(bobId);

    higher.send(JSON.stringify({ type: 'connect_request', to: aliceId, from: 'rSpoofed' }));
    const [data] = await once(lower, 'message');
    expect(JSON.parse(data.toString())).toEqual({
      type: 'connect_request', to: aliceId, from: bobId,
    });
  });

  it('routes three separate personal connections among four registered accounts', async () => {
    server = createSignalingServer({ port: 0, host: '127.0.0.1' });
    await once(server, 'listening');
    const first = await connect(aliceId);
    const second = await connect(bobId);
    const third = await connect(missingId);
    const fourth = await connect(fourthId);
    const responses = [second, third, fourth].map((socket) => new Promise((resolve) => {
      const onMessage = (bytes) => {
        const message = JSON.parse(bytes.toString());
        if (message.type !== 'connect_request') return;
        socket.off('message', onMessage);
        resolve(message);
      };
      socket.on('message', onMessage);
    }));
    for (const address of [bobId, missingId, fourthId]) {
      first.send(JSON.stringify({ type: 'connect_request', to: address, from: fourthId }));
    }
    const received = await Promise.all(responses);
    expect(received).toEqual(
      [bobId, missingId, fourthId].map((address) => ({ type: 'connect_request', to: address, from: aliceId })),
    );
  });

  it('notifies only clients that tried to connect to a specific peer', async () => {
    server = createSignalingServer({ port: 0 });
    await once(server, 'listening');
    const alice = await connect(aliceId);
    const unrelated = await connect(fourthId);

    const aliceRequest = once(alice, 'message');
    const bob = await connect(bobId);
    bob.send(JSON.stringify({ type: 'connect_request', to: aliceId }));
    expect(JSON.parse((await aliceRequest)[0].toString())).toEqual({
      type: 'connect_request', to: aliceId, from: bobId,
    });

    const unavailable = once(alice, 'message');
    alice.send(JSON.stringify({ type: 'connect_request', to: missingId }));
    expect(JSON.parse((await unavailable)[0].toString())).toEqual({
      type: 'peer_unavailable', address: missingId, attemptId: '',
    });

    const targetOnline = once(alice, 'message');
    const unrelatedRequest = once(unrelated, 'message');
    const target = await connect(missingId);
    expect(JSON.parse((await targetOnline)[0].toString())).toEqual({
      type: 'peer_online', address: missingId,
    });
    target.send(JSON.stringify({ type: 'connect_request', to: fourthId }));
    expect(JSON.parse((await unrelatedRequest)[0].toString())).toEqual({
      type: 'connect_request', to: fourthId, from: missingId,
    });

    const targetOffline = once(alice, 'message');
    target.close();
    await once(target, 'close');
    expect(JSON.parse((await targetOffline)[0].toString())).toEqual({
      type: 'peer_offline', address: missingId,
    });
  });

  it('restores a specific peer watch after signaling reconnects', async () => {
    server = createSignalingServer({ port: 0 });
    await once(server, 'listening');
    const alice = await connect(aliceId);
    const bob = await connect(bobId);

    const online = once(alice, 'message');
    alice.send(JSON.stringify({ type: 'watch_peer', to: bobId }));
    expect(JSON.parse((await online)[0].toString())).toEqual({ type: 'peer_online', address: bobId });

    const offline = once(alice, 'message');
    bob.close();
    await once(bob, 'close');
    expect(JSON.parse((await offline)[0].toString())).toEqual({ type: 'peer_offline', address: bobId });

    const back = once(alice, 'message');
    await connect(bobId);
    expect(JSON.parse((await back)[0].toString())).toEqual({ type: 'peer_online', address: bobId });
  });

  it('reports an unavailable peer to the sender', async () => {
    server = createSignalingServer({ port: 0, host: '127.0.0.1' });
    await once(server, 'listening');
    const alice = await connect(aliceId);
    alice.send(JSON.stringify({
      type: 'offer',
      to: missingId,
      attemptId: 'attempt-456',
      sdp: { type: 'offer', sdp: 'test-offer' },
    }));
    const [data] = await once(alice, 'message');
    expect(JSON.parse(data.toString())).toEqual({
      type: 'peer_unavailable',
      address: missingId,
      attemptId: 'attempt-456',
    });
  });

  it('does not let a second socket replace an active address', async () => {
    server = createSignalingServer({ port: 0, host: '127.0.0.1' });
    await once(server, 'listening');
    await connect(aliceId);

    const duplicate = new WebSocket(`ws://127.0.0.1:${server.address().port}`);
    clients.push(duplicate);
    await once(duplicate, 'open');
    duplicate.send(JSON.stringify({ type: 'register', address: aliceId }));
    const [code] = await once(duplicate, 'close');
    expect(code).toBe(1008);
  });

  it('does not reserve an account ID before proof of its private key', async () => {
    server = createSignalingServer({ port: 0, host: '127.0.0.1' });
    await once(server, 'listening');
    const attacker = new WebSocket(`ws://127.0.0.1:${server.address().port}`);
    clients.push(attacker);
    await once(attacker, 'open');
    attacker.send(JSON.stringify({ type: 'register', address: aliceId }));
    const [challenge] = await once(attacker, 'message');
    expect(JSON.parse(challenge.toString()).type).toBe('register_challenge');
    await connect(aliceId);
    const closed = once(attacker, 'close');
    attacker.send(JSON.stringify({
      type: 'register_proof', address: aliceId,
      publicKey: Buffer.from(accounts[1].publicKey).toString('hex'),
      signature: '0'.repeat(128),
    }));
    const [code] = await closed;
    expect(code).toBe(1008);
  });

  it('rejects a valid signature from the wrong key and an old challenge replay', async () => {
    server = createSignalingServer({ port: 0, host: '127.0.0.1' });
    await once(server, 'listening');
    const url = `ws://127.0.0.1:${server.address().port}`;
    const wrongKey = new WebSocket(url);
    clients.push(wrongKey);
    await once(wrongKey, 'open');
    wrongKey.send(JSON.stringify({ type: 'register', address: aliceId }));
    const [first] = await once(wrongKey, 'message');
    const firstChallenge = JSON.parse(first.toString()).challenge;
    const wrongSignature = await webcrypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' }, accounts[1].privateKey,
      registrationProofBytes(aliceId, firstChallenge),
    );
    const wrongClosed = once(wrongKey, 'close');
    wrongKey.send(JSON.stringify({
      type: 'register_proof', address: aliceId,
      publicKey: Buffer.from(accounts[1].publicKey).toString('hex'),
      signature: Buffer.from(wrongSignature).toString('hex'),
    }));
    expect((await wrongClosed)[0]).toBe(1008);

    const stale = new WebSocket(url);
    clients.push(stale);
    await once(stale, 'open');
    stale.send(JSON.stringify({ type: 'register', address: aliceId }));
    const [second] = await once(stale, 'message');
    const secondChallenge = JSON.parse(second.toString()).challenge;
    expect(secondChallenge).not.toBe(firstChallenge);
    const oldSignature = await webcrypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' }, accounts[0].privateKey,
      registrationProofBytes(aliceId, firstChallenge),
    );
    const staleClosed = once(stale, 'close');
    stale.send(JSON.stringify({
      type: 'register_proof', address: aliceId,
      publicKey: Buffer.from(accounts[0].publicKey).toString('hex'),
      signature: Buffer.from(oldSignature).toString('hex'),
    }));
    expect((await staleClosed)[0]).toBe(1008);
    await connect(aliceId);
  });

  it('keeps the standalone WebRTC diagnostic page protocol working', async () => {
    server = createSignalingServer({ port: 0, host: '127.0.0.1', allowDiagnosticPeers: true });
    await once(server, 'listening');
    const first = await connect('peer-aaaaaaaa');
    const second = await connect('peer-bbbbbbbb');

    first.send(JSON.stringify({
      type: 'offer',
      to: 'peer-bbbbbbbb',
      from: 'peer-forged00',
      sdp: { type: 'offer', sdp: 'test-offer' },
    }));
    const [data] = await once(second, 'message');
    expect(JSON.parse(data.toString())).toMatchObject({
      type: 'offer',
      from: 'peer-aaaaaaaa',
      to: 'peer-bbbbbbbb',
    });
  });
});
