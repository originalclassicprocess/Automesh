import { isValidAccountId } from '../addressing/bech32m.js';
import { validateSealedCoreRecord, type CoreRecordStore, type SealedCoreRecord } from '../core/durable-state';

export const CORE_DATABASE_NAME = 'automesh-core-state-v1';
const STORE = 'profiles';

function openDatabase(factory: IDBFactory, guard: () => void): Promise<IDBDatabase> {
  guard();
  return new Promise((resolve, reject) => {
    let failed = false;
    const request = factory.open(CORE_DATABASE_NAME, 1);
    const fail = (error: unknown) => { failed = true; reject(error); };
    request.onupgradeneeded = () => {
      try {
        guard();
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      } catch (error) { request.transaction?.abort(); fail(error); }
    };
    request.onblocked = () => fail(new Error('core_storage_blocked'));
    request.onerror = () => fail(request.error ?? new Error('core_storage_open_failed'));
    request.onsuccess = () => {
      const db = request.result;
      if (failed) { db.close(); return; }
      try { guard(); } catch (error) { db.close(); fail(error); return; }
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
}

// Crypto runs outside the transaction. A short read/write transaction compares
// the current revision and writes atomically; promises resolve ONLY on commit.
export function createIndexedDbCoreRecords(factory: IDBFactory, guard: () => void): CoreRecordStore & { close(): void } {
  if (!factory || typeof factory.open !== 'function') throw new Error('core_storage_unavailable');
  let closed = false;
  const requireOpen = () => { if (closed) throw new Error('core_storage_closed'); guard(); };
  const validateScope = (scope: string) => { if (!isValidAccountId(scope)) throw new Error('invalid_core_scope'); };
  return Object.freeze({
    async read(scope: string) {
      requireOpen(); validateScope(scope);
      const db = await openDatabase(factory, requireOpen);
      try {
        requireOpen();
        return await new Promise<SealedCoreRecord | undefined>((resolve, reject) => {
          const transaction = db.transaction(STORE, 'readonly');
          let result: SealedCoreRecord | undefined, failure: unknown;
          const request = transaction.objectStore(STORE).get(scope);
          request.onsuccess = () => {
            try {
              requireOpen(); result = request.result;
              if (result !== undefined) validateSealedCoreRecord(result);
            } catch (error) { failure = error; transaction.abort(); }
          };
          transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('core_storage_read_failed'));
          transaction.oncomplete = () => {
            try { requireOpen(); resolve(result); } catch (error) { reject(error); }
          };
        });
      } finally { db.close(); }
    },
    async compareAndSwap(scope: string, revision: number | null, next: SealedCoreRecord) {
      requireOpen(); validateScope(scope); validateSealedCoreRecord(next);
      if (revision !== null && (!Number.isSafeInteger(revision) || revision < 1) || next.revision !== (revision ?? 0) + 1)
        throw new Error('invalid_core_revision');
      // Snapshot before opening the database; the caller cannot mutate queued writes.
      const saved: SealedCoreRecord = { schema: 1, revision: next.revision, iv: new Uint8Array(next.iv), cipher: next.cipher.slice(0) };
      const db = await openDatabase(factory, requireOpen);
      try {
        requireOpen();
        return await new Promise<boolean>((resolve, reject) => {
          const transaction = db.transaction(STORE, 'readwrite', { durability: 'strict' });
          let matched = false, failure: unknown;
          const store = transaction.objectStore(STORE), request = store.get(scope);
          request.onsuccess = () => {
            try {
              requireOpen();
              const current = request.result as SealedCoreRecord | undefined;
              if (current !== undefined) validateSealedCoreRecord(current);
              if ((current?.revision ?? null) !== revision) return;
              store.put(saved, scope); matched = true;
            } catch (error) { failure = error; transaction.abort(); }
          };
          transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('core_storage_write_failed'));
          transaction.oncomplete = () => {
            try { requireOpen(); resolve(matched); } catch (error) { reject(error); }
          };
        });
      } finally { db.close(); }
    },
    close: () => { closed = true; },
  });
}

// Erasure is deliberately independent of a now-invalidated session/epoch.
// Clear, rather than deleteDatabase, so another tab cannot block erasure by
// retaining an open database handle. IndexedDB serializes this with old writes.
export async function clearAllCoreStorage(factory: IDBFactory = globalThis.indexedDB): Promise<void> {
  if (!factory) throw new Error('core_storage_unavailable');
  const db = await openDatabase(factory, () => {});
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite', { durability: 'strict' });
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error ?? new Error('core_storage_clear_failed'));
      transaction.objectStore(STORE).clear();
    });
  } finally { db.close(); }
}
