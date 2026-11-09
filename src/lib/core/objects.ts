import type { IdentityProvider } from '../identity/identity';
import { accountIdFromPublicKey } from '../addressing/account-id.js';
import { isValidAccountId } from '../addressing/bech32m.js';
import { canonicalJson, jsonSnapshot, type JsonValue } from './canonical';
import { checkedTime, type CoreEnvironment } from './ports';

export const OBJECT_VERSION = 1;
export const OBJECT_KINDS = ['message', 'post', 'document', 'task', 'grant', 'revocation'] as const;
export type ObjectKind = typeof OBJECT_KINDS[number];
export interface ObjectRecord {
  version: 1;
  id: string;
  kind: ObjectKind;
  author: string;
  createdAt: number;
  expiresAt: number | null;
  audience: string[];
  body: JsonValue;
}
export interface SignedObject {
  record: ObjectRecord;
  publicKey: string;
  signature: string;
}
export interface ObjectDraft {
  kind: ObjectKind;
  body: JsonValue;
  audience: string[];
  expiresAt?: number | null;
}
export const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const FUTURE_SKEW_MS = 5 * 60_000;
const encoder = new TextEncoder();
const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
const bytes = (value: string) => new Uint8Array(value.match(/../g)!.map(pair => parseInt(pair, 16)));
const exactKeys = (value: object, keys: string[]) => {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every(key => actual.includes(key));
};

export function validateObjectRecord(value: unknown, now: number): asserts value is ObjectRecord {
  const item = value as ObjectRecord | null;
  if (!item || typeof item !== 'object' || Array.isArray(item) ||
      !exactKeys(item, ['version', 'id', 'kind', 'author', 'createdAt', 'expiresAt', 'audience', 'body']) ||
      item.version !== OBJECT_VERSION || !OBJECT_KINDS.includes(item.kind) || typeof item.id !== 'string' || !UUID_PATTERN.test(item.id) ||
      !isValidAccountId(item.author) || !Number.isSafeInteger(item.createdAt) || item.createdAt < 0 ||
      item.createdAt > now + FUTURE_SKEW_MS || (item.expiresAt !== null &&
        (!Number.isSafeInteger(item.expiresAt) || item.expiresAt <= item.createdAt || item.expiresAt <= now)) ||
      !Array.isArray(item.audience) || item.audience.length > 64 || item.audience.some(id => !isValidAccountId(id)) ||
      new Set(item.audience).size !== item.audience.length) throw new Error('invalid_core_object');
  canonicalJson(item);
}

function signingBytes(record: ObjectRecord): Uint8Array {
  return encoder.encode('Automesh signed object v1\0' + canonicalJson(record));
}

export async function signObject(draft: ObjectDraft, identity: IdentityProvider, environment: CoreEnvironment): Promise<SignedObject> {
  // A signed object is NOT encrypted. Never put private content in a public
  // store merely because this function signed it; use the encrypted transport.
  const input = jsonSnapshot(draft as unknown as JsonValue) as unknown as ObjectDraft;
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      !exactKeys(input, input.expiresAt === undefined ? ['kind', 'body', 'audience'] : ['kind', 'body', 'audience', 'expiresAt']))
    throw new Error('invalid_object_draft');
  const createdAt = checkedTime(environment.now);
  const id = environment.newId();
  const publicKey = (await identity.getPublicKeyBytes()).slice();
  const author = await accountIdFromPublicKey(publicKey, environment.subtle);
  const record: ObjectRecord = { version: 1, id, kind: input.kind, author, createdAt,
    expiresAt: input.expiresAt ?? null, audience: input.audience, body: input.body };
  validateObjectRecord(record, checkedTime(environment.now));
  // Check the COMPLETE serialized envelope before signing: key/signature and
  // the extra nesting level count toward the same size/complexity limits.
  canonicalJson({ record, publicKey: hex(publicKey), signature: '0'.repeat(128) });
  const signature = await identity.sign(signingBytes(record));
  const result = { record, publicKey: hex(publicKey), signature: hex(signature) };
  // Catch a misconfigured provider that returns a different public key/signature.
  return verifyObject(result, environment);
}

export async function verifyObject(value: unknown, environment: CoreEnvironment): Promise<SignedObject> {
  const snapshot = JSON.parse(canonicalJson(value)) as SignedObject;
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) ||
      !exactKeys(snapshot, ['record', 'publicKey', 'signature']) || typeof snapshot.publicKey !== 'string' ||
      !/^04[a-f0-9]{128}$/.test(snapshot.publicKey) || typeof snapshot.signature !== 'string' ||
      !/^[a-f0-9]{128}$/.test(snapshot.signature)) throw new Error('invalid_signed_object');
  validateObjectRecord(snapshot.record, checkedTime(environment.now));
  const publicKey = bytes(snapshot.publicKey);
  if (await accountIdFromPublicKey(publicKey, environment.subtle) !== snapshot.record.author) throw new Error('object_author_mismatch');
  const key = await environment.subtle.importKey('raw', publicKey.buffer as ArrayBuffer,
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  if (!await environment.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key,
    bytes(snapshot.signature).buffer as ArrayBuffer, signingBytes(snapshot.record).buffer as ArrayBuffer)) throw new Error('invalid_object_signature');
  validateObjectRecord(snapshot.record, checkedTime(environment.now));
  return snapshot;
}
