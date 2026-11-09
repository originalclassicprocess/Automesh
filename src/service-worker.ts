/// <reference lib="webworker" />
/// <reference types="@sveltejs/kit" />

import { base, build, files, version } from '$service-worker';
import { obsoleteCaches } from './lib/application/cache-versions';

declare const self: ServiceWorkerGlobalScope;

const CACHE_PREFIX = 'mesh-autonomy-shell-';
const CACHE_NAME = `${CACHE_PREFIX}${version}`;
const SHELL_URL = `${base}/`;
const PUBLIC_ASSETS = files.filter((path) =>
  path.endsWith('/manifest.webmanifest') ||
  path.endsWith('/icon-192.png') ||
  path.endsWith('/icon-512.png')
);
const PRECACHE = [...new Set([...build, ...PUBLIC_ASSETS, SHELL_URL])];
const CACHED_ASSETS = new Set([...build, ...PUBLIC_ASSETS]);

async function completeCache(): Promise<boolean> {
  const cache = await caches.open(CACHE_NAME);
  return (await Promise.all(PRECACHE.map(url => cache.match(url)))).every(Boolean);
}
let cleanup: Promise<void> | null = null;
function cleanupUnusedCaches(): Promise<void> {
  if (cleanup) return cleanup;
  cleanup = (async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const versions = await Promise.all(clients.map(client => new Promise<string | null>(resolve => {
      const channel = new MessageChannel();
      const finish = (value: string | null) => { clearTimeout(timer); channel.port1.close(); channel.port2.close(); resolve(value); };
      const timer = setTimeout(() => finish(null), 2000);
      channel.port1.onmessage = event => finish(event.data?.type === 'mesh-app-version' &&
        typeof event.data.version === 'string' ? event.data.version : null);
      try { client.postMessage({ type: 'mesh-app-version' }, [channel.port2]); } catch { finish(null); }
    })));
    for (const name of obsoleteCaches(await caches.keys(), CACHE_NAME, versions)) await caches.delete(name);
  })().catch(() => {}).finally(() => { cleanup = null; });
  return cleanup;
}

self.addEventListener('message', (event) => {
  if (event.data?.type === 'mesh-activate-update') {
    // Only a window of this application can request an explicit activation.
    if (event.source && 'url' in event.source && new URL(event.source.url).origin === self.location.origin)
      event.waitUntil(completeCache().then(complete => { if (complete) return self.skipWaiting(); }));
    return;
  }
  if (event.data?.type !== 'mesh-offline-status' || !event.ports[0]) return;
  event.waitUntil((async () => {
    const complete = await completeCache();
    event.ports[0].postMessage({ type: 'mesh-offline-status', complete, version });
    await cleanupUnusedCaches();
  })());
});

self.addEventListener('install', (event) => {
  // Installing succeeds only when a complete, matching app shell is cached.
  // No vault, chat history, API response or peer content enters Cache Storage.
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(PRECACHE.filter(url => url !== SHELL_URL).map(url => new Request(url, { cache: 'reload' })));
    const shell = await fetch(new Request(SHELL_URL, { cache: 'reload' }));
    // Reject an HTML shell from a different release during a non-atomic deploy.
    if (!shell.ok || shell.headers.get('X-Automesh-Version') !== version) throw new Error('app_shell_version_mismatch');
    await cache.put(SHELL_URL, shell);
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await cleanupUnusedCaches();
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    if (url.pathname !== SHELL_URL) return;
    event.respondWith((async () => {
      // Prefer the live app when available (including during development),
      // but keep the complete shell installed with this worker as fallback.
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      try {
        const response = await fetch(request, { signal: controller.signal });
        if (response.ok) return response;
      } catch { /* The local server may be stopped. */ }
      finally { clearTimeout(timeout); }
      return (await (await caches.open(CACHE_NAME)).match(SHELL_URL)) ?? Response.error();
    })());
    return;
  }

  if (!CACHED_ASSETS.has(url.pathname) && !url.pathname.startsWith(`${base}/_app/immutable/`)) return;
  event.respondWith((async () => {
    const own = await caches.open(CACHE_NAME);
    let cached = await own.match(url.pathname);
    if (!cached && url.pathname.startsWith(`${base}/_app/immutable/`)) {
      for (const name of await caches.keys()) {
        if (!name.startsWith(CACHE_PREFIX)) continue;
        cached = await (await caches.open(name)).match(url.pathname);
        if (cached) break;
      }
    }
    if (cached) return cached;
    return fetch(request);
  })());
});
