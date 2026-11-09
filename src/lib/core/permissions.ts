import { isValidAccountId } from '../addressing/bech32m.js';
import { jsonSnapshot, type JsonValue } from './canonical';
import { verifyObject, type SignedObject } from './objects';
import { checkedTime, type CoreEnvironment } from './ports';

export const PERMISSION_ACTIONS = ['read', 'write', 'publish', 'deliver', 'execute'] as const;
export type PermissionAction = typeof PERMISSION_ACTIONS[number];
export const isValidResource = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-z][a-z0-9.-]{0,31}:[A-Za-z0-9._:/-]{1,256}$/.test(value);
export interface GrantBody {
  subject: string;
  resource: string;
  actions: PermissionAction[];
  notBefore: number;
  epoch: number;
  canDelegate: false;
}
export interface PermissionContext {
  // These values MUST come from the resource's trusted local policy, not the
  // requesting object's issuer, epoch, claimed role or another untrusted input.
  issuer: string;
  subject: string;
  resource: string;
  action: PermissionAction;
  epoch: number;
  isRevoked: (issuer: string, grantId: string) => Promise<boolean>;
}

export function validateGrantBody(value: unknown): asserts value is GrantBody {
  const body = value as GrantBody | null;
  const keys = ['subject', 'resource', 'actions', 'notBefore', 'epoch', 'canDelegate'];
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== keys.length ||
      !keys.every(key => Object.hasOwn(body, key)) || !isValidAccountId(body.subject) ||
      !isValidResource(body.resource) ||
      !Array.isArray(body.actions) || !body.actions.length || body.actions.length > PERMISSION_ACTIONS.length ||
      body.actions.some(action => !PERMISSION_ACTIONS.includes(action)) || new Set(body.actions).size !== body.actions.length ||
      !Number.isSafeInteger(body.notBefore) || body.notBefore < 0 || !Number.isSafeInteger(body.epoch) || body.epoch < 0 ||
      body.canDelegate !== false) throw new Error('invalid_grant');
}

export async function authorizeGrant(value: unknown, context: PermissionContext, environment: CoreEnvironment): Promise<SignedObject> {
  const { issuer, subject, resource, action, epoch, isRevoked } = context;
  if (!isValidAccountId(issuer) || !isValidAccountId(subject) || !PERMISSION_ACTIONS.includes(action) ||
      !Number.isSafeInteger(epoch) || epoch < 0 || typeof isRevoked !== 'function') throw new Error('invalid_permission_policy');
  const grant = await verifyObject(value, environment);
  if (grant.record.kind !== 'grant') throw new Error('permission_denied');
  validateGrantBody(grant.record.body);
  const body = grant.record.body as unknown as GrantBody;
  if (grant.record.author !== issuer || body.subject !== subject || body.resource !== resource ||
      !body.actions.includes(action) || body.epoch !== epoch || grant.record.expiresAt === null ||
      body.notBefore >= grant.record.expiresAt || body.notBefore > checkedTime(environment.now) ||
      grant.record.audience.length !== 1 || grant.record.audience[0] !== subject) throw new Error('permission_denied');
  // Indeterminate/unavailable revocation state fails closed; boolean false is
  // the only successful result. A signed revocation still needs a policy store.
  const revoked = await isRevoked(issuer, grant.record.id);
  const now = checkedTime(environment.now);
  if (revoked !== false || grant.record.expiresAt <= now || body.notBefore > now)
    throw new Error('permission_denied');
  return grant;
}

export function grantJson(body: GrantBody): JsonValue {
  const snapshot = jsonSnapshot(body as unknown as JsonValue) as unknown as GrantBody;
  validateGrantBody(snapshot);
  return { subject: snapshot.subject, resource: snapshot.resource, actions: [...snapshot.actions],
    notBefore: snapshot.notBefore, epoch: snapshot.epoch, canDelegate: false };
}
