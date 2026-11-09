export async function derivePrivateKeyBytes(
  seed: Uint8Array
): Promise<Uint8Array> {

  const seedBuffer = seed.buffer.slice(
    seed.byteOffset,
    seed.byteOffset + seed.byteLength
  ) as ArrayBuffer;

  const hash = await crypto.subtle.digest(
    'SHA-256',
    seedBuffer
  );

  return new Uint8Array(hash);
}
