import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebCryptoIdentity } from './webcrypto';

const scalar = () => { const bytes = new Uint8Array(32); bytes[31] = 1; return bytes; };
afterEach(() => vi.restoreAllMocks());

describe('identity secret lifetime', () => {
  it('does not retain the seed or return/export the private key', async () => {
    const imports = vi.spyOn(crypto.subtle, 'importKey');
    const exports = vi.spyOn(crypto.subtle, 'exportKey');
    const identity = new WebCryptoIdentity();
    const seed = scalar();
    const result = await identity.fromSeed(seed);
    expect(Object.keys(result)).toEqual(['publicKey']);
    expect(identity).not.toHaveProperty('seed');
    expect(imports.mock.calls.find(call => call[0] === 'pkcs8')?.[3]).toBe(false);
    expect(exports).not.toHaveBeenCalled();
    expect(seed[31]).toBe(1); // Caller's input remains caller-owned.
    const keys = (identity as unknown as { keyPair: CryptoKeyPair }).keyPair;
    await expect(crypto.subtle.exportKey('pkcs8', keys.privateKey)).rejects.toThrow();
    identity.dispose();
    await expect(identity.sign(new Uint8Array([1]))).rejects.toThrow('identity_not_initialized');
  });

  it('does not resurrect a key when initialization finishes after dispose', async () => {
    const original = crypto.subtle.importKey.bind(crypto.subtle);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(crypto.subtle, 'importKey').mockImplementation(async (...args: Parameters<SubtleCrypto['importKey']>) => {
      await gate;
      return original(...args);
    });
    const identity = new WebCryptoIdentity();
    const pending = identity.fromSeed(scalar());
    const rejected = expect(pending).rejects.toThrow('identity_disposed');
    identity.dispose(); release();
    await rejected;
    await expect(identity.sign(new Uint8Array([1]))).rejects.toThrow();
  });

  it('does not return an in-flight signature after disposal', async () => {
    const identity = new WebCryptoIdentity();
    await identity.fromSeed(scalar());
    const original = crypto.subtle.sign.bind(crypto.subtle);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(crypto.subtle, 'sign').mockImplementation(async (...args) => { await gate; return original(...args); });
    const pending = identity.sign(new Uint8Array([1]));
    const rejected = expect(pending).rejects.toThrow('identity_disposed');
    identity.dispose(); release();
    await rejected;
  });
});
