import { isValidAccountId } from '../addressing/bech32m.js';

// Separate HKDF purpose from chat history, vault, transport and offline keys.
// This is an adapter concern: the portable core receives only a CryptoKey.
export async function deriveCoreStorageKey(seed: Uint8Array, accountId: string, subtle: SubtleCrypto = crypto.subtle): Promise<CryptoKey> {
  if (!(seed instanceof Uint8Array) || seed.length !== 32 || !isValidAccountId(accountId)) throw new Error('invalid_core_key_input');
  const input = new Uint8Array(seed);
  let material: CryptoKey;
  try { material = await subtle.importKey('raw', input, 'HKDF', false, ['deriveKey']); }
  finally { input.fill(0); }
  const encoder = new TextEncoder();
  return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256',
    salt: encoder.encode('Automesh core state key v1'), info: encoder.encode(accountId) },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
