import { WebCryptoIdentity } from '../../../src/lib/identity/webcrypto';
import { accountIdFromPublicKey } from '../../../src/lib/addressing/account-id.js';
export { isValidAccountId } from '../../../src/lib/addressing/bech32m.js';

export async function senderIdentity(seed: Uint8Array) {
  const provider = new WebCryptoIdentity();
  const { publicKey } = await provider.fromSeed(seed);
  const address = await accountIdFromPublicKey(publicKey);
  return { address, provider };
}
