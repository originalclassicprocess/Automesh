import { describe, expect, it } from 'vitest';
import { audioFingerprint, callDigest, decodeCallSignal, encodeCallSignal, normalizeCallSignal, verificationCode } from './protocol';
import { testSdp } from './fixture';
describe('bounded authenticated call controls', () => {
  it('roundtrips known controls and strips untrusted extra identity fields', () => {
    const signal = { kind: 'invite' as const, id: crypto.randomUUID(), expires: Date.now() + 1000 };
    expect(decodeCallSignal(encodeCallSignal(signal))).toEqual(signal);
    expect(normalizeCallSignal({ ...signal, from: 'other' })).toEqual(signal);
    expect(decodeCallSignal('hello')).toBeNull();
    expect(decodeCallSignal('\u0000mesh-call-v1:{')).toBeNull();
  });
  it('rejects malformed, oversized and unknown inputs', () => {
    for (const value of [null, [], { kind: 'invite', id: 'bad', expires: 1 },
      { kind: 'answer', id: crypto.randomUUID(), sdp: 'x'.repeat(24001) },
      { kind: 'confirm', id: crypto.randomUUID(), digest: '00' },
      { kind: 'candidate', id: crypto.randomUUID(), candidate: { candidate: 'x', sdpMid: '0', sdpMLineIndex: -1 } },
      { kind: 'video', id: crypto.randomUUID() }]) expect(normalizeCallSignal(value)).toBeNull();
  });
  it('requires exactly one encrypted audio channel and a single SHA-256 fingerprint', () => {
    expect(audioFingerprint(testSdp())).toBe('aa'.repeat(32));
    for (const sdp of [testSdp().replace('UDP/TLS/RTP/SAVPF', 'RTP/AVP'), testSdp().replace('sha-256', 'sha-1'),
      testSdp().replace('audio 9', 'audio 0'), testSdp() + 'm=video 9 UDP/TLS/RTP/SAVPF 96\r\n',
      testSdp() + `a=fingerprint:sha-256 ${Array(32).fill('BB').join(':')}\r\n`, testSdp() + 'a=crypto:1 fake\r\n']) {
      expect(() => audioFingerprint(sdp)).toThrow('call_security');
    }
  });
  it('binds full descriptions, accounts, roles and invite; displays 128-bit comparison', async () => {
    const value = { id: crypto.randomUUID(), expires: 100, caller: 'alice', callee: 'bob', offer: testSdp(), answer: testSdp('BB') };
    const digest = await callDigest(value);
    expect(verificationCode(digest).replaceAll(' ', '')).toHaveLength(32);
    expect(await callDigest({ ...value })).toBe(digest);
    for (const changed of [{ ...value, expires: 101 }, { ...value, caller: 'bob', callee: 'alice' },
      { ...value, id: crypto.randomUUID() }, { ...value, answer: testSdp('CC') }, { ...value, offer: value.offer + 'a=sendrecv\r\n' }]) {
      expect(await callDigest(changed)).not.toBe(digest);
    }
  });
});
