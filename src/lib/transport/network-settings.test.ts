import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeNetworkSettings, parseNodeInvite, parseInternetNodeInvite, parseSignalingNode, nodeInvite, routingEndpoints, localNodes, probeSignaling } from './network-settings';
import type { SignalingEndpoint } from './client-config';

const page = 'https://app.example/';
const node = { url: 'wss://192.168.0.10:3002/signal', name: 'Дом', enabled: true };
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('local node consent/configuration', () => {
  it('adds explicit public servers, prioritizes them, preserves LAN and allows disabling the deployment default', () => {
    const custom = { url: 'wss://node.automesh.space/signal', name: 'Моя нода', enabled: true };
    expect(parseInternetNodeInvite(nodeInvite(custom), page)).toEqual(custom);
    expect(parseSignalingNode(node.url, page).url).toBe(node.url);
    expect(() => parseNodeInvite(custom.url, page)).toThrow();
    expect(() => parseInternetNodeInvite(node.url, page)).toThrow();
    const base: SignalingEndpoint[] = [{ kind: 'internet', url: 'wss://app.example/signal' }];
    const settings = normalizeNetworkSettings({ nodes: [node], internetNodes: [custom, { url: base[0].url, enabled: false }] });
    expect(routingEndpoints(base, settings, page)).toEqual([{ kind: 'internet', url: custom.url }, { kind: 'lan', url: node.url }]);
    expect(routingEndpoints(base, { ...settings, internetEnabled: false }, page)).toEqual([{ kind: 'lan', url: node.url }]);
    expect(normalizeNetworkSettings({ internetNodes: [{ url: node.url }, { url: 'ws://public.example/signal' }] }).internetNodes).toBeUndefined();
  });
  it('persists LAN-only and excludes Internet endpoints without disabling configured LAN', () => {
    const base: SignalingEndpoint[] = [{ kind: 'internet', url: 'wss://app.example/signal' }, { kind: 'lan', url: node.url }];
    const settings = normalizeNetworkSettings({ internetEnabled: false, quickReserve: true, nodes: [node] });
    expect(normalizeNetworkSettings(JSON.parse(JSON.stringify(settings)))).toEqual(settings);
    expect(routingEndpoints(base, settings, page)).toEqual([{ kind: 'lan', url: node.url }]);
    expect(normalizeNetworkSettings({ internetEnabled: 'false' }).internetEnabled).toBeUndefined();
  });
  it('round-trips a versioned QR invitation without any account/seed data', () => {
    expect(parseNodeInvite(nodeInvite(node), page)).toEqual(node);
    expect(JSON.parse(nodeInvite(node))).toEqual({ type: 'mesh-local-node', version: 1, url: node.url, name: node.name });
  });
  it('validates a preview without opening a network connection', () => {
    const socket = vi.fn(); vi.stubGlobal('WebSocket', socket);
    expect(parseNodeInvite(node.url, page).url).toBe(node.url);
    expect(socket).not.toHaveBeenCalled();
  });
  it.each([3002, 3003, 43003])('preserves the explicitly entered port %i through preview, QR, storage and routing', (port) => {
    const url = `wss://192.168.0.145:${port}/signal`;
    const preview = parseNodeInvite(`  ${url}  `, page);
    expect(preview.url).toBe(url);
    const confirmed = parseNodeInvite(nodeInvite(preview), page);
    const settings = normalizeNetworkSettings({ nodes: [confirmed] });
    expect(settings.nodes[0].url).toBe(url);
    expect(routingEndpoints([], settings, page)).toEqual([{ kind: 'lan', url }]);
  });
  it('rejects public nodes, plaintext LAN, auth tokens, arbitrary QR types and secrets', () => {
    for (const input of ['ws://192.168.0.10:3002', 'wss://evil.example/signal', 'javascript:alert(1)',
      'wss://user:password@192.168.0.10/signal', 'wss://192.168.0.10/signal?token=secret',
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
      JSON.stringify({ type: 'mesh-contact', version: 1, url: node.url }),
      JSON.stringify({ type: 'mesh-local-node', version: 2, url: node.url })]) {
      expect(() => parseNodeInvite(input, page)).toThrow();
    }
    expect(() => parseNodeInvite('x'.repeat(4097), page)).toThrow('node_invite_too_large');
  });
  it('allows loopback WS only for HTTP developer builds', () => {
    expect(parseNodeInvite('ws://127.0.0.1:3001', 'http://localhost/').url).toBe('ws://127.0.0.1:3001/');
    expect(() => parseNodeInvite('ws://127.0.0.1:3001', page)).toThrow();
  });
  it('cleans malformed, duplicate or excessive persisted nodes; reserve defaults off', () => {
    const raw = { nodes: [{ ...node }, { ...node }, { url: 'wss://evil.example' },
      ...Array.from({ length: 10 }, (_, i) => ({ ...node, url: `wss://192.168.0.${i + 20}:3002/signal`, name: '\u0000hidden' }))] };
    const result = normalizeNetworkSettings(raw);
    expect(result.quickReserve).toBe(false);
    expect(result.nodes).toHaveLength(6);
    expect(result.nodes[1].name).not.toContain('\u0000');
    expect(normalizeNetworkSettings(null)).toEqual({ quickReserve: false, nodes: [] });
  });
  it('merges cached deployment addresses with user choices without changing Internet settings', () => {
    const internet: SignalingEndpoint = { kind: 'internet', url: 'wss://app.example/signal' };
    const base: SignalingEndpoint[] = [internet, { kind: 'lan', url: node.url }];
    const settings = { quickReserve: false, nodes: [{ ...node, enabled: false }] };
    expect(localNodes(base, settings)).toEqual(settings.nodes);
    expect(routingEndpoints(base, settings, page)).toEqual([internet]);
    expect(routingEndpoints(base, { ...settings, nodes: [node] }, page)).toHaveLength(2);
  });
  it('persists explicit server opt-out and suppresses all automatic signaling endpoints', () => {
    const base: SignalingEndpoint[] = [{ kind:'lan', url:node.url }, { kind:'internet', url:'wss://app.example/signal' }];
    const settings = normalizeNetworkSettings({ signalingEnabled:false, quickReserve:true, nodes:[node] });
    expect(settings.signalingEnabled).toBe(false);
    expect(routingEndpoints(base, settings, page)).toEqual([]);
    expect(localNodes(base, settings)).toEqual([node]);
    expect(normalizeNetworkSettings({ signalingEnabled:'false' }).signalingEnabled).toBeUndefined();
  });
});

