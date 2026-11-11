import { env } from '$env/dynamic/private';
import type { Handle } from '@sveltejs/kit';
import { version } from '$app/environment';

// Only public connection metadata enters the shell. The same client assets
// work on every origin, and the cached HTML keeps an independent signaling
// endpoint available when the application web server is stopped.
export const handle: Handle = async ({ event, resolve }) => {
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(event.url.hostname);
  const signalingUrl = local ? env.MESH_RUNTIME_LOCAL_SIGNAL_URL || 'ws://127.0.0.1:3001' : env.MESH_RUNTIME_SIGNAL_URL;
  const config = JSON.stringify({
    ...(signalingUrl ? { signalingUrl } : {}),
    ...(env.MESH_RUNTIME_INTERNET_SIGNAL_URL ? { internetSignalingUrl: env.MESH_RUNTIME_INTERNET_SIGNAL_URL } : {}),
    ...(env.MESH_RUNTIME_LAN_SIGNAL_URL ? { lanSignalingUrl: env.MESH_RUNTIME_LAN_SIGNAL_URL } : {}),
    ...(env.MESH_RUNTIME_STUN_URLS !== undefined ? {
      stunUrls: env.MESH_RUNTIME_STUN_URLS ? env.MESH_RUNTIME_STUN_URLS.split(',').map(url => url.trim()) : [],
    } : {}),
  }).replaceAll('<', '\\u003c');
  const response = await resolve(event, { transformPageChunk: ({ html }) => html.replace('__MESH_RUNTIME_CONFIG__', config) });
  // HTML retains its stylesheet links and application bootstrap. A large Link
  // header can exceed a shared host's total response-header limit, causing a
  // proxy 500 even when SSR succeeded. Keep the HTML and security headers.
  const preload = response.headers.get('link');
  if (preload && new TextEncoder().encode(preload).byteLength > 4096) response.headers.delete('link');
  response.headers.set('X-Automesh-Version', version);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('Permissions-Policy', 'geolocation=(), microphone=(self)');
  if (event.url.pathname === '/' || event.url.pathname === '/service-worker.js' || event.url.pathname === '/_app/version.json')
    response.headers.set('Cache-Control', 'no-store');
  return response;
};
