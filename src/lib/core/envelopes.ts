import { accountIdFromPublicKey } from '../addressing/account-id.js';
import { isValidAccountId } from '../addressing/bech32m.js';
import { buildSignInput, isValidTransportMessage, parsePayload } from '../message/envelope';
import type { TransportMessage } from '../message/types';
import { checkedTime, type CoreEnvironment } from './ports';

export interface VerifiedEnvelope {
  readonly from: string;
  readonly to: string;
  readonly messageId: string;
  readonly timestamp: number;
  readonly publicKey: Uint8Array;
  readonly encryptedFrame: Uint8Array;
}

// Legacy envelope v2 bytes stay unchanged. Authentication is not authorization
// or decryption: the caller must still pass the frame through SecureSessions.
export async function verifySignedEnvelope(message: TransportMessage, recipient: string,
  environment: CoreEnvironment, maxPayloadBytes = 256 * 1024): Promise<VerifiedEnvelope> {
  if (!Number.isSafeInteger(maxPayloadBytes) || maxPayloadBytes < 67 || maxPayloadBytes > 256 * 1024 ||
      !isValidAccountId(recipient) || !isValidTransportMessage(message, checkedTime(environment.now)) ||
      !isValidAccountId(message.from) || message.to !== recipient || message.signature.length !== 64 ||
      message.payload.length > maxPayloadBytes) throw new Error('invalid_signed_envelope');
  // Copy all input before awaiting crypto to prevent in-flight mutation.
  const from = message.from, to = message.to, timestamp = message.timestamp, id = message.messageId;
  const signature = message.signature.slice();
  const { pubKeyBytes, textBytes } = parsePayload(message.payload);
  if (await accountIdFromPublicKey(pubKeyBytes, environment.subtle) !== from) throw new Error('envelope_author_mismatch');
  const key = await environment.subtle.importKey('raw', pubKeyBytes.slice().buffer,
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const valid = await environment.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key,
    signature.buffer, buildSignInput(textBytes, timestamp, id, from, to).buffer as ArrayBuffer);
  if (!valid) throw new Error('invalid_envelope_signature');
  return { from, to, messageId: id, timestamp, publicKey: pubKeyBytes, encryptedFrame: textBytes };
}