class ProbeSocket {
  static instances: ProbeSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  sent: string[] = [];
  closed = false;
  constructor() { ProbeSocket.instances.push(this); }
  send(text: string) { this.sent.push(text); }
  close() { this.closed = true; this.onclose?.(); }
}
describe('anonymous node checks', () => {
  it('sends only a protocol probe and closes after the reply', async () => {
    vi.stubGlobal('WebSocket', ProbeSocket);
    const result = probeSignaling(node.url); const socket = ProbeSocket.instances.at(-1)!;
    socket.onopen?.();
    socket.onmessage?.({ data: JSON.stringify({ type: 'probe_result', protocol: 'mesh-signaling-v1', registryId: 'a'.repeat(32) }) });
    expect(await result).toEqual({ registryId: 'a'.repeat(32) });
    expect(socket.sent).toEqual(['{"type":"probe"}']); expect(socket.closed).toBe(true);
  });
  it('cancels and bounds a stuck check; no identity is ever submitted', async () => {
    vi.useFakeTimers(); vi.stubGlobal('WebSocket', ProbeSocket);
    const controller = new AbortController(); const pending = probeSignaling(node.url, controller.signal);
    const rejection = expect(pending).rejects.toThrow('probe_cancelled'); controller.abort(); await rejection;
    expect(ProbeSocket.instances.at(-1)!.closed).toBe(true);
    const timeout = probeSignaling(node.url); const assertion = expect(timeout).rejects.toThrow('node_timeout');
    await vi.advanceTimersByTimeAsync(5_001); await assertion;
    expect(ProbeSocket.instances.at(-1)!.sent).toEqual([]);
  });
});
