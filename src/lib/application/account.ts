import { mnemonicToSeed } from '@scure/bip39';
import { deriveIdentitySeed } from '$lib/identity/namespace';
import { WebCryptoIdentity } from '$lib/identity/webcrypto';
import { getAccountId } from '$lib/addressing/address';
import { bytesToHex } from '$lib/message/encoding';

// Shared by creation, recovery and unlocking. Callers own identitySeed lifetime.
// Derivation and Account ID encoding must remain byte-for-byte compatible.
export async function accountFromMnemonic(mnemonic: string) {
  const master = await mnemonicToSeed(mnemonic);
  let identitySeed: Uint8Array | undefined;
  const provider = new WebCryptoIdentity();
  try {
    identitySeed = await deriveIdentitySeed(master);
    const result = await provider.fromSeed(identitySeed);
    const publicKey = bytesToHex(result.publicKey);
    return { provider, identitySeed, publicKey, accountId: await getAccountId(publicKey) };
  } catch (error) {
    provider.dispose();
    identitySeed?.fill(0);
    throw error;
  } finally { master.fill(0); }
}
