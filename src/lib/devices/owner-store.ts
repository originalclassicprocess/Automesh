import { canonicalJson } from '../core/canonical';
import { validateSealedCoreRecord, type CoreRecordStore, type SealedCoreRecord } from '../core/durable-state';
import { checkedTime, MemoryReplayStore, type CoreEnvironment } from '../core/ports';
import { UUID_PATTERN, signObject, type SignedObject } from '../core/objects';
import type { IdentityProvider } from '../identity/identity';
import { accountIdFromPublicKey } from '../addressing/account-id.js';
import { approveDeviceRequest, deviceComparisonCode, deviceRequestDigest, verifyDeviceRequest } from './enrollment';
import { MEMBERSHIP_TYPE, MAX_DEVICE_RECORDS, signMembership, verifyMembership, memberDevice, memberLabel,
  type MembershipBody, type DirectoryAuthority } from './membership';
import { DEVICE_DIRECTORY } from '../../../nodes/packages/protocol/src/devices.js';

const encoder = new TextEncoder();
type State = { schema: 1; lastNow: number; roster: SignedObject };
export type OwnerDeviceStore = ReturnType<typeof createOwnerDeviceStore>;
export function createOwnerDeviceStore(options: { owner: string; signer: IdentityProvider; key: CryptoKey;
  records: CoreRecordStore; environment: CoreEnvironment; guard(): void }) {
  const { owner, signer, records } = options, environment = { ...options.environment };
  let key: CryptoKey | null = options.key;
  if (key.type !== 'secret' || key.extractable || key.algorithm.name !== 'AES-GCM' ||
    (key.algorithm as AesKeyAlgorithm).length !== 256 || !key.usages.includes('encrypt') || !key.usages.includes('decrypt'))
    throw new Error('invalid_device_owner_key');
  const guard = () => { if (!key) throw new Error('device_owner_closed'); options.guard(); };
  const aad = (revision: number) => encoder.encode(canonicalJson(['Automesh owner devices prototype v1', owner, revision]));
  const empty = (): MembershipBody => ({ type: MEMBERSHIP_TYPE, sequence: 0, previous: null, epoch: 0, primary: false, devices: [] });
  async function load() {
    guard(); const entry = await records.read(owner); guard();
    if (!entry) return { revision: null, state: null, body: empty(), digest: null };
    validateSealedCoreRecord(entry);
    if (entry.cipher.byteLength > 65536) throw new Error('device_owner_corrupt');
    const plain = new Uint8Array(await environment.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(entry.iv),
      additionalData: aad(entry.revision) }, key!, entry.cipher.slice(0)));
    try {
      guard(); const state = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain)) as State;
      if (!state || Object.keys(state).sort().join(',') !== 'lastNow,roster,schema' || state.schema !== 1 ||
        !Number.isSafeInteger(state.lastNow) || state.lastNow < 0 || state.lastNow < state.roster?.record?.createdAt) throw new Error('device_owner_corrupt');
      const verified = await verifyMembership(state.roster, { owner, sequence: 0, digest: null, revoked: [] },
        { ...environment, now: () => state.roster.record.createdAt }); guard();
      return { revision: entry.revision, state, body: verified.body, digest: verified.anchor.digest };
    } finally { plain.fill(0); }
  }
  async function change<T>(work: (body: MembershipBody, now: number) => Promise<T>, beforeCommit: (result: T) => void = () => {}, refresh = false) {
    // Both device approval and signed roster are committed atomically. A lost
    // reply returns the identical stored certificate on retry, never a new grant.
    for (let retry = 0; retry < 16; retry++) {
      guard(); if (await accountIdFromPublicKey(await signer.getPublicKeyBytes(), environment.subtle) !== owner) throw new Error('device_owner_mismatch');
      const loaded = await load(), now = Math.max(loaded.state?.lastNow ?? 0, checkedTime(environment.now));
      const body = loaded.body, before = canonicalJson(body);
      const result = await work(body, now); guard();
      let roster = loaded.state?.roster;
      if (refresh || !roster || canonicalJson(body) !== before || roster.record.expiresAt! <= now) {
        body.sequence++; body.previous = loaded.digest;
        if (!Number.isSafeInteger(body.sequence)) throw new Error('device_sequence_exhausted');
        roster = await signMembership(body, signer, { ...environment, now: () => now }); guard();
      }
      await verifyMembership(roster, { owner, sequence: 0, digest: null, revoked: [] }, { ...environment, now: () => now }); guard();
      const revision = (loaded.revision ?? 0) + 1, iv = crypto.getRandomValues(new Uint8Array(12));
      const plain = encoder.encode(canonicalJson({ schema: 1, lastNow: now, roster }));
      let next: SealedCoreRecord;
      try { next = { schema: 1, revision, iv, cipher: await environment.subtle.encrypt({ name: 'AES-GCM', iv,
        additionalData: aad(revision) }, key!, plain) }; } finally { plain.fill(0); }
      guard(); beforeCommit(result);
      if (await records.compareAndSwap(owner, loaded.revision, next)) { guard(); return result; }
    }
    throw new Error('device_owner_contention');
  }
  return Object.freeze({
    async list() {
      await change(async () => {}); const loaded = await load();
      const now = Math.max(loaded.state!.lastNow, checkedTime(environment.now));
      return loaded.body.devices.map(m => ({ id: m.certificate.record.id, device: memberDevice(m), label: memberLabel(m),
        issuedAt: m.certificate.record.createdAt, expiresAt: m.certificate.record.expiresAt!, revokedAt: m.revokedAt,
        status: m.revokedAt !== null ? 'revoked' as const : m.certificate.record.expiresAt! <= now ? 'expired' as const : 'authorized' as const }));
    },
    async approve(value: unknown, confirmation: { approved: boolean; comparisonCode: string }) {
      const captured = JSON.parse(canonicalJson(value)) as SignedObject, approved = confirmation.approved, code = confirmation.comparisonCode;
      if (approved !== true) throw new Error('device_confirmation_required');
      const result = await change(async (body, now) => {
        const seen = body.devices.find(m => (m.certificate.record.body as Record<string, unknown>).requestId === captured.record?.id);
        const env = { ...environment, now: () => seen ? captured.record.createdAt : now };
        const request = await verifyDeviceRequest(captured, env), digest = await deviceRequestDigest(request, env);
        if (request.record.createdAt > now || code !== await deviceComparisonCode(owner, request, env)) throw new Error('device_comparison_mismatch');
        if (seen) {
          if ((seen.certificate.record.body as Record<string, unknown>).requestHash !== digest || seen.revokedAt !== null || seen.certificate.record.expiresAt! <= now)
            throw new Error('device_request_conflict');
          return { certificate: seen.certificate, deadline: null };
        }
        if (body.devices.length >= MAX_DEVICE_RECORDS || body.devices.some(m => memberDevice(m) === request.record.author)) throw new Error('device_capacity_or_duplicate');
        const certificate = await approveDeviceRequest(request, signer, { owner, epoch: 0, expiresAt: now + 30 * 86400000, approved: true },
          { ...environment, now: () => now }, new MemoryReplayStore());
        body.devices.push({ certificate, revokedAt: null }); return { certificate, deadline: request.record.expiresAt };
      }, result => { if (result.deadline !== null && result.deadline <= checkedTime(environment.now)) throw new Error('device_request_expired'); });
      return result.certificate;
    },
    async revoke(id: string, confirmed: boolean) {
      if (!UUID_PATTERN.test(id) || confirmed !== true) throw new Error('device_confirmation_required');
      await change(async (body, now) => {
        const member = body.devices.find(m => m.certificate.record.id === id);
        if (!member) throw new Error('device_not_found');
        member.revokedAt ??= now;
      });
    },
    async renew(id: string, confirmed: boolean) {
      if (!UUID_PATTERN.test(id) || confirmed !== true) throw new Error('device_confirmation_required');
      await change(async (body, now) => {
        const member = body.devices.find(m => m.certificate.record.id === id);
        if (!member || member.revokedAt !== null) throw new Error('device_not_found_or_revoked');
        member.certificate = await signObject({ kind: 'document', audience: member.certificate.record.audience,
          body: member.certificate.record.body, expiresAt: now + 30 * 86400000 }, signer, { ...environment, now: () => now, newId: () => id });
      });
    },
    async publish() {
      // Fresh signed snapshot, bounded validity. Renewal advances sequence.
      await change(async () => {}, () => {}, true);
      return (await load()).state!.roster;
    },
    async snapshot() { return (await load()).state?.roster ?? null; },
    async adoptPublished(value: unknown) {
      const captured = JSON.parse(canonicalJson(value)) as SignedObject;
      const issued = captured?.record?.createdAt;
      if (!Number.isSafeInteger(issued) || issued > checkedTime(environment.now)) throw new Error('device_membership_denied');
      const historical = { ...environment, now: () => issued };
      const verified = await verifyMembership(captured, { owner, sequence: 0, digest: null, revoked: [] }, historical); guard();
      for (let retry = 0; retry < 16; retry++) {
        const loaded = await load();
        if (loaded.state) {
          if (loaded.body.sequence >= verified.body.sequence) return;
          await verifyMembership(captured, { owner, sequence: loaded.body.sequence, digest: loaded.digest,
            revoked: loaded.body.devices.filter(m => m.revokedAt !== null).map(m => m.certificate.record.id) }, historical); guard();
        }
        const revision = (loaded.revision ?? 0) + 1, iv = crypto.getRandomValues(new Uint8Array(12));
        const plain = encoder.encode(canonicalJson({ schema: 1, lastNow: checkedTime(environment.now), roster: captured }));
        let cipher: ArrayBuffer;
        try { cipher = await environment.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(revision) }, key!, plain); }
        finally { plain.fill(0); }
        guard(); if (await records.compareAndSwap(owner, loaded.revision, { schema: 1, revision, iv, cipher })) { guard(); return; }
      }
      throw new Error('device_owner_contention');
    },
    async setPrimaryEnabled(enabled: boolean, confirmed: boolean) {
      if (typeof enabled !== 'boolean' || confirmed !== true) throw new Error('device_confirmation_required');
      await change(async body => { body.primary = enabled; });
    },
    async bindDirectory(authority: DirectoryAuthority, confirmed: boolean) {
      if (confirmed !== true) throw new Error('device_confirmation_required');
      const directory = JSON.parse(canonicalJson(authority)) as DirectoryAuthority;
      await change(async body => {
        if (body.directory && canonicalJson(body.directory) !== canonicalJson(directory)) throw new Error('device_directory_migration_required');
        body.directory = directory; body.type = DEVICE_DIRECTORY;
      });
    },
    close() { key = null; }
  });
}
