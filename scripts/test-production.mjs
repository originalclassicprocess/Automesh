// Exercise the actual generated Node handler with public deployment metadata.
// No user vault, browser profile or external service participates.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync, readdirSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import WebSocket from 'ws';
import { createApplicationServer } from '../server/application.js';
import { accountIdFromPublicKey } from '../src/lib/addressing/account-id.js';
import { registrationProofBytes } from '../src/lib/transport/registration-proof.js';
import { deploymentDefaults } from '../nodes/packages/deployment/src/defaults.js';

process.env.ORIGIN = process.env.TEST_APP_ORIGIN || deploymentDefaults.appOrigin;
for (const name of Object.keys(process.env)) if (name.startsWith('MESH_RUNTIME_')) delete process.env[name];
const { handler } = await import('../build/handler.js');
// These are build-time browser tools, not packages installed on the host.
// A dev machine's node_modules must not mask an unbundled SSR import.
function checkBundledPasswordTools(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
    if (entry.isDirectory()) checkBundledPasswordTools(path);
    else if (entry.name.endsWith('.js')) {
      assert.ok(!/(?:from\s*|import\s*\(\s*|require\s*\(\s*)['"](?:@zxcvbn-ts\/|fastest-levenshtein)/.test(readFileSync(path, 'utf8')),
        `password tools must be bundled, not a host dependency: ${entry.name}`);
    }
  }
}
checkBundledPasswordTools(new URL('../build/server/', import.meta.url));
const runtime = createApplicationServer(handler, { origin: process.env.ORIGIN });
const sockets = [];
try {
  runtime.app.listen(0, '127.0.0.1'); await once(runtime.app, 'listening');
  const url = `http://127.0.0.1:${runtime.app.address().port}`;
  const version = JSON.parse(readFileSync(new URL('../build/client/_app/version.json', import.meta.url), 'utf8')).version;
  // The generated app and its actual production wrapper must serve the new
  // same-origin rendezvous, not only Vite's test middleware.
  const pair = (action, body, token, origin = process.env.ORIGIN) => fetch(url + '/api/device-pair/' + action, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body)
  });
  const pairId = 'a'.repeat(64), ownerToken = 'b'.repeat(64), joinToken = 'c'.repeat(64);
  assert.equal((await pair('create', { id: pairId, ownerToken, joinToken }, undefined, 'https://foreign.example')).status, 403);
  assert.equal((await pair('create', { id: pairId, ownerToken, joinToken })).status, 201);
  assert.equal((await pair('request', { id: pairId, packet: 'd'.repeat(80) }, joinToken)).status, 200);
  const pairRead = await pair('read', { id: pairId }, ownerToken);
  assert.equal(pairRead.headers.get('cache-control'), 'no-store'); assert.equal((await pairRead.json()).request, 'd'.repeat(80));
  assert.equal((await pair('cancel', { id: pairId }, ownerToken)).status, 200);
  const shell = await fetch(url + '/'); const html = await shell.text();
  assert.equal(shell.status, 200); assert.equal(shell.headers.get('x-automesh-version'), version);
  assert.equal(shell.headers.get('strict-transport-security'), 'max-age=31536000');
  assert.ok(Buffer.byteLength(shell.headers.get('link') || '') <= 4096,
    'optional preload header must leave room below shared-hosting response header limits');
  assert.ok(/<link\b[^>]+rel="stylesheet"/.test(html), 'HTML must retain its stylesheets when the optional header is omitted');
  assert.ok(/import\(["']\.\/_app\/immutable\//.test(html), 'HTML must retain its application bootstrap');
  const policy = shell.headers.get('content-security-policy');
  assert.ok(policy, 'SvelteKit must emit a CSP header, not just nonce attributes');
  const directives = new Map(policy.split(';').map(part => {
    const [name, ...values] = part.trim().split(/\s+/); return [name, values];
  }));
  const scripts = directives.get('script-src') ?? [];
  assert.ok(scripts.includes("'self'"));
  assert.ok(!scripts.includes("'unsafe-inline'") && !scripts.includes("'unsafe-eval'") && !scripts.includes('*'));
  const nonceSource = scripts.find(value => /^'nonce-[^']+'$/.test(value));
  assert.ok(nonceSource, 'production inline scripts must have a CSP nonce');
  const nonce = nonceSource.slice(7, -1);
  for (const [name, values] of [['object-src', ["'none'"]], ['base-uri', ["'none'"]],
    ['frame-ancestors', ["'none'"]], ['form-action', ["'self'"]], ['worker-src', ["'self'"]]]) {
    assert.deepEqual(directives.get(name), values, `unexpected ${name}`);
  }
  assert.ok((directives.get('connect-src') ?? []).includes('wss:'), 'approved home nodes remain usable');
  assert.ok((directives.get('connect-src') ?? []).includes('https:'), 'approved home-node HTTPS API must not be blocked by the application CSP');
  assert.ok(!(directives.get('connect-src') ?? []).includes('http:'), 'home-node API must not allow plaintext network connections');
  const inlineScripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(match => !/\bsrc=/.test(match[1]));
  assert.ok(inlineScripts.length > 0);
  for (const [, attributes] of inlineScripts) {
    assert.equal(/\bnonce="([^"]+)"/.exec(attributes)?.[1], nonce, 'inline/config script nonce must match the header');
  }
  const secondShell = await fetch(url + '/');
  assert.notEqual(secondShell.headers.get('content-security-policy'), policy, 'nonce must be fresh for a new network response');
  assert.equal(shell.headers.get('permissions-policy'), 'geolocation=(), microphone=(self)');
  const metadata = /id="mesh-runtime-config"[^>]*>(.*?)<\/script>/s.exec(html);
  assert.ok(metadata); assert.deepEqual(JSON.parse(metadata[1]), {}, 'public shell must not contain developer LAN endpoints');
  assert.ok(!html.includes('https://automesh.org'), 'unowned information domain must not appear in the app shell');
  for (const path of ['/', '/service-worker.js', '/_app/version.json']) {
    const response = await fetch(url + path); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('strict-transport-security'), 'max-age=31536000');
  }
  assert.equal((await fetch(url + '/dev')).status, 404);
  assert.equal((await fetch(url + '/dev/chat')).status, 404);
  assert.equal((await fetch(url + '/dev/settings')).status, 404);
  assert.equal((await fetch(url + '/dev/radio')).status, 404);
  assert.equal((await fetch(url + '/dev/calls')).status, 404);
  assert.equal((await fetch(url + '/dev/backups')).status, 404);
  assert.equal((await fetch(url + '/dev/devices')).status, 404);
  assert.equal((await fetch(url + '/dev/media')).status, 404);
  assert.equal((await fetch(url + '/dev/core')).status, 404);
  assert.equal((await fetch(url + '/dev/profiles')).status, 404);
  assert.equal((await fetch(url + '/dev/profile-chats')).status, 404);
  const coreCheck = await fetch(url + '/diagnostics/core');
  assert.equal(coreCheck.status, 200);
  assert.equal(coreCheck.headers.get('cache-control'), 'no-store');
  assert.ok(coreCheck.headers.get('content-security-policy')?.includes("'nonce-"));
  const coreCheckHtml = await coreCheck.text();
  assert.ok(coreCheckHtml.includes('Core storage — test'), 'fresh SSR uses the default English interface');
  assert.ok(coreCheckHtml.includes(version));
  assert.ok(coreCheckHtml.includes('noindex, nofollow'));
  // The common HTML shell includes inert connection metadata on every route;
  // the diagnostic page mounts only its disposable driver, never +page.svelte.
  const coreCheckMetadata = /id="mesh-runtime-config"[^>]*>(.*?)<\/script>/s.exec(coreCheckHtml);
  assert.ok(coreCheckMetadata);
  assert.deepEqual(JSON.parse(coreCheckMetadata[1]), {}, 'fixture shell must not contain developer endpoints');
  const health = await (await fetch(url + '/healthz')).json(); assert.deepEqual(Object.keys(health).sort(), ['protocol', 'status']);
  async function client() {
    const keys = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const publicKey = new Uint8Array(await webcrypto.subtle.exportKey('raw', keys.publicKey));
    const address = await accountIdFromPublicKey(publicKey, webcrypto.subtle);
    const socket = new WebSocket(url.replace('http:', 'ws:') + '/signal', { origin: process.env.ORIGIN }); sockets.push(socket);
    await once(socket, 'open');
    let message = once(socket, 'message'); socket.send(JSON.stringify({ type: 'register', address }));
    const challenge = JSON.parse((await message)[0].toString()); assert.equal(challenge.type, 'register_challenge');
    const signature = await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, registrationProofBytes(address, challenge.challenge));
    message = once(socket, 'message'); socket.send(JSON.stringify({ type: 'register_proof', address,
      publicKey: Buffer.from(publicKey).toString('hex'), signature: Buffer.from(signature).toString('hex') }));
    assert.equal(JSON.parse((await message)[0].toString()).type, 'registered');
    return { socket, address };
  }
  const alice = await client(); const bob = await client(); const routed = once(bob.socket, 'message');
  alice.socket.send(JSON.stringify({ type: 'offer', to: bob.address, from: 'forged', attemptId: 'production-smoke',
    sdp: { type: 'offer', sdp: 'test-sdp', untrustedExtra: 'remove me' }, secretExtra: 'remove me' }));
  assert.deepEqual(JSON.parse((await routed)[0].toString()), { type: 'offer', to: bob.address,
    from: alice.address, attemptId: 'production-smoke', sdp: { type: 'offer', sdp: 'test-sdp' } });
  console.log('Production checks passed: matching shell/version, CSP, cache headers, closed fixtures, same-port signed signaling');
} finally { for (const socket of sockets) socket.terminate(); await runtime.close(); }
