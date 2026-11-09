import { afterEach, expect, it, vi } from 'vitest';
import { parseAdminConnect, approveAdminConnect } from './admin-connect';
import type { IdentityProvider } from '$lib/identity/identity';
import { encodeAccountId } from '$lib/addressing/bech32m.js';
const address=encodeAccountId(new Uint8Array(20));
const now = Date.now();
const url = `https://automesh.space/?nodeAdmin=${encodeURIComponent('https://node.automesh.space')}&nodeId=${'a'.repeat(32)}&ticket=${'b'.repeat(32)}&expiresAt=${now + 120000}`;
afterEach(() => vi.unstubAllGlobals());
it('only parses an explicit bounded public node request, without network or signatures', () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  expect(parseAdminConnect('https://automesh.space/', now)).toBeNull();
  expect(parseAdminConnect(url, now)?.url).toBe('https://node.automesh.space');
  expect(fetch).not.toHaveBeenCalled();
  for (const bad of [url + '&ticket=' + 'c'.repeat(32), url.replace('https%3A', 'http%3A'), url.replace('node.automesh.space', '192.168.0.1')])
    expect(() => parseAdminConnect(bad, now)).toThrow();
  expect(() => parseAdminConnect(url, now + 120001)).toThrow();
});
it('never contacts public nodes in LAN-only mode or signs with a locked profile', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const request = parseAdminConnect(url, now)!;
  await expect(approveAdminConnect(request, 'address', () => null, '', new AbortController().signal, true)).rejects.toThrow('internet_disabled');
  await expect(approveAdminConnect(request, 'address', () => null, '', new AbortController().signal)).rejects.toThrow('admin_connect_cancelled');
  expect(fetch).not.toHaveBeenCalled();
});
it.each(['before-sign', 'after-sign'])('does not submit approval if the profile changes %s', async stage => {
  const request = parseAdminConnect(url, now)!;
  let current: IdentityProvider | null;
  const sign = vi.fn(async () => { if (stage === 'after-sign') current = null; return new Uint8Array(64); });
  const identity = { getPublicKeyBytes: async () => { if (stage === 'before-sign') current = null; return new Uint8Array(65); }, sign } as unknown as IdentityProvider;
  current = identity;
  const fetch = vi.fn(async () => new Response(JSON.stringify({ nodeId: request.nodeId, challenge: 'c'.repeat(64) })));
  vi.stubGlobal('fetch', fetch);
  await expect(approveAdminConnect(request, address, () => current, '', new AbortController().signal)).rejects.toThrow('admin_connect_cancelled');
  expect(fetch).toHaveBeenCalledOnce();
  expect(sign).toHaveBeenCalledTimes(stage === 'before-sign' ? 0 : 1);
});
