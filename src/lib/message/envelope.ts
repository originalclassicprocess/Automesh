import type { TransportMessage } from './types';
import type { IdentityProvider } from '../identity/identity';

export async function verify(
  data:      Uint8Array,
  signature: Uint8Array,
  publicKey: CryptoKey
): Promise<boolean> {
  try {
    return await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      toBuffer(signature),
      toBuffer(data)
    );
  } catch {
    return false;
  }
}

export async function exportPublicKeyFromProvider(
  provider: IdentityProvider
): Promise<Uint8Array> {
  return provider.getPublicKeyBytes();
}

export async function importPublicKey(bytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    toBuffer(bytes),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify']
  );
}

// ----------------------------------------------------------
// Payload helpers
// [2 bytes: pubkey length][pubkey bytes][text bytes]
// ----------------------------------------------------------

export function buildPayload(pubKeyBytes: Uint8Array, textBytes: Uint8Array): Uint8Array {
  const buf = new Uint8Array(2 + pubKeyBytes.byteLength + textBytes.byteLength);
  const view = new DataView(buf.buffer);
  view.setUint16(0, pubKeyBytes.byteLength, true);
  buf.set(pubKeyBytes, 2);
  buf.set(textBytes, 2 + pubKeyBytes.byteLength);
  return buf;
}

export function parsePayload(payload: Uint8Array): {
  pubKeyBytes: Uint8Array;
  textBytes:   Uint8Array;
} {
  if (payload.byteLength < 2) {
    throw new Error('payload_too_short');
  }

  const view      = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const pubKeyLen = view.getUint16(0, true);

  // WebCrypto raw P-256 public keys use the uncompressed 65-byte form.
  if (pubKeyLen !== 65 || 2 + pubKeyLen > payload.byteLength) {
    throw new Error('invalid_public_key_payload');
  }

  const pubKeyBytes = payload.slice(2, 2 + pubKeyLen);
  const textBytes   = payload.slice(2 + pubKeyLen);
  return { pubKeyBytes, textBytes };
}

// ----------------------------------------------------------
// Unambiguous, domain-separated signed envelope. The recipient is covered so a
// valid ciphertext cannot be redirected to a different account.
// ----------------------------------------------------------

export function buildSignInput(
  textBytes: Uint8Array,
  timestamp: number,
  messageId: string,
  from: string,
  to: string,
): Uint8Array {
  const metaBytes = new TextEncoder().encode(JSON.stringify(['MeshAutonomy signed envelope v2', from, to, timestamp, messageId]));
  const combined  = new Uint8Array(4 + metaBytes.byteLength + textBytes.byteLength);
  new DataView(combined.buffer).setUint32(0, metaBytes.byteLength);
  combined.set(metaBytes, 4);
  combined.set(textBytes, 4 + metaBytes.byteLength);
  return combined;
}

// ----------------------------------------------------------
// ID генерация
// ----------------------------------------------------------

export function generateId(): string {
  return crypto.randomUUID();
}

export function toBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength
  ) as ArrayBuffer;
}

export function isValidTransportMessage(msg: TransportMessage, now = Date.now()): boolean {
  return Boolean(
    msg &&
    typeof msg.to === 'string' &&
    msg.to.length > 0 &&
    msg.to.length <= 128 &&
    typeof msg.from === 'string' &&
    msg.from.length > 0 &&
    msg.from.length <= 128 &&
    msg.payload instanceof Uint8Array &&
    msg.signature instanceof Uint8Array &&
    msg.signature.byteLength > 0 &&
    msg.signature.byteLength <= 128 &&
    typeof msg.messageId === 'string' &&
    msg.messageId.length > 0 &&
    msg.messageId.length <= 128 &&
    Number.isSafeInteger(msg.timestamp) &&
    msg.timestamp >= 0 &&
    msg.timestamp <= now + 5 * 60_000 &&
    Number.isInteger(msg.ttl) &&
    msg.ttl >= 0 &&
    msg.ttl <= 64
  );
}
