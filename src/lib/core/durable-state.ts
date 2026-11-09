import { isValidAccountId } from '../addressing/bech32m.js';
import { canonicalJson, jsonSnapshot, type JsonValue } from './canonical';
import { UUID_PATTERN } from './objects';
import { isValidResource } from './permissions';
import { MAX_REVOKED_GRANTS, policyUpdateJson, validateAnchor, type PolicyAnchor, type PolicyStore, type PolicyUpdate } from './policy-store';
import { checkedTime, type CoreEnvironment, type ReplayStore } from './ports';

export const CORE_STATE_MAX_BYTES = 2 * 1024 * 1024;
export interface SealedCoreRecord {
  schema: 1;
  revision: number;
  iv: Uint8Array;
  cipher: ArrayBuffer;
}
// A driver must atomically compare revision and commit the new encrypted value.
// Success means TRANSACTION COMMITTED, not just that a put request succeeded.
export interface CoreRecordStore {
  read(scope: string): Promise<SealedCoreRecord | undefined>;
  compareAndSwap(scope: string, revision: number | null, next: SealedCoreRecord): Promise<boolean>;
}
interface SavedPolicy extends PolicyUpdate { digest: string | null }
interface DurableState {
  schema: 1;
  lastNow: number;
  claims: Array<[string, number]>;
  policies: SavedPolicy[];
}
export interface DurableCoreOptions {
  scope: string;
  key: CryptoKey;
  records: CoreRecordStore;
  environment: CoreEnvironment;
  randomBytes: (length: number) => Uint8Array;
  claimCapacity?: number;
  policyCapacity?: number;
}
const encoder = new TextEncoder();
const exact = (value: object, fields: string[]) => Object.keys(value).length === fields.length && fields.every(k => Object.hasOwn(value, k));
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
function validateState(value: unknown, scope: string): asserts value is DurableState {
  const state = value as DurableState | null;
  if (!state || typeof state !== 'object' || !exact(state, ['schema', 'lastNow', 'claims', 'policies']) || state.schema !== 1 ||
      !integer(state.lastNow) || !Array.isArray(state.claims) || state.claims.length > 10000 ||
      state.claims.some(c => !Array.isArray(c) || c.length !== 2 || typeof c[0] !== 'string' || !c[0].length || c[0].length > 512 || !integer(c[1])) ||
      new Set(state.claims.map(c => c[0])).size !== state.claims.length || !Array.isArray(state.policies) || state.policies.length > 128)
    throw new Error('core_state_corrupt');
  const seen = new Set<string>();
  for (const p of state.policies) {
    if (!p || typeof p !== 'object' || !exact(p, ['issuer', 'recipient', 'resource', 'epoch', 'validUntil', 'sequence', 'revoked', 'digest']) ||
        !isValidAccountId(p.issuer) || p.recipient !== scope || !isValidResource(p.resource) || !integer(p.epoch) ||
        !integer(p.validUntil) || !integer(p.sequence) || !Array.isArray(p.revoked) || p.revoked.length > MAX_REVOKED_GRANTS ||
        p.revoked.some(id => typeof id !== 'string' || !UUID_PATTERN.test(id)) || new Set(p.revoked).size !== p.revoked.length ||
        (p.sequence === 0 ? p.digest !== null || p.revoked.length !== 0 : typeof p.digest !== 'string' || !/^[a-f0-9]{64}$/.test(p.digest)))
      throw new Error('core_state_corrupt');
    const id = JSON.stringify([p.issuer, p.resource]);
    if (seen.has(id)) throw new Error('core_state_corrupt'); seen.add(id);
  }
}
function aad(scope: string, revision: number): Uint8Array<ArrayBuffer> {
  return encoder.encode(JSON.stringify(['Automesh encrypted core state v1', scope, revision]));
}
export function validateSealedCoreRecord(record: SealedCoreRecord): void {
  if (!record || !exact(record, ['schema', 'revision', 'iv', 'cipher']) || record.schema !== 1 ||
      !integer(record.revision) || record.revision < 1 || !(record.iv instanceof Uint8Array) || record.iv.length !== 12 ||
      !(record.cipher instanceof ArrayBuffer) || record.cipher.byteLength < 16 || record.cipher.byteLength > CORE_STATE_MAX_BYTES + 16)
    throw new Error('core_state_corrupt');
}

