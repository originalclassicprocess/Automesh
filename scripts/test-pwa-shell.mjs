// Smoke-test the production service worker without touching browser profiles.
// Run after `npm run build`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { MessageChannel } from 'node:worker_threads';

const code = readFileSync(resolve('.svelte-kit/output/client/service-worker.js'), 'utf8');
const listeners = new Map();
const entries = new Map();
const appVersion = JSON.parse(readFileSync(resolve('.svelte-kit/output/client/_app/version.json'), 'utf8')).version;
const origin = 'http://127.0.0.1:5173';
const key = value => new URL(typeof value === 'string' ? value : value.url, origin).pathname;
class WorkerRequest extends Request { constructor(value, init) { super(new URL(value, origin), init); } }
let online = true;
let shellVersion = appVersion;
let activated = 0;
const storage = {
  async open(name) {
    if (!entries.has(name)) entries.set(name, new Map());
    const items = entries.get(name);
    return {
      async addAll(urls) {
        for (const url of urls) items.set(key(url), new Response(key(url)));
      },
      async put(url, response) { items.set(key(url), response.clone()); },
      async match(url) { return items.get(key(url))?.clone(); },
    };
  },
  async keys() { return [...entries.keys()]; },
  async delete(name) { return entries.delete(name); },
  async match(url) {
    for (const items of entries.values()) if (items.has(url)) return items.get(url);
  },
};
const self = {
  location: { origin: 'http://127.0.0.1:5173' },
  addEventListener(type, callback) { listeners.set(type, callback); },
  clients: { async claim() {}, async matchAll() { return []; } },
  async skipWaiting() { activated++; },
};

runInNewContext(code, {
  self, location: { pathname: '/service-worker.js' }, caches: storage,
  fetch: async () => {
    if (!online) throw new Error('server offline');
    return new Response('cached app shell', { headers: { 'X-Automesh-Version': shellVersion } });
  },
  URL, Request: WorkerRequest, Response, AbortController, MessageChannel, setTimeout, clearTimeout,
});

let installed;
listeners.get('install')({ waitUntil(promise) { installed = promise; } });
await installed;
assert.equal(activated, 0, 'install must not silently update open tabs');
const cacheNames = await storage.keys();
assert.equal(cacheNames.length, 1);
const shell = entries.get(cacheNames[0]);
assert.ok(shell.has('/'));
assert.ok(shell.has('/manifest.webmanifest'));
assert.ok(shell.has('/icon-192.png'));
assert.ok(shell.has('/icon-512.png'));
assert.ok([...shell.keys()].some((url) => url.startsWith('/_app/immutable/')));
assert.ok(![...shell.keys()].some(url => url.startsWith('/downloads/')),
  'node installers and release manifests must not be downloaded into every PWA cache');

let offlineResponse;
online = false;
listeners.get('fetch')({
  request: { method: 'GET', mode: 'navigate', url: 'http://127.0.0.1:5173/' },
  respondWith(promise) { offlineResponse = promise; },
});
assert.equal(await (await offlineResponse).text(), 'cached app shell');

let intercepted = false;
listeners.get('fetch')({
  request: { method: 'GET', mode: 'navigate', url: 'http://127.0.0.1:5173/dev' },
  respondWith() { intercepted = true; },
});
assert.equal(intercepted, false, 'only the account-independent root shell may be cached');
let readiness;
let readinessWork;
listeners.get('message')({ data: { type: 'mesh-offline-status' },
  ports: [{ postMessage(value) { readiness = value; } }], waitUntil(promise) { readinessWork = promise; } });
await readinessWork;
assert.equal(readiness.complete, true);
assert.equal(readiness.version, appVersion,
  'offline status must identify the cached app version, not only a complete old worker');
let activationWork;
listeners.get('message')({ data: { type: 'mesh-activate-update' }, source: { url: origin + '/' },
  waitUntil(promise) { activationWork = promise; } });
await activationWork;
assert.equal(activated, 1, 'complete updates can be activated explicitly by this origin');
const missingAsset = [...shell.keys()].find((url) => url.startsWith('/_app/immutable/'));
shell.delete(missingAsset);
listeners.get('message')({ data: { type: 'mesh-offline-status' },
  ports: [{ postMessage(value) { readiness = value; } }], waitUntil(promise) { readinessWork = promise; } });
await readinessWork;
assert.equal(readiness.complete, false, 'presence of a worker alone must not claim complete offline readiness');
listeners.get('message')({ data: { type: 'mesh-activate-update' }, source: { url: origin + '/' },
  waitUntil(promise) { activationWork = promise; } }); await activationWork;
assert.equal(activated, 1, 'incomplete cache must never activate');
online = true; shellVersion = 'wrong-release';
listeners.get('install')({ waitUntil(promise) { installed = promise; } });
await assert.rejects(installed, /app_shell_version_mismatch/);
console.log('PWA shell checks passed: complete precache, offline fallback, explicit activation, mismatched release rejection');
