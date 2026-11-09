import { describe, expect, it } from 'vitest';
import { parsePairInvite, parseNodeSetup } from './pair-invite';
describe('short-lived node pairing QR', () => {
  const now = 1000000, invite = { protocol: 'automesh-node-pair-v1', url: 'https://192.168.1.5:3003/', nodeId: 'a'.repeat(32), code: 'b'.repeat(32), expiresAt: now + 600000 };
  it('normalizes explicit LAN and public HTTPS origins without changing ports', () => {
    expect(parsePairInvite(JSON.stringify(invite), now)).toEqual({ ...invite, url: 'https://192.168.1.5:3003' });
    expect(parsePairInvite(JSON.stringify({ ...invite, url: 'https://node.automesh.space/' }), now).url).toBe('https://node.automesh.space');
  });
  it('accepts either node QR or HTTPS address while keeping authorization separate', () => {
    expect(parseNodeSetup('wss://192.168.1.5:3003/signal')).toEqual({ url: 'https://192.168.1.5:3003', code: '', nodeId: '' });
    expect(parseNodeSetup('https://192.168.1.5:3003/')).toEqual({ url: 'https://192.168.1.5:3003', code: '', nodeId: '' });
    expect(parseNodeSetup(JSON.stringify({ type: 'mesh-local-node', version: 1, url: 'wss://192.168.1.5:43003/signal' })).url).toBe('https://192.168.1.5:43003');
    expect(parseNodeSetup(JSON.stringify({ ...invite, expiresAt: Date.now() + 60000 })).code).toBe(invite.code);
    expect(parseNodeSetup('wss://node.automesh.space/signal').url).toBe('https://node.automesh.space');
    for (const value of ['wss://192.168.1.5:3003/evil', 'wss://192.168.1.5:3003/signal?token=secret',
      'ws://192.168.1.5:3003/signal', JSON.stringify(invite)]) expect(() => parseNodeSetup(value)).toThrow();
  });
  it('rejects unsafe URLs, expired codes, extra fields and malformed identifiers', () => {
    for (const change of [{ url: 'https://user:pass@node.automesh.space/' }, { url: 'http://192.168.1.5:3003/' },
      { url: 'https://192.168.1.5:3003/?code=secret' }, { expiresAt: now }, { expiresAt: now + 600001 },
      { code: '' }, { nodeId: 'bad' }, { adminToken: 'secret' }])
      expect(() => parsePairInvite(JSON.stringify({ ...invite, ...change }), now)).toThrow();
    expect(() => parsePairInvite('wss://192.168.1.5:3003/signal', now)).toThrow();
  });
});
