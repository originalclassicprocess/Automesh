import { afterEach, expect, it, vi } from 'vitest';
import { once } from 'node:events';
import WebSocket from 'ws';
import { createSignalingRegistry, createSignalingServer } from './signaling.js';
import { WebRTCTransport } from '../src/lib/transport/WebRTCTransport';
import { RoutedWebRTCTransport } from '../src/lib/transport/RoutedWebRTCTransport';
import { WebCryptoIdentity } from '$lib/identity/webcrypto';
import { getAccountId } from '$lib/addressing/address';
import { bytesToHex } from '$lib/message/encoding';

const servers = [];
let transport;
afterEach(async () => {
  await transport?.disconnect();
  transport = undefined;
  for (const server of servers) {
    for (const socket of server.clients) socket.terminate();
    await new Promise((resolve) => server.close(() => resolve()));
  }
  servers.length = 0;
  vi.unstubAllGlobals();
});

it('deduplicates shared loopback/LAN listeners after real anonymous probes and signed registration', async () => {
  vi.stubGlobal('WebSocket', WebSocket);
  const registry = createSignalingRegistry();
  const primary = createSignalingServer({ port: 0, registry, allowDiagnosticPeers: false });
  const fallback = createSignalingServer({ port: 0, registry, iceMode: 'lan', allowDiagnosticPeers: false });
  servers.push(primary, fallback);
  await Promise.all([once(primary, 'listening'), once(fallback, 'listening')]);
  transport = new RoutedWebRTCTransport([
    { kind: 'internet', url: `ws://127.0.0.1:${primary.address().port}` },
    { kind: 'lan', url: `ws://127.0.0.1:${fallback.address().port}` },
  ], true);
  const identity = new WebCryptoIdentity();
  const publicKey = (await identity.fromSeed(crypto.getRandomValues(new Uint8Array(32)))).publicKey;
  const accountId = await getAccountId(bytesToHex(publicKey));
  await transport.init(accountId, { publicKey, sign: (data) => identity.sign(data) });
  await vi.waitFor(() => expect(transport.getNodeStates()[1].alias).toBe(true));
  expect(transport.getStatus()).toBe('connected');
  expect(registry.peers.size).toBe(1);
  expect([...primary.clients]).toContain(registry.peers.get(accountId));
  await vi.waitFor(() => expect(fallback.clients.size).toBe(0));
});

it('keeps independent home and server registries registered simultaneously for the same seed account', async () => {
  vi.stubGlobal('WebSocket', WebSocket);
  const homeRegistry = createSignalingRegistry(), serverRegistry = createSignalingRegistry();
  const remote = createSignalingServer({ port: 0, registry: serverRegistry, allowDiagnosticPeers: false });
  const home = createSignalingServer({ port: 0, registry: homeRegistry, iceMode: 'lan', allowDiagnosticPeers: false });
  servers.push(remote, home); await Promise.all([once(remote,'listening'),once(home,'listening')]);
  transport = new RoutedWebRTCTransport([
    { kind:'internet', url:`ws://127.0.0.1:${remote.address().port}` },
    { kind:'lan', url:`ws://127.0.0.1:${home.address().port}` },
  ],false);
  const identity = new WebCryptoIdentity();
  try {
    const publicKey = (await identity.fromSeed(crypto.getRandomValues(new Uint8Array(32)))).publicKey;
    const address = await getAccountId(bytesToHex(publicKey));
    await transport.init(address,{publicKey,sign:data=>identity.sign(data)});
    await vi.waitFor(()=>expect(transport.getNodeStates().every(n=>n.status==='connected'&&!n.alias)).toBe(true));
    expect(homeRegistry.peers.has(address)).toBe(true); expect(serverRegistry.peers.has(address)).toBe(true);
    await transport.resume(); expect(transport.getNodeStates().every(n=>n.status==='connected')).toBe(true);
  } finally { await transport.disconnect(); identity.dispose(); }
});

it('fails over using real WebSockets and signed registration without stale sockets stealing the account', async () => {
  vi.stubGlobal('WebSocket', WebSocket);
  const registry = createSignalingRegistry();
  const primary = createSignalingServer({ port: 0, registry, allowDiagnosticPeers: false });
  const fallback = createSignalingServer({ port: 0, registry, iceMode: 'lan', allowDiagnosticPeers: false });
  servers.push(primary, fallback);
  await Promise.all([once(primary, 'listening'), once(fallback, 'listening')]);
  const primaryUrl = `ws://127.0.0.1:${primary.address().port}`;
  const fallbackUrl = `ws://127.0.0.1:${fallback.address().port}`;
  // Loopback-only test listeners model the roles; production URL validation
  // separately requires WSS for public Internet and HTTPS clients.
  transport = new WebRTCTransport([
    { kind: 'internet', url: primaryUrl }, { kind: 'lan', url: fallbackUrl },
  ]);
  const identity = new WebCryptoIdentity();
  const seed = crypto.getRandomValues(new Uint8Array(32));
  const publicKey = (await identity.fromSeed(seed)).publicKey;
  const accountId = await getAccountId(bytesToHex(publicKey));
  await transport.init(accountId, { publicKey, sign: (data) => identity.sign(data) });
  expect(registry.peers.size).toBe(1);
  for (const socket of primary.clients) socket.close(1012, 'restart');
  await vi.waitFor(() => expect(transport?.getConnectionInfo().url).toBe(fallbackUrl));
  await vi.waitFor(() => expect(transport?.getStatus()).toBe('connected'));
  expect(registry.peers.size).toBe(1);
  expect([...fallback.clients]).toContain(registry.peers.get(accountId));
  expect(registry.watchers.size).toBe(0);
});
