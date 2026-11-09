import { p256 } from '@noble/curves/nist.js';

function concat(...arrays: Uint8Array[]) {
  const total = arrays.reduce(
    (sum, arr) => sum + arr.length,
    0
  );

  const out = new Uint8Array(total);

  let offset = 0;

  for (const arr of arrays) {
    out.set(arr, offset);
    offset += arr.length;
  }

  return out;
}

export function buildP256PKCS8(
  privateKey: Uint8Array
): Uint8Array {
  // Apple WebKit's PKCS#8 importer requires the SEC1 publicKey field.
  // Compute Q = d*G from the existing scalar; do not generate another identity.
  const publicKey = p256.getPublicKey(privateKey, false);
  const pkcs8Header = new Uint8Array([
    0x30, 0x81, 0x87,
    0x02, 0x01, 0x00,
    0x30, 0x13,
    0x06, 0x07,
    0x2A, 0x86, 0x48,
    0xCE, 0x3D, 0x02,
    0x01,
    0x06, 0x08,
    0x2A, 0x86, 0x48,
    0xCE, 0x3D, 0x03,
    0x01, 0x07,
    0x04, 0x6D,
    0x30, 0x6B,
    0x02, 0x01, 0x01,
    0x04, 0x20
  ]);

  return concat(
    pkcs8Header,
    privateKey,
    // [1] EXPLICIT BIT STRING, zero unused bits, uncompressed P-256 point.
    new Uint8Array([0xA1, 0x44, 0x03, 0x42, 0x00]),
    publicKey
  );
}
