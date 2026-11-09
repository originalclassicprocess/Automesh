import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultSignalingUrl, signalingUrlForPage, signalingEndpoints, configuredStunServers, defaultStunServers } from './client-config';

afterEach(() => vi.unstubAllGlobals());

describe('explicit STUN configuration', () => {
  it('retains Internet defaults but allows disabling or replacing them', () => {
    expect(configuredStunServers(undefined)).toHaveLength(2);
    expect(configuredStunServers([])).toEqual([]);
    expect(configuredStunServers(['stun:example.test:3478', 'stun:example.test:3478']))
      .toEqual([{ urls: 'stun:example.test:3478' }]);
  });
  it('rejects invalid config without silently falling back to external services', () => {
    for (const value of [null, 'stun:example.test', ['https://example.test'], ['stun:user:password@example.test'],
      ['stun:example.test:0'], ['stun:example.test:99999'], ['stun:example.test?token=secret'], Array(9).fill('stun:a.test')]) {
      expect(configuredStunServers(value)).toEqual([]);
    }
  });
  it('uses cached deployment metadata without probing anything', () => {
    vi.stubGlobal('document', { getElementById: () => ({ textContent: '{"stunUrls":[]}' }) });
    expect(defaultStunServers()).toEqual([]);
  });
});

describe('one client on different entry points', () => {
  it('uses the page origin for localhost, LAN and an Internet host', () => {
    expect(signalingUrlForPage('http://localhost:5173/')).toBe('ws://localhost:5173/signal');
    expect(signalingUrlForPage('https://192.168.0.169:5174/')).toBe('wss://192.168.0.169:5174/signal');
    expect(signalingUrlForPage('https://192.168.0.194:5174/')).toBe('wss://192.168.0.194:5174/signal');
    expect(signalingUrlForPage('https://chat.example/path?key=value')).toBe('wss://chat.example/signal');
  });
  it('rejects unsupported page protocols', () => {
    expect(() => signalingUrlForPage('file:///app/index.html')).toThrow('invalid_app_protocol');
  });
  it('keeps the independent signaling URL from an offline cached HTML shell', () => {
    vi.stubGlobal('location', { href: 'https://192.168.0.169:5174/', protocol: 'https:' });
    vi.stubGlobal('document', { getElementById: () => ({
      textContent: JSON.stringify({ signalingUrl: 'wss://192.168.0.169:3002/signal' }),
    }) });
    expect(defaultSignalingUrl()).toBe('wss://192.168.0.169:3002/signal');
  });
  it('falls back safely when metadata is missing, malformed or insecure for HTTPS', () => {
    vi.stubGlobal('location', { href: 'https://192.168.0.169:5174/', protocol: 'https:' });
    for (const textContent of ['{}', 'broken', '{"signalingUrl":"ws://192.168.0.169:3002/signal"}',
      '{"signalingUrl":"wss://user:password@example.test/signal"}']) {
      vi.stubGlobal('document', { getElementById: () => ({ textContent }) });
      expect(defaultSignalingUrl()).toBe('wss://192.168.0.169:5174/signal');
    }
  });
  it('prioritizes Internet, deduplicates nodes and retains the local fallback', () => {
    expect(signalingEndpoints({ signalingUrl: 'wss://192.168.0.169:3002/signal',
      internetSignalingUrl: 'wss://chat.example/signal', lanSignalingUrl: 'wss://192.168.0.169:3002/signal' },
    'https://chat.example/')).toEqual([
      { kind: 'internet', url: 'wss://chat.example/signal' },
      { kind: 'lan', url: 'wss://192.168.0.169:3002/signal' },
    ]);
  });
  it('does not accept plaintext public nodes, credentials, tokens, or mislabeled endpoints', () => {
    for (const internetSignalingUrl of ['ws://chat.example/signal', 'wss://chat.example/signal?token=secret',
      'wss://user:password@chat.example/signal', 'wss://192.168.1.2/signal']) {
      expect(signalingEndpoints({ internetSignalingUrl, lanSignalingUrl: 'wss://tracker.example/signal' },
        'https://app.example/')).toEqual([{ kind: 'internet', url: 'wss://app.example/signal' }]);
    }
  });
  it('keeps loopback and LAN in one allowlisted plan for a local build', () => {
    expect(signalingEndpoints({ signalingUrl: 'ws://127.0.0.1:3001', lanSignalingUrl: 'wss://192.168.0.169:3002/signal' },
      'http://localhost:5173/').map((endpoint) => endpoint.kind)).toEqual(['lan', 'lan']);
  });
});
