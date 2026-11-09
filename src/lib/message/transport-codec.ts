import type { TransportMessage } from './types';
import { isValidTransportMessage } from './envelope';

const MAX_HEADER_BYTES = 16 * 1024;
const MAX_PAYLOAD_BYTES = 256 * 1024;

// [uint32 LE header length][UTF-8 JSON header][opaque payload]
export function encodeMessage(msg: TransportMessage): ArrayBuffer {
  // Codec checks structure only; crypto/recipient checks happen in the core.
  if (!isValidTransportMessage(msg, Number.MAX_SAFE_INTEGER) || msg.payload.byteLength > MAX_PAYLOAD_BYTES)
    throw new Error('invalid_message');
  const header = {
    to: msg.to, from: msg.from, timestamp: msg.timestamp,
    messageId: msg.messageId, ttl: msg.ttl,
    signature: Array.from(msg.signature),
  };
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  if (headerBytes.byteLength > MAX_HEADER_BYTES) throw new Error('invalid_header_length');
  const buffer = new ArrayBuffer(4 + headerBytes.byteLength + msg.payload.byteLength);
  const view = new DataView(buffer);
  view.setUint32(0, headerBytes.byteLength, true);
  new Uint8Array(buffer, 4, headerBytes.byteLength).set(headerBytes);
  new Uint8Array(buffer, 4 + headerBytes.byteLength).set(msg.payload);
  return buffer;
}

export function decodeMessage(data: Uint8Array): TransportMessage {
  if (data.byteLength < 4) throw new Error('message_too_short');

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const headerLen = view.getUint32(0, true);

  if (headerLen === 0 || headerLen > MAX_HEADER_BYTES || headerLen > data.byteLength - 4) {
    throw new Error('invalid_header_length');
  }

  if (data.byteLength - 4 - headerLen > MAX_PAYLOAD_BYTES) throw new Error('message_size_limit');
  const headerBytes = data.subarray(4, 4 + headerLen);
  const header = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(headerBytes));

  if (!header || typeof header !== 'object' || Array.isArray(header) ||
      !Array.isArray(header.signature) || header.signature.length === 0 || header.signature.length > 128 ||
      !header.signature.every((byte: unknown) => typeof byte === 'number' && Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
    throw new Error('invalid_signature');
  }

  const payload = data.slice(4 + headerLen);
  const message: TransportMessage = {
    to: header.to, from: header.from, timestamp: header.timestamp,
    messageId: header.messageId, ttl: header.ttl,
    signature: new Uint8Array(header.signature), payload,
  };
  if (!isValidTransportMessage(message, Number.MAX_SAFE_INTEGER)) throw new Error('invalid_message');
  return message;
}
