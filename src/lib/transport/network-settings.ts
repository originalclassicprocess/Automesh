import { validatedSignalingUrl, type SignalingEndpoint } from './client-config';
import { normalizeManagedNodes, type ManagedNode } from '$lib/node/node-registry';

export type LocalNode = { url: string; name: string; enabled: boolean };
export type NetworkSettings = { quickReserve: boolean; nodes: LocalNode[]; internetNodes?: LocalNode[]; managedNodes?: ManagedNode[]; signalingEnabled?: false; internetEnabled?: false };
export const MAX_LOCAL_NODES = 6;
export const emptyNetworkSettings = (): NetworkSettings => ({ quickReserve: false, nodes: [] });

function cleanName(value: unknown, url: string): string {
  return typeof value === 'string' && value.trim().length <= 48 && !/[\u0000-\u001f\u007f]/.test(value)
    ? value.trim() || new URL(url).host : new URL(url).host;
}

export function normalizeNetworkSettings(value: unknown): NetworkSettings {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const nodes: LocalNode[] = [];
  if (Array.isArray(raw.nodes)) for (const node of raw.nodes) {
    if (!node || typeof node !== 'object' || nodes.length >= MAX_LOCAL_NODES) continue;
    const url = validatedSignalingUrl(node.url, 'http://localhost/', 'lan');
    if (!url || url.length > 512 || nodes.some((item) => item.url === url)) continue;
    nodes.push({ url, name: cleanName(node.name, url), enabled: node.enabled !== false });
  }
  const internetNodes: LocalNode[] = [];
  if (Array.isArray(raw.internetNodes)) for (const node of raw.internetNodes) {
    if (!node || typeof node !== 'object' || internetNodes.length >= MAX_LOCAL_NODES) continue;
    const url = validatedSignalingUrl(node.url, 'https://app.invalid/', 'internet');
    if (!url || url.length > 512 || internetNodes.some(item => item.url === url)) continue;
    internetNodes.push({ url, name: cleanName(node.name, url), enabled: node.enabled !== false });
  }
  const managedNodes = normalizeManagedNodes(raw.managedNodes);
  return { quickReserve: raw.quickReserve === true, nodes, ...(managedNodes.length ? { managedNodes } : {}), ...(internetNodes.length ? { internetNodes } : {}), ...(raw.signalingEnabled === false ? { signalingEnabled: false as const } : {}),
    ...(raw.internetEnabled === false ? { internetEnabled: false as const } : {}) };
}
export function parseInternetNodeInvite(text: string, pageUrl: string): LocalNode {
  if (text.length > 4096) throw new Error('node_invite_too_large');
  let value: unknown = text.trim(), name: unknown;
  if (text.trim().startsWith('{')) {
    const invite = JSON.parse(text);
    if (invite?.type !== 'mesh-internet-node' || invite.version !== 1) throw new Error('not_node_invite');
    value = invite.url; name = invite.name;
  }
  const url = validatedSignalingUrl(value, pageUrl, 'internet');
  if (!url || url.length > 512) throw new Error('invalid_internet_node');
  return { url, name: cleanName(name, url), enabled: true };
}
export function parseSignalingNode(text: string, pageUrl: string): LocalNode {
  try { return parseNodeInvite(text, pageUrl); } catch { return parseInternetNodeInvite(text, pageUrl); }
}

export function parseNodeInvite(text: string, pageUrl: string): LocalNode {
  if (text.length > 4096) throw new Error('node_invite_too_large');
  let value: unknown = text.trim();
  if (text.trim().startsWith('{')) {
    const invite = JSON.parse(text);
    if (invite?.type !== 'mesh-local-node' || invite.version !== 1) throw new Error('not_node_invite');
    value = invite.url;
    const url = validatedSignalingUrl(value, pageUrl, 'lan');
    if (!url || url.length > 512) throw new Error('invalid_local_node');
    return { url, name: cleanName(invite.name, url), enabled: true };
  }
  const url = validatedSignalingUrl(value, pageUrl, 'lan');
  if (!url || url.length > 512) throw new Error('invalid_local_node');
  return { url, name: new URL(url).host, enabled: true };
}

