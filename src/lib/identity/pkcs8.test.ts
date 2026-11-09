import { describe, expect, it } from 'vitest';
import { buildP256PKCS8 } from './pkcs8';
import { WebCryptoIdentity } from './webcrypto';

// Frozen pre-fix encoding; accepted by Chromium/Node but missing Apple's
// required public point. Keep this fixture independent of the new builder.
const legacyHeader = new Uint8Array([
  0x30, 0x41, 0x02, 0x01, 0x00, 0x30, 0x13, 0x06, 0x07,
  0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
  0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07,
  0x04, 0x27, 0x30, 0x25, 0x02, 0x01, 0x01, 0x04, 0x20
]);
const curve = { name: 'ECDSA', namedCurve: 'P-256' };
const algorithm = { name: 'ECDSA', hash: 'SHA-256' };
const buffer = (bytes: Uint8Array) => bytes.slice().buffer as ArrayBuffer;

describe('Apple-compatible P-256 PKCS#8', () => {
  it('includes correctly sized SEC1 public point, identical to native P-256', async () => {
    const scalar = new Uint8Array(32); scalar[31] = 1;
    const original = scalar.slice();
    const encoded = buildP256PKCS8(scalar);
    const legacy = await crypto.subtle.importKey('pkcs8', buffer(new Uint8Array([...legacyHeader, ...scalar])), curve, true, ['sign']);
    const jwk = await crypto.subtle.exportKey('jwk', legacy);
    const native = await crypto.subtle.importKey('jwk', { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, curve, true, ['verify']);
    expect(encoded.length).toBe(138);
    expect([...encoded.slice(0, 3)]).toEqual([0x30, 0x81, 135]);
    expect([...encoded.slice(27, 35)]).toEqual([0x04, 109, 0x30, 107, 0x02, 1, 1, 0x04]);
    expect(encoded[35]).toBe(32);
    expect(encoded.slice(36, 68)).toEqual(scalar);
    expect([...encoded.slice(68, 73)]).toEqual([0xa1, 68, 0x03, 66, 0x00]);
    expect(encoded.slice(73)).toEqual(new Uint8Array(await crypto.subtle.exportKey('raw', native)));
    expect(scalar).toEqual(original);
  });

  it('preserves old public keys and signatures across multiple scalars', async () => {
    const scalars = [1, 2, 127, 255].map(value => {
      const key = new Uint8Array(32); key[31] = value; return key;
    });
    scalars.push(crypto.getRandomValues(new Uint8Array(32)));
    const message = new Uint8Array([10, 20, 30]);
    for (const scalar of scalars) {
      const old = await crypto.subtle.importKey('pkcs8', buffer(new Uint8Array([...legacyHeader, ...scalar])), curve, true, ['sign']);
      const jwk = await crypto.subtle.exportKey('jwk', old);
      const oldPublic = await crypto.subtle.importKey('jwk', { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, curve, true, ['verify']);
      const current = new WebCryptoIdentity();
      const identity = await current.fromSeed(scalar);
      expect(identity.publicKey).toEqual(new Uint8Array(await crypto.subtle.exportKey('raw', oldPublic)));
      expect(await crypto.subtle.verify(algorithm, oldPublic, buffer(await current.sign(message)), message)).toBe(true);
      expect(await current.verify(message, new Uint8Array(await crypto.subtle.sign(algorithm, old, message)))).toBe(true);
      expect(await current.verify(new Uint8Array([10, 20, 31]), await current.sign(message))).toBe(false);
      current.dispose();
    }
  });

  it('rejects invalid scalars rather than manufacturing another key', () => {
    for (const invalid of [new Uint8Array(31), new Uint8Array(33), new Uint8Array(32), new Uint8Array(32).fill(255)]) {
      expect(() => buildP256PKCS8(invalid)).toThrow();
    }
  });
});
