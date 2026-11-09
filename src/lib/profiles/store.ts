import { canonicalJson } from '../core/canonical';
import { profileRegistrySnapshot, type ProfileRegistry } from '../core/profiles';
import { validateSealedCoreRecord, type CoreRecordStore } from '../core/durable-state';
import { isValidAccountId } from '../addressing/bech32m.js';

// Separate registry namespace/key/AAD; never share the core replay record.
export function createProfileRegistryStore(options: {
  scope: string; key: CryptoKey; records: CoreRecordStore; subtle: SubtleCrypto;
  randomBytes(size: number): Uint8Array; guard(): void; now(): number;
}) {
  const { scope, records, subtle, randomBytes, guard } = options;
  let key: CryptoKey | undefined = options.key, closed = false;
  if (!isValidAccountId(scope) || key.type !== 'secret' || key.extractable ||
      key.algorithm.name !== 'AES-GCM' || (key.algorithm as AesKeyAlgorithm).length !== 256 ||
      !key.usages.includes('encrypt') || !key.usages.includes('decrypt')) throw new Error('invalid_profile_storage_key');
  const requireOpen = () => { if (closed || !key) throw new Error('profile_store_closed'); guard(); };
  const aad = (revision: number) => new TextEncoder().encode(JSON.stringify(['Automesh private profile registry v1', scope, revision]));
  const read = async () => {
    requireOpen(); const value = await records.read(scope); requireOpen();
    if (!value) return { revision: null, registry: undefined };
    validateSealedCoreRecord(value);
    const iv = value.iv.slice(), cipher = value.cipher.slice(0);
    const plaintext = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad(value.revision) }, key!, cipher));
    try {
      requireOpen();
      if (plaintext.length > 64 * 1024) throw new Error('profile_registry_size_limit');
      return { revision: value.revision, registry: profileRegistrySnapshot(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext))) };
    } finally { plaintext.fill(0); }
  };
  const change = async (mutate: (value: ProfileRegistry | undefined) => ProfileRegistry | Promise<ProfileRegistry>) => {
    for (let retry = 0; retry < 16; retry++) {
      const current = await read(), now = options.now();
      if (!Number.isSafeInteger(now) || now < 0) throw new Error('invalid_profile_time');
      if (current.registry) current.registry.lastNow = Math.max(current.registry.lastNow, now);
      const registry = profileRegistrySnapshot(await mutate(current.registry)); requireOpen();
      registry.lastNow = Math.max(registry.lastNow, current.registry?.lastNow ?? 0, now);
      const revision = (current.revision ?? 0) + 1;
      if (!Number.isSafeInteger(revision)) throw new Error('profile_revision_exhausted');
      const iv = randomBytes(12).slice();
      if (iv.length !== 12) throw new Error('invalid_profile_random');
      const plaintext = new TextEncoder().encode(canonicalJson(registry));
      let cipher: ArrayBuffer;
      try { cipher = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(revision) }, key!, plaintext); }
      finally { plaintext.fill(0); }
      requireOpen();
      if (await records.compareAndSwap(scope, current.revision, { schema: 1, revision, iv, cipher })) {
        requireOpen(); return registry;
      }
      requireOpen();
    }
    throw new Error('profile_storage_contention');
  };
  return Object.freeze({
    // Persist observed time even on reads, preventing expired grants from
    // reviving after an ordinary backwards wall-clock adjustment.
    read: async () => {
      if (!(await read()).registry) return undefined;
      return change(value => { if (!value) throw new Error('profile_registry_missing'); return value; });
    },
    // Callbacks may run again after a CAS race. They must have no external effects.
    change,
    initialize: (initial: ProfileRegistry) => {
      const saved = profileRegistrySnapshot(initial);
      return change(value => value ?? saved);
    },
    close: () => { closed = true; key = undefined; },
  });
}