export function nodeInvite(node: LocalNode): string {
  const safe = parseSignalingNode(node.url, 'http://localhost/');
  const internet = Boolean(validatedSignalingUrl(safe.url, 'https://app.invalid/', 'internet'));
  return JSON.stringify({ type: internet ? 'mesh-internet-node' : 'mesh-local-node', version: 1, url: safe.url, name: cleanName(node.name, safe.url) });
}
export function signalingNodes(base: SignalingEndpoint[], settings: NetworkSettings): LocalNode[] {
  const internet = [...(settings.internetNodes ?? [])];
  for (const endpoint of base.filter(item => item.kind === 'internet'))
    if (!internet.some(item => item.url === endpoint.url)) internet.push({ url: endpoint.url, name: new URL(endpoint.url).host, enabled: true });
  return [...internet, ...localNodes(base, settings)];
}

export function localNodes(base: SignalingEndpoint[], settings: NetworkSettings): LocalNode[] {
  const nodes = base.filter((endpoint) => endpoint.kind === 'lan').map((endpoint) =>
    settings.nodes.find((node) => node.url === endpoint.url) ?? { url: endpoint.url, name: new URL(endpoint.url).host, enabled: true });
  for (const node of settings.nodes) if (!nodes.some((item) => item.url === node.url)) nodes.push(node);
  return nodes;
}

export function routingEndpoints(base: SignalingEndpoint[], settings: NetworkSettings, pageUrl: string): SignalingEndpoint[] {
  if (settings.signalingEnabled === false) return [];
  return [...signalingNodes(base, settings).filter(node => settings.internetEnabled !== false && node.enabled && validatedSignalingUrl(node.url, pageUrl, 'internet'))
    .map(node => ({ url: node.url, kind: 'internet' as const })), ...localNodes(base, settings)
    .filter((node) => node.enabled && validatedSignalingUrl(node.url, pageUrl, 'lan'))
    .map((node) => ({ url: node.url, kind: 'lan' as const }))];
}
export function networkRoutingChanged(base: SignalingEndpoint[], previous: NetworkSettings, next: NetworkSettings, pageUrl: string): boolean {
  return previous.quickReserve !== next.quickReserve || previous.internetEnabled !== next.internetEnabled ||
    previous.signalingEnabled !== next.signalingEnabled ||
    JSON.stringify(routingEndpoints(base, previous, pageUrl)) !== JSON.stringify(routingEndpoints(base, next, pageUrl));
}

export function probeSignaling(url: string, signal?: AbortSignal): Promise<{ registryId?: string }> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('probe_cancelled')); return; }
    let socket: WebSocket;
    try { socket = new WebSocket(url); } catch { reject(new Error('node_unreachable')); return; }
    const timer = setTimeout(() => finish(new Error('node_timeout')), 5_000);
    const abort = () => finish(new Error('probe_cancelled'));
    const finish = (error?: Error, registryId?: string) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      socket.onclose = null;
      socket.onerror = null;
      socket.onmessage = null;
      socket.onopen = null;
      socket.close();
      if (error) reject(error); else resolve({ registryId });
    };
    signal?.addEventListener('abort', abort, { once: true });
    socket.onopen = () => socket.send(JSON.stringify({ type: 'probe' }));
    socket.onmessage = (event) => {
      try {
        const reply = JSON.parse(event.data);
        if (reply.type !== 'probe_result' || reply.protocol !== 'mesh-signaling-v1') throw new Error();
        finish(undefined, typeof reply.registryId === 'string' && /^[a-f0-9]{32}$/.test(reply.registryId) ? reply.registryId : undefined);
      } catch { finish(new Error('node_protocol_invalid')); }
    };
    socket.onerror = () => finish(new Error('node_unreachable'));
    socket.onclose = () => finish(new Error('node_unreachable'));
  });
}
