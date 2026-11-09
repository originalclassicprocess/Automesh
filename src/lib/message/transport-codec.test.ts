import { describe, expect, it } from 'vitest';
import { decodeMessage, encodeMessage } from './transport-codec';
import { buildPayload, buildSignInput, parsePayload } from './envelope';
import type { TransportMessage } from './types';

const message: TransportMessage = { to: 'recipient', from: 'sender', timestamp: 123, messageId: 'id', ttl: 7,
  signature: new Uint8Array([0, 128, 255]), payload: new Uint8Array([1, 2, 3]) };
function rawHeader(header: unknown): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(header));
  const bytes = new Uint8Array(4 + json.length);
  new DataView(bytes.buffer).setUint32(0, json.length, true); bytes.set(json, 4); return bytes;
}
describe('shared wire format', () => {
  it('retains exact header field order, byte order and opaque payload', () => {
    const encoded = new Uint8Array(encodeMessage(message));
    const header = rawHeader({ to: 'recipient', from: 'sender', timestamp: 123, messageId: 'id', ttl: 7, signature: [0, 128, 255] });
    expect(encoded).toEqual(new Uint8Array([...header, 1, 2, 3]));
    expect(decodeMessage(encoded)).toEqual(message);
    const padded = new Uint8Array(encoded.length + 10); padded.set(encoded, 5);
    expect(decodeMessage(padded.subarray(5, -5))).toEqual(message);
  });
  it('rejects truncation and invalid signature bytes instead of coercing them', () => {
    for (const signature of [[], [256], [-1], [1.5], ['1'], [null], new Array(129).fill(1)]) {
      expect(() => decodeMessage(rawHeader({ signature }))).toThrow('invalid_signature');
    }
    expect(() => decodeMessage(rawHeader(null))).toThrow('invalid_signature');
    expect(() => decodeMessage(new Uint8Array(3))).toThrow('message_too_short');
    expect(() => decodeMessage(new Uint8Array([255, 255, 255, 255]))).toThrow('invalid_header_length');
  });
  it('preserves signed envelope v2 and rejects malformed key payloads', () => {
    const body = new Uint8Array([1, 2, 3]); const key = new Uint8Array(65).fill(4);
    expect(parsePayload(buildPayload(key, body))).toEqual({ pubKeyBytes: key, textBytes: body });
    expect(() => parsePayload(buildPayload(new Uint8Array(32), body))).toThrow('invalid_public_key_payload');
    const signed = buildSignInput(body, 123, 'id', 'sender', 'recipient');
    const metadata = new TextEncoder().encode('["MeshAutonomy signed envelope v2","sender","recipient",123,"id"]');
    expect(new DataView(signed.buffer).getUint32(0)).toBe(metadata.length);
    expect(signed.slice(4)).toEqual(new Uint8Array([...metadata, ...body]));
  });
  it('rejects invalid scalar fields instead of returning an ambiguous message', () => {
    const header = { ...message, signature: [1] };
    for (const change of [{ to: '' }, { from: 1 }, { timestamp: -1 }, { timestamp: 1.5 },
      { timestamp: Number.MAX_SAFE_INTEGER + 1 }, { messageId: [] }, { ttl: 65 }, { ttl: 1.5 }])
      expect(() => decodeMessage(rawHeader({ ...header, ...change }))).toThrow('invalid_message');
  });
  it('rejects invalid UTF-8 and oversized payloads before making a copy', () => {
    const badUtf8 = new Uint8Array([1, 0, 0, 0, 255]);
    expect(() => decodeMessage(badUtf8)).toThrow();
    const header = rawHeader({ ...message, signature: [1] });
    const large = new Uint8Array(header.length + 256 * 1024 + 1); large.set(header);
    expect(() => decodeMessage(large)).toThrow('message_size_limit');
    expect(() => encodeMessage({ ...message, payload: new Uint8Array(256 * 1024 + 1) })).toThrow('invalid_message');
  });
});
