import { accountIdFromPublicKey } from './account-id.js';

export async function getAccountId(pubKeyHex: string): Promise<string> {
  if (!/^04[0-9a-fA-F]{128}$/.test(pubKeyHex)) throw new Error('invalid_public_key');
  const publicKey = new Uint8Array(pubKeyHex.match(/.{2}/g)!.map((pair) => Number.parseInt(pair, 16)));
  return accountIdFromPublicKey(publicKey);
}
