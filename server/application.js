import { createServer } from 'node:http';
import { createSignalingServer } from './signaling.js';
import { createDevicePairingRelay } from './device-pairing.js';

function signalingOrigins(origin, additional = []) {
  if (!Array.isArray(additional) || additional.length > 16) throw new Error('Invalid SIGNALING_ALLOWED_ORIGINS');
  const origins = [...new Set([origin, ...additional.map(value => {
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
        (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) throw new Error('Invalid SIGNALING_ALLOWED_ORIGINS');
    return url.origin;
  })])];
  if (origins.length > 16) throw new Error('Invalid SIGNALING_ALLOWED_ORIGINS');
  return origins;
}

export function deploymentConfig(env = process.env) {
  const origin = new URL(env.ORIGIN || 'http://localhost:8080');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
  if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/' ||
      (origin.protocol !== 'https:' && !(local && origin.protocol === 'http:')))
    throw new Error('ORIGIN must be a canonical HTTPS origin (HTTP only for localhost)');
  if (env.NODE_ENV === 'production' && !env.ORIGIN) throw new Error('Set ORIGIN before production startup');
  const port = Number(env.PORT || 8080);
  const maxConnections = Number(env.SIGNALING_MAX_CONNECTIONS || 256);
  if (!Number.isInteger(port) || port < 1 || port > 65535 ||
      !Number.isSafeInteger(maxConnections) || maxConnections < 1 || maxConnections > 10000)
    throw new Error('Invalid PORT or SIGNALING_MAX_CONNECTIONS');
  // cPanel/Passenger supplies its port. Never guess a forwarded Host or trust
  // arbitrary X-Forwarded-For values for identity, origins or rate limits.
  const additional = (env.SIGNALING_ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
  return { origin: origin.origin, host: env.HOST || '127.0.0.1', port, maxConnections,
    allowedSignalingOrigins: signalingOrigins(origin.origin, additional) };
}

export function createApplicationServer(handler, { origin, maxConnections = 256, allowedSignalingOrigins = [] } = {}) {
  const allowedOrigins = signalingOrigins(origin, allowedSignalingOrigins);
  const httpsOrigin = new URL(origin).protocol === 'https:';
  const pairing = createDevicePairingRelay({ origin });
  const app = createServer({ maxHeaderSize: 16 * 1024 }, (request, response) => {
    // TLS may terminate at the hosting proxy. Trust configured ORIGIN, never
    // an untrusted forwarded header; leave HTTP localhost development alone.
    if (httpsOrigin) response.setHeader('Strict-Transport-Security', 'max-age=31536000');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Permissions-Policy', 'geolocation=(), microphone=(self)');
    response.setHeader('Cache-Control', 'no-store');
    const reject = (status, message) => { response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end(message); };
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, origin).pathname); }
    catch { reject(400, 'Bad request'); return; }
    if (request.url.length > 4096) { reject(414, 'URL too long'); return; }
    if (pathname.startsWith('/api/device-pair/')) {
      void pairing.handle(request, response, pathname).catch(() => { if (!response.headersSent) reject(400, 'Invalid pairing request'); else if (!response.writableEnded) response.destroy(); }); return;
    }
    if (!['GET', 'HEAD'].includes(request.method)) { response.setHeader('Allow', 'GET, HEAD'); reject(405, 'Method not allowed'); return; }
    // No development fixtures in the public runtime, regardless
    // of Host header, reverse proxy configuration or local hostname spoofing.
    // /diagnostics/core is a separate, disposable browser-only storage check.
    if (pathname === '/dev' || pathname.startsWith('/dev/')) { reject(404, 'Not found'); return; }
    if (pathname === '/healthz') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(request.method === 'HEAD' ? undefined : JSON.stringify({ status: 'ok', protocol: 'mesh-signaling-v1' }));
      return;
    }
    // Static adapter responses do not go through the Svelte server hook.
    // Keep worker/version revalidating even if the adapter sets its own header.
    const writeHead = response.writeHead;
    response.writeHead = function (...args) {
      if (['/', '/service-worker.js', '/_app/version.json'].includes(pathname)) {
        this.setHeader('Cache-Control', 'no-store');
        const headers = typeof args[1] === 'object' ? args[1] : args[2];
        if (headers && !Array.isArray(headers)) for (const key of Object.keys(headers))
          if (key.toLowerCase() === 'cache-control') headers[key] = 'no-store';
      }
      return writeHead.apply(this, args);
    };
    try {
      Promise.resolve(handler(request, response)).catch(() => {
        if (!response.headersSent) reject(500, 'Application unavailable'); else response.destroy();
      });
    } catch { if (!response.headersSent) reject(500, 'Application unavailable'); else response.destroy(); }
  });
  app.requestTimeout = 15_000;
  app.headersTimeout = 10_000;
  app.keepAliveTimeout = 5000;
  const signaling = createSignalingServer({ httpServer: app, path: '/signal', allowedOrigins,
    allowDiagnosticPeers: false, maxConnections });
  async function close() {
    pairing.close();
    for (const socket of signaling.clients) socket.terminate();
    await new Promise(resolve => signaling.close(resolve));
    await new Promise(resolve => app.close(resolve));
  }
  return { app, signaling, close };
}
