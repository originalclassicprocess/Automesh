import type { IdentityProvider } from '../identity/identity';
import type { TransportMessage } from '../message/types';
import { isValidAccountId } from '../addressing/bech32m.js';
import type { JsonValue } from './canonical';
import { verifySignedEnvelope } from './envelopes';
import { signObject, verifyObject, type ObjectDraft, type ObjectKind } from './objects';
import { authorizeGrant, grantJson, type GrantBody, type PermissionContext } from './permissions';
import { checkedTime, webCryptoEnvironment, type CoreEnvironment, type ReplayStore } from './ports';
import { policyUpdateJson, type PolicyStore, type PolicyUpdate, type StoredPermissionContext, type RevocationContext } from './policy-store';

export const CORE_API_VERSION = 1;
export interface CoreOptions {
  environment?: CoreEnvironment;
  identity?: IdentityProvider;
  replayStore?: ReplayStore;
  policyStore?: PolicyStore;
}
export interface AcceptPolicy {
  author: string;
  recipient: string;
  kind: ObjectKind;
}

// Trusted host API, not a plugin sandbox or an HTTP server. Only the host
// receives the identity provider. Untrusted modules require mediated grants.
export function createCore(options: CoreOptions = {}) {
  const source = options.environment ?? webCryptoEnvironment();
  const environment = Object.freeze({ subtle: source.subtle, now: source.now, newId: source.newId });
  const identity = options.identity;
  const replay = options.replayStore;
  const policies = options.policyStore;
  let closed = false, generation = 0;
  const requireOpen = () => { if (closed) throw new Error('core_closed'); };
  const run = async <T>(work: () => Promise<T>): Promise<T> => {
    requireOpen(); const current = generation;
    const result = await work();
    if (closed || current !== generation) throw new Error('core_closed');
    return result;
  };
  const requireSigner = (): IdentityProvider => {
    requireOpen(); if (!identity) throw new Error('core_read_only');
    // Check again at each provider boundary, not only at the API call. A close
    // during getPublicKeyBytes must never start a later signing operation.
    return {
      create: () => { throw new Error('identity_creation_not_available'); },
      fromSeed: () => { throw new Error('identity_creation_not_available'); },
      verify: (data, signature) => run(() => identity.verify(data, signature)),
      getPublicKeyBytes: () => run(() => identity.getPublicKeyBytes()),
      sign: (data) => run(() => identity.sign(data)),
    };
  };
  return Object.freeze({
    version: CORE_API_VERSION,
    signObject: (draft: ObjectDraft) => run(() => signObject(draft, requireSigner(), environment)),
    verifyObject: (value: unknown) => run(() => verifyObject(value, environment)),
    issueGrant: (body: GrantBody, expiresAt: number) => run(() => {
      const snapshot = grantJson(body) as unknown as GrantBody;
      if (!Number.isSafeInteger(expiresAt) || snapshot.notBefore >= expiresAt) throw new Error('invalid_grant');
      return signObject({ kind: 'grant', body: snapshot as unknown as JsonValue,
        audience: [snapshot.subject], expiresAt }, requireSigner(), environment);
    }),
    authorize: (value: unknown, policy: PermissionContext) => run(() => authorizeGrant(value, policy, environment)),
    authorizeStored: (value: unknown, expected: StoredPermissionContext) => {
      const { issuer, subject, resource, action } = expected;
      return run(async () => {
        if (!policies) throw new Error('policy_store_required');
        const state = await policies.read(issuer, resource);
        requireOpen();
        return authorizeGrant(value, { issuer, subject, resource, action, epoch: state.epoch,
          isRevoked: (owner, id) => { requireOpen(); return policies.isRevoked(owner, resource, state.epoch, id); } }, environment);
      });
    },
    issueRevocation: (update: PolicyUpdate) => run(async () => {
      const body = policyUpdateJson(update, checkedTime(environment.now)) as unknown as PolicyUpdate;
      const object = await signObject({ kind: 'revocation', body: body as unknown as JsonValue,
        audience: [body.recipient], expiresAt: body.validUntil }, requireSigner(), environment);
      if (object.record.author !== body.issuer) throw new Error('policy_update_not_authorized');
      return object;
    }),
    applyRevocation: (value: unknown, expected: RevocationContext) => {
      const { issuer, recipient, resource } = expected;
      return run(async () => {
        if (!policies) throw new Error('policy_store_required');
        const object = await verifyObject(value, environment);
        if (object.record.kind !== 'revocation') throw new Error('invalid_policy_update');
        const body = policyUpdateJson(object.record.body as unknown as PolicyUpdate, checkedTime(environment.now)) as unknown as PolicyUpdate;
        if (object.record.author !== issuer || body.issuer !== issuer || body.resource !== resource || body.recipient !== recipient ||
            object.record.expiresAt !== body.validUntil || object.record.audience.length !== 1 || object.record.audience[0] !== recipient)
          throw new Error('policy_update_not_authorized');
        requireOpen();
        await policies.apply(body);
        if (body.validUntil <= checkedTime(environment.now)) throw new Error('policy_unavailable');
        return object;
      });
    },
    verifyEnvelope: (message: TransportMessage, recipient: string, maxPayloadBytes?: number) =>
      run(() => verifySignedEnvelope(message, recipient, environment, maxPayloadBytes)),
    acceptOnce: (value: unknown, policy: AcceptPolicy) => {
      // Snapshot trusted execution policy before asynchronous verification.
      const { author, recipient, kind } = policy;
      return run(async () => {
        if (!replay) throw new Error('replay_store_required');
        if (!isValidAccountId(author) || !isValidAccountId(recipient)) throw new Error('invalid_accept_policy');
        const object = await verifyObject(value, environment);
        const record = object.record;
        const now = checkedTime(environment.now);
        if (record.author !== author || record.kind !== kind || !record.audience.includes(recipient) ||
            record.expiresAt === null || record.expiresAt > now + 7 * 86400000) throw new Error('object_not_accepted');
        requireOpen();
        if (!await replay.claim(JSON.stringify([recipient, author, kind, record.id]), record.expiresAt, now)) throw new Error('object_replay');
        if (record.expiresAt <= checkedTime(environment.now)) throw new Error('object_not_accepted');
        return object;
      });
    },
    close: () => { if (!closed) { closed = true; generation++; } },
  });
}
export type AutomeshCore = ReturnType<typeof createCore>;
