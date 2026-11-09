import { isValidAccountId } from '../addressing/bech32m.js';
import { canonicalJson, jsonSnapshot, type JsonValue } from './canonical';
import { UUID_PATTERN } from './objects';
import { isValidResource, type PermissionAction } from './permissions';

export const MAX_POLICY_LIFETIME_MS = 7 * 86400000;
export const MAX_REVOKED_GRANTS = 1024;
export interface PolicyAnchor {
  issuer: string;
  recipient: string;
  resource: string;
  epoch: number;
  validUntil: number;
}
export interface PolicyUpdate extends PolicyAnchor {
  sequence: number;
  revoked: string[];
}
export interface StoredPermissionContext {
  issuer: string;
  subject: string;
  resource: string;
  action: PermissionAction;
}
export interface RevocationContext {
  issuer: string;
  recipient: string;
  resource: string;
}
// Host-owned adapter; initialize is an explicit local trust decision. Never
// bootstrap an unknown resource merely from a network object's claimed owner.
export interface PolicyStore {
  initialize(anchor: PolicyAnchor): Promise<void>;
  read(issuer: string, resource: string): Promise<{ epoch: number; validUntil: number }>;
  apply(update: PolicyUpdate): Promise<void>;
  isRevoked(issuer: string, resource: string, epoch: number, grantId: string): Promise<boolean>;
}
export function validateAnchor(value: unknown, now: number): asserts value is PolicyAnchor {
  const item = value as PolicyAnchor | null;
  if (!item || typeof item !== 'object' || Array.isArray(item) ||
      !isValidAccountId(item.issuer) || !isValidAccountId(item.recipient) || !isValidResource(item.resource) ||
      !Number.isSafeInteger(item.epoch) || item.epoch < 0 || !Number.isSafeInteger(item.validUntil) ||
      item.validUntil <= now || item.validUntil > now + MAX_POLICY_LIFETIME_MS) throw new Error('invalid_policy');
}
export function policyUpdateJson(value: PolicyUpdate, now: number): JsonValue {
  const item = jsonSnapshot(value as unknown as JsonValue) as unknown as PolicyUpdate;
  validateAnchor(item, now);
  const fields = ['issuer', 'recipient', 'resource', 'epoch', 'validUntil', 'sequence', 'revoked'];
  if (Object.keys(item).length !== fields.length || !fields.every(key => Object.hasOwn(item, key)) ||
      !Number.isSafeInteger(item.sequence) || item.sequence < 1 || !Array.isArray(item.revoked) ||
      item.revoked.length > MAX_REVOKED_GRANTS || item.revoked.some(id => typeof id !== 'string' || !UUID_PATTERN.test(id)) ||
      new Set(item.revoked).size !== item.revoked.length) throw new Error('invalid_policy_update');
  // Bound the standalone policy body as well as its signed envelope.
  canonicalJson(item);
  return item as unknown as JsonValue;
}
