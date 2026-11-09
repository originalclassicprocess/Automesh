const encoder = new TextEncoder();

function toBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength
  ) as ArrayBuffer;
}

function concatBytes(
  a: Uint8Array,
  b: Uint8Array
): Uint8Array {

  const out = new Uint8Array(
    a.length + b.length
  );

  out.set(a, 0);
  out.set(b, a.length);

  return out;
}

export const IDENTITY_NAMESPACE =
  'mesh/identity/v1';

export async function sha256(
  data: Uint8Array
): Promise<Uint8Array> {

  const input = toBuffer(data);
  try {
    return new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', input));
  } finally { new Uint8Array(input).fill(0); }
}

export async function deriveNamespaceSeed(
  masterSeed: Uint8Array,
  namespace: string
): Promise<Uint8Array> {

  const namespaceBytes =
    encoder.encode(namespace);

  const combined =
    concatBytes(
      masterSeed,
      namespaceBytes
    );

  try { return await sha256(combined); }
  finally { combined.fill(0); }
}

export async function deriveIdentitySeed(
  masterSeed: Uint8Array
): Promise<Uint8Array> {

  return await deriveNamespaceSeed(
    masterSeed,
    IDENTITY_NAMESPACE
  );
}