export function createDurableCoreState(options: DurableCoreOptions) {
  const { scope, records, randomBytes } = options;
  const environment = { ...options.environment };
  const claimCapacity = options.claimCapacity ?? 4096, policyCapacity = options.policyCapacity ?? 64;
  if (!isValidAccountId(scope) || !integer(claimCapacity) || claimCapacity < 1 || claimCapacity > 10000 ||
      !integer(policyCapacity) || policyCapacity < 1 || policyCapacity > 128 || typeof randomBytes !== 'function' ||
      !options.key || options.key.type !== 'secret' || options.key.extractable || options.key.algorithm.name !== 'AES-GCM' ||
      (options.key.algorithm as AesKeyAlgorithm).length !== 256 || !options.key.usages.includes('encrypt') || !options.key.usages.includes('decrypt'))
    throw new Error('invalid_durable_core_options');
  let key: CryptoKey | null = options.key;
  const requireOpen = () => { if (!key) throw new Error('core_state_closed'); return key; };
  const load = async () => {
    const cryptoKey = requireOpen();
    const entry = await records.read(scope);
    requireOpen();
    if (!entry) return { revision: null, state: { schema: 1, lastNow: 0, claims: [], policies: [] } as DurableState };
    validateSealedCoreRecord(entry);
    // Do not retain mutable driver buffers across asynchronous decryption.
    const revision = entry.revision, iv = entry.iv.slice(), cipher = entry.cipher.slice(0);
    const plain = new Uint8Array(await environment.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad(scope, revision) }, cryptoKey, cipher));
    try {
      requireOpen();
      const state = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain)) as unknown;
      validateState(state, scope); return { revision, state };
    } finally { plain.fill(0); }
  };
  const mutate = async <T>(change: (state: DurableState, now: number) => T): Promise<T> => {
    // Bounded optimistic retries. Never drop old claims/policy to resolve a race.
    for (let attempt = 0; attempt < 16; attempt++) {
      const { revision, state } = await load();
      const now = Math.max(state.lastNow, checkedTime(environment.now));
      state.lastNow = now;
      const result = change(state, now);
      validateState(state, scope);
      const nextRevision = (revision ?? 0) + 1;
      if (!Number.isSafeInteger(nextRevision)) throw new Error('core_state_revision_exhausted');
      const plain = encoder.encode(JSON.stringify(state));
      if (plain.length > CORE_STATE_MAX_BYTES) { plain.fill(0); throw new Error('core_state_size_limit'); }
      let next: SealedCoreRecord;
      try {
        const random = randomBytes(12);
        if (!(random instanceof Uint8Array) || random.length !== 12) throw new Error('invalid_core_random');
        const iv = new Uint8Array(random);
        next = { schema: 1, revision: nextRevision, iv, cipher: await environment.subtle.encrypt(
          { name: 'AES-GCM', iv, additionalData: aad(scope, nextRevision) }, requireOpen(), plain) };
      } finally { plain.fill(0); }
      requireOpen();
      if (await records.compareAndSwap(scope, revision, next)) { requireOpen(); return result; }
    }
    throw new Error('core_state_contention');
  };
  const find = (state: DurableState, issuer: string, resource: string) => state.policies.find(p => p.issuer === issuer && p.resource === resource);
  const replayStore: ReplayStore = {
    async claim(id, expiresAt, submittedNow) {
      if (typeof id !== 'string' || !id.length || id.length > 512 || !integer(expiresAt) || !integer(submittedNow) || expiresAt <= submittedNow)
        throw new Error('invalid_replay_claim');
      const result = await mutate((state, time) => {
        const now = Math.max(time, submittedNow); state.lastNow = now;
        if (expiresAt <= now) throw new Error('invalid_replay_claim');
        state.claims = state.claims.filter(c => c[1] > now);
        if (state.claims.some(c => c[0] === id)) return false;
        if (state.claims.length >= claimCapacity) throw new Error('replay_capacity');
        state.claims.push([id, expiresAt]); return true;
      });
      if (expiresAt <= checkedTime(environment.now)) throw new Error('invalid_replay_claim');
      return result;
    },
  };
  const policyStore: PolicyStore = {
    async initialize(anchor) {
      const item = jsonSnapshot(anchor as unknown as JsonValue) as unknown as PolicyAnchor;
      if (!item || typeof item !== 'object' || !exact(item, ['issuer', 'recipient', 'resource', 'epoch', 'validUntil'])) throw new Error('invalid_policy');
      await mutate((state, now) => {
        validateAnchor(item, now);
        if (item.recipient !== scope) throw new Error('policy_scope_mismatch');
        if (find(state, item.issuer, item.resource)) throw new Error('policy_already_initialized');
        if (state.policies.length >= policyCapacity) throw new Error('policy_capacity');
        state.policies.push({ ...item, sequence: 0, revoked: [], digest: null });
      });
    },
    async read(issuer, resource) {
      if (!isValidAccountId(issuer) || !isValidResource(resource)) throw new Error('invalid_permission_policy');
      const result = await mutate((state, now) => {
        const p = find(state, issuer, resource);
        // Persist the observed clock even when denying a stale/missing policy.
        if (!p || p.validUntil <= now) return null;
        return { epoch: p.epoch, validUntil: p.validUntil };
      });
      if (!result || result.validUntil <= checkedTime(environment.now)) throw new Error('policy_unavailable');
      return result;
    },
    async apply(update) {
      const input = policyUpdateJson(update, checkedTime(environment.now)) as unknown as PolicyUpdate;
      const hash = new Uint8Array(await environment.subtle.digest('SHA-256',
        encoder.encode('Automesh policy update v1\0' + canonicalJson(input))));
      requireOpen();
      const digest = Array.from(hash, b => b.toString(16).padStart(2, '0')).join('');
      await mutate((state, now) => {
        validateAnchor(input, now);
        const p = find(state, input.issuer, input.resource);
        if (!p || input.recipient !== scope) throw new Error('policy_unavailable');
        if (input.epoch < p.epoch || input.sequence < p.sequence) throw new Error('stale_policy_update');
        if (input.sequence === p.sequence) {
          if (digest !== p.digest) throw new Error('conflicting_policy_update');
          return; // Idempotent retry, including ECDSA signature malleability.
        }
        const revoked = [...new Set([...(input.epoch === p.epoch ? p.revoked : []), ...input.revoked])];
        if (revoked.length > MAX_REVOKED_GRANTS) throw new Error('policy_revocation_capacity');
        Object.assign(p, input, { revoked, digest });
      });
    },
    async isRevoked(issuer, resource, epoch, grantId) {
      if (!isValidAccountId(issuer) || !isValidResource(resource) || !integer(epoch) || typeof grantId !== 'string' || !UUID_PATTERN.test(grantId))
        throw new Error('invalid_permission_policy');
      const result = await mutate((state, now) => {
        const p = find(state, issuer, resource);
        return { denied: !p || p.validUntil <= now || p.epoch !== epoch || p.revoked.includes(grantId), validUntil: p?.validUntil ?? 0 };
      });
      return result.denied || result.validUntil <= checkedTime(environment.now);
    },
  };
  return Object.freeze({ replayStore: Object.freeze(replayStore), policyStore: Object.freeze(policyStore),
    close: () => { key = null; } });
}
