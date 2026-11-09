import { describe, expect, it } from 'vitest';
import { mnemonicToSeed } from '@scure/bip39';
import { deriveIdentitySeed } from '$lib/identity/namespace';
import { WebCryptoIdentity } from '$lib/identity/webcrypto';
import { getAccountId } from '$lib/addressing/address';
import { bytesToHex } from '$lib/message/encoding';
import { accountFromMnemonic } from './account';

describe('shared account derivation', () => {
  it('preserves previous IDs, public keys and signatures for the same phrase', async () => {
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const master = await mnemonicToSeed(mnemonic); const seed = await deriveIdentitySeed(master);
    const previous = new WebCryptoIdentity(); const identity = await previous.fromSeed(seed);
    const current = await accountFromMnemonic(mnemonic);
    // Captured from the pre-fix PKCS#8 implementation, not recalculated
    // through the current provider: both paths must retain this identity.
    expect(current.publicKey).toBe('049fad46969e10b410217dfb0c5b406296b03731fbf2d55d25cdcc3e3faba93c6ec4baeca37b77c50a06156230bd855a72851cc6b28ac704e7f15b75cbca8b4b60');
    expect(current.accountId).toBe('mesh1q93lgc7ekj058ysfcfev89jcqnzceh4hps85cz4m');
    expect(current.identitySeed).toEqual(seed);
    expect(current.publicKey).toBe(bytesToHex(identity.publicKey));
    expect(current.accountId).toBe(await getAccountId(bytesToHex(identity.publicKey)));
    const message = new Uint8Array([1, 2, 3]);
    expect(await previous.verify(message, await current.provider.sign(message))).toBe(true);
    master.fill(0); seed.fill(0); current.identitySeed.fill(0); previous.dispose(); current.provider.dispose();
  });
});
