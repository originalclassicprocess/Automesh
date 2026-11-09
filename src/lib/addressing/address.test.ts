import { describe, expect, it } from 'vitest';
import { getAccountId } from './address';
import { decodeAccountId, encodeAccountId, isValidAccountId } from './bech32m.js';
import { WebCryptoIdentity } from '$lib/identity/webcrypto';
import { bytesToHex } from '$lib/message/encoding';

describe('MeshAutonomy account IDs', () => {
  it('has a fixed v1 encoding vector and detects edits', () => {
    const id = encodeAccountId(new Uint8Array(20).fill(1));
    expect(id).toBe('mesh1qyqszqgpqyqszqgpqyqszqgpqyqszqgpqyhjxl32');
    expect(decodeAccountId(id)).toEqual(new Uint8Array(20).fill(1));
    expect(isValidAccountId(id.replace('hjxl32', 'hjxl33'))).toBe(false);
    expect(isValidAccountId(id.toUpperCase())).toBe(false);
    expect(isValidAccountId('r8svjWXnVFG16jVZJdTGUSfzifqY8Pcsq')).toBe(false);
  });

  it('derives the same ID from the same public key and distinguishes another key', async () => {
    const first = new WebCryptoIdentity();
    const second = new WebCryptoIdentity();
    const seed1 = new Uint8Array(32);
    const seed2 = new Uint8Array(32);
    seed1[31] = 1;
    seed2[31] = 2;
    const key1 = bytesToHex((await first.fromSeed(seed1)).publicKey);
    const key2 = bytesToHex((await second.fromSeed(seed2)).publicKey);
    const id1 = await getAccountId(key1);
    expect(id1).toBe('mesh1qxnhrv2f9p8ev4jyyqq9jsjw7pfwsurctgzfczmf');
    expect(id1).toBe(await getAccountId(key1));
    expect(id1).not.toBe(await getAccountId(key2));
    expect(isValidAccountId(id1)).toBe(true);
  });

  it('handles the rare invalid P-256 scalar without losing determinism', async () => {
    const seed = new Uint8Array(32);
    const first = new WebCryptoIdentity();
    const second = new WebCryptoIdentity();
    const firstKey = bytesToHex((await first.fromSeed(seed)).publicKey);
    const secondKey = bytesToHex((await second.fromSeed(seed)).publicKey);
    expect(firstKey).toBe(secondKey);
    expect(isValidAccountId(await getAccountId(firstKey))).toBe(true);
  });
});
