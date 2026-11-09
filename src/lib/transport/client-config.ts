// One build uses public runtime metadata from its HTML shell, or the page's
// /signal endpoint. The offline shell keeps the same connection metadata.
export function signalingUrlForPage(pageUrl: string): string {
  const url = new URL('/signal', pageUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('invalid_app_protocol');
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
}

export type SignalingEndpoint = { url: string; kind: 'internet' | 'lan' };

export function isLocalHost(host: string): boolean {
  if (['localhost', '127.0.0.1', '[::1]'].includes(host) || host.endsWith('.local')) return true;
  const parts = host.split('.').map(Number);
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) &&
    (parts[0] === 10 || parts[0] === 127 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168));
}

export function validatedSignalingUrl(value: unknown, pageUrl: string, kind?: SignalingEndpoint['kind']): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    const local = isLocalHost(url.hostname);
    // Never silently downgrade to plaintext on a network. HTTP localhost is
    // the only exception for developer builds; HTTPS always requires WSS.
    if (url.protocol !== 'wss:' && !(url.protocol === 'ws:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && new URL(pageUrl).protocol === 'http:')) return null;
    if (url.username || url.password || url.hash || url.search) return null;
    if (kind === 'lan' && !local) return null;
    if (kind === 'internet' && local) return null;
    return url.href;
  } catch { return null; }
}

export function signalingEndpoints(config: Record<string, unknown>, pageUrl: string): SignalingEndpoint[] {
  const endpoints: SignalingEndpoint[] = [];
  const add = (value: unknown, kind?: SignalingEndpoint['kind']) => {
    const url = validatedSignalingUrl(value, pageUrl, kind);
    if (!url || endpoints.some((endpoint) => endpoint.url === url)) return;
    endpoints.push({ url, kind: kind ?? (isLocalHost(new URL(url).hostname) ? 'lan' : 'internet') });
  };
  // Only deployment-provided addresses are tried. No subnet scans, external
  // connectivity-check services or guesses from an untrusted signaling packet.
  add(config.internetSignalingUrl, 'internet');
  add(config.signalingUrl);
  add(config.lanSignalingUrl, 'lan');
  if (endpoints.length === 0) add(signalingUrlForPage(pageUrl));
  return endpoints.sort((a, b) => Number(a.kind === 'lan') - Number(b.kind === 'lan'));
}

function runtimeConfig(): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  if (typeof document !== 'undefined') {
    try {
      const metadata = JSON.parse(document.getElementById('mesh-runtime-config')?.textContent || '{}');
      if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) Object.assign(config, metadata);
    } catch { /* Old cached shells and standalone dev use the same-origin fallback. */ }
  }
  return config;
}

export function defaultSignalingEndpoints(): SignalingEndpoint[] {
  const pageUrl = typeof location === 'undefined' ? 'http://localhost:5173/' : location.href;
  const config = runtimeConfig();
  if (import.meta.env.VITE_MESH_SIGNALING_URL) config.signalingUrl = import.meta.env.VITE_MESH_SIGNALING_URL;
  return signalingEndpoints(config, pageUrl);
}

export function defaultSignalingUrl(): string { return defaultSignalingEndpoints()[0].url; }

// Existing Internet defaults, explicitly isolated from transport behavior.
// LAN and direct QR never use these, regardless of deployment metadata.
const DEFAULT_STUN_URLS = ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'];
export function configuredStunServers(value: unknown): RTCIceServer[] {
  const urls = value === undefined ? DEFAULT_STUN_URLS : value;
  if (!Array.isArray(urls) || urls.length > 8) return [];
  const valid = urls.every(url => {
    if (typeof url !== 'string' || url.length > 255) return false;
    const match = /^(?:stun|stuns):(?:\[[0-9a-f:]+\]|[a-z0-9][a-z0-9.-]*)(?::([0-9]{1,5}))?$/i.exec(url);
    return Boolean(match && (!match[1] || (Number(match[1]) > 0 && Number(match[1]) <= 65535)));
  });
  // Invalid explicit config fails closed; never silently contacts Google.
  return valid ? [...new Set<string>(urls)].map(url => ({ urls: url })) : [];
}
export function defaultStunServers(): RTCIceServer[] { return configuredStunServers(runtimeConfig().stunUrls); }
