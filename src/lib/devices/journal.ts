import { CORE_DATABASE_NAME, createIndexedDbCoreRecords, clearAllCoreStorage } from '../core-storage/indexeddb';
import { validateSealedCoreRecord, type CoreRecordStore, type SealedCoreRecord } from '../core/durable-state';
import { requireStorageEpoch, storageEpoch } from '../application/storage-reset';
export const DEVICE_DATABASES = { delivery: 'automesh-device-delivery-v2', mail: 'automesh-device-mail-v2' } as const;
export function deviceRecords(kind: keyof typeof DEVICE_DATABASES, guard: () => void, factory: IDBFactory = indexedDB) {
  const epoch = storageEpoch();
  return createIndexedDbCoreRecords({ open(name: string, version?: number) {
    if (name !== CORE_DATABASE_NAME) throw new Error('device_storage_scope'); return factory.open(DEVICE_DATABASES[kind], version);
  } } as IDBFactory, () => { requireStorageEpoch(epoch); guard(); });
}
export async function clearDeviceJournals(factory: IDBFactory = indexedDB) {
  for (const database of Object.values(DEVICE_DATABASES)) await clearAllCoreStorage({ open: (_: string, version?: number) => factory.open(database, version) } as IDBFactory);
}
export function encryptedDeviceJournal<T>(options: { scope: string; purpose: string; key: CryptoKey; records: CoreRecordStore;
  initial(): T; validate(state: T): void; guard(): void }) {
  let key: CryptoKey | null = options.key;
  if (key.type !== 'secret' || key.extractable || key.algorithm.name !== 'AES-GCM' ||
    (key.algorithm as AesKeyAlgorithm).length !== 256 || !key.usages.includes('encrypt') || !key.usages.includes('decrypt')) throw new Error('device_journal_key');
  const guard = () => { options.guard(); if (!key) throw new Error('device_journal_closed'); };
  const aad = (revision: number) => new TextEncoder().encode(JSON.stringify(['Automesh device journal v2', options.purpose, options.scope, revision]));
  async function load() {
    guard(); const sealed = await options.records.read(options.scope); guard();
    if (!sealed) return { revision: null, state: options.initial() };
    validateSealedCoreRecord(sealed); if (sealed.cipher.byteLength > 1024 * 1024 + 16) throw new Error('device_journal_size');
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(sealed.iv), additionalData: aad(sealed.revision) }, key!, sealed.cipher.slice(0)));
    try { guard(); const state = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain)) as T; options.validate(state); return { revision: sealed.revision, state }; }
    finally { plain.fill(0); }
  }
  return Object.freeze({ read: async () => (await load()).state,
    async change<Result>(work: (state: T) => Result): Promise<Result> {
      for (let attempt = 0; attempt < 16; attempt++) {
        const { state, revision } = await load(), result = work(state); options.validate(state);
        const plain = new TextEncoder().encode(JSON.stringify(state)), nextRevision = (revision ?? 0) + 1;
        if (plain.length > 1024 * 1024 || !Number.isSafeInteger(nextRevision)) { plain.fill(0); throw new Error('device_journal_size'); }
        let next: SealedCoreRecord;
        try { const iv = crypto.getRandomValues(new Uint8Array(12)); next = { schema: 1, revision: nextRevision, iv,
          cipher: await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(nextRevision) }, key!, plain) }; }
        finally { plain.fill(0); }
        guard(); if (await options.records.compareAndSwap(options.scope, revision, next)) { guard(); return result; }
      }
      throw new Error('device_journal_contention');
    }, close() { key = null; }
  });
}
