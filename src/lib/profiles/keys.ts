// Versioned child identity derivation, NOT Bitcoin/BIP32. Roles/names never
// enter the path: renaming or changing a role must not change an address.
export const PROFILE_DERIVATION = 'automesh-profile-hkdf-p256-v1';
const encoder = new TextEncoder();
const order = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');

async function material(root: Uint8Array, subtle: SubtleCrypto): Promise<CryptoKey> {
  if (!(root instanceof Uint8Array) || root.length !== 32) throw new Error('invalid_profile_root');
  const copy = new Uint8Array(root);
  try { return await subtle.importKey('raw', copy.buffer, 'HKDF', false, ['deriveBits', 'deriveKey']); }
  finally { copy.fill(0); }
}

export async function deriveProfileSeed(root: Uint8Array, index: number, subtle: SubtleCrypto): Promise<Uint8Array> {
  if (!Number.isSafeInteger(index) || index < 0 || index > 0xffffffff) throw new Error('invalid_profile_index');
  const key = await material(root, subtle);
  for (let counter = 0; counter < 128; counter++) {
    const bytes = new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256',
      salt: encoder.encode('Automesh profile identity v1'),
      info: encoder.encode(JSON.stringify([PROFILE_DERIVATION, index, counter])) }, key, 256));
    let scalar = 0n;
    for (const byte of bytes) scalar = (scalar << 8n) | BigInt(byte);
    if (scalar > 0n && scalar < order) return bytes;
    bytes.fill(0);
  }
  throw new Error('profile_derivation_failed');
}

export async function deriveProfileRegistryKey(root: Uint8Array, scope: string, subtle: SubtleCrypto): Promise<CryptoKey> {
  if (!scope || scope.length > 128) throw new Error('invalid_profile_registry_scope');
  const key = await material(root, subtle);
  return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256',
    salt: encoder.encode('Automesh private profile registry v1'), info: encoder.encode(scope) },
    key, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function deriveProfileSelectionKey(root: Uint8Array, scope: string, subtle: SubtleCrypto): Promise<CryptoKey> {
  if (!scope || scope.length > 128) throw new Error('invalid_profile_selection_scope');
  return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256',
    salt: encoder.encode('Automesh private profile selection v1'), info: encoder.encode(scope) },
    await material(root, subtle), { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
