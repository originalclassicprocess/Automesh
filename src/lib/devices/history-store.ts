import { isValidAccountId } from '../addressing/bech32m.js';
import { sealChatData, openSealedChatData, sealLocalFileData, openSealedFileData, type LocalChatData, type SealedRecord, type SealedFileRecord } from '../chat/local-store';
import { sha256Hex } from '../chat/file-transfer';
import { mergeHistory, HISTORY_MAX_BYTES } from './history-data';
import { referencedBackupFiles, validateBackupProfiles, type BackupProfile } from '../backup/full-backup';
import { requireStorageEpoch, storageEpoch } from '../application/storage-reset';

export const HISTORY_DATABASE = 'automesh-device-history-v1';
type Saved = { device: string; owner: string; revision: number; bytes: number; count: number; data: SealedRecord };
async function open(factory: IDBFactory, guard: () => void) {
  guard(); return new Promise<IDBDatabase>((resolve, reject) => {
    let failed = false;
    const request = factory.open(HISTORY_DATABASE, 1);
    request.onupgradeneeded = () => {
      try { guard(); request.result.createObjectStore('history', { keyPath: 'device' });
        request.result.createObjectStore('files', { keyPath: 'key' }); }
      catch (error) { failed = true; request.transaction?.abort(); reject(error); }
    };
    request.onerror = () => reject(request.error ?? new Error('history_storage'));
    request.onblocked = () => { failed = true; reject(new Error('history_storage_blocked')); };
    request.onsuccess = () => { const db = request.result; db.onversionchange = () => db.close();
      if (failed) { db.close(); return; }
      try { guard(); resolve(db); } catch (error) { db.close(); reject(error); } };
  });
}
export function deviceHistoryStore(options: { device: string; owner: string; key: CryptoKey; guard(): void; factory?: IDBFactory }) {
  const epoch = storageEpoch(), factory = options.factory ?? indexedDB, scope = `Automesh historical device data v1:${options.device}:${options.owner}`;
  let closed = false, generation = 0;
  if (!isValidAccountId(options.owner) || !isValidAccountId(options.device) || options.owner === options.device) throw new Error('history_identity');
  const guard = () => { if (closed) throw new Error('history_closed'); requireStorageEpoch(epoch); options.guard(); };
  async function readSaved() {
    const db = await open(factory, guard);
    try { return await new Promise<Saved | undefined>((resolve, reject) => {
      const tx = db.transaction('history', 'readonly'), request = tx.objectStore('history').get(options.device);
      tx.oncomplete = () => { try { guard(); resolve(request.result); } catch (error) { reject(error); } };
      tx.onabort = () => reject(tx.error ?? new Error('history_storage'));
    }); } finally { db.close(); }
  }
  async function readFile(id: string): Promise<Uint8Array | null> {
    const db = await open(factory, guard);
    let record: SealedFileRecord | undefined;
    try { record = await new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readonly'), request = tx.objectStore('files').get(`${scope}:${id}`);
      tx.oncomplete = () => { try { guard(); resolve(request.result); } catch (error) { reject(error); } };
      tx.onabort = () => reject(tx.error ?? new Error('history_storage'));
    }); } finally { db.close(); }
    if (!record) return null;
    const bytes = await openSealedFileData(options.key, scope, id, record); guard(); return bytes;
  }
  async function data(saved: Saved | undefined) {
    if (!saved) return null;
    if (saved.owner !== options.owner || saved.device !== options.device || !Number.isSafeInteger(saved.revision) || saved.revision < 1 ||
      !Number.isSafeInteger(saved.bytes) || saved.bytes < 0 || saved.bytes > HISTORY_MAX_BYTES || !Number.isSafeInteger(saved.count) || saved.count < 0 || saved.count > 10000 ||
      saved.data.cipher.byteLength > 16 * 1024 * 1024 + 16) throw new Error('history_storage');
    const opened = await openSealedChatData(options.key, scope, saved.data); guard(); return opened;
  }
  return Object.freeze({
    async load() { return data(await readSaved()); }, file: readFile,
    async import(profile: BackupProfile): Promise<LocalChatData> {
      const started = generation, check = () => { guard(); if (generation !== started) throw new Error('history_cancelled'); };
      check(); if (profile.accountId !== options.owner) throw new Error('history_identity');
      await validateBackupProfiles([profile], new Set([options.owner]), check); check();
      for (let retry = 0; retry < 4; retry++) {
        const saved = await readSaved(), old = await data(saved), next = mergeHistory(old, profile);
        const referenced = referencedBackupFiles(next);
        const additions: SealedFileRecord[] = []; let bytes = saved?.bytes ?? 0, count = saved?.count ?? 0;
        for (const [id, content] of profile.files) {
          if (!referenced.has(id)) continue; // Do not resurrect locally deleted files.
          const existing = await readFile(id);
          if (existing) { try { if (existing.length !== content.length || await sha256Hex(existing) !== await sha256Hex(content)) throw new Error('history_file_conflict'); }
            finally { existing.fill(0); } }
          else { bytes += content.length; count++; if (bytes > HISTORY_MAX_BYTES || count > 10000) throw new Error('history_capacity');
            additions.push(await sealLocalFileData(options.key, scope, id, content)); }
          check();
        }
        const sealed = await sealChatData(options.key, scope, next); check();
        const db = await open(factory, check);
        try {
          const committed = await new Promise<boolean>((resolve, reject) => {
            const tx = db.transaction(['history', 'files'], 'readwrite', { durability: 'strict' });
            const request = tx.objectStore('history').get(options.device); let matched = false, failure: unknown;
            request.onsuccess = () => { try {
              check(); const actual = request.result as Saved | undefined;
              if ((actual?.revision ?? null) !== (saved?.revision ?? null)) return;
              for (const file of additions) tx.objectStore('files').add(file);
              tx.objectStore('history').put({ device: options.device, owner: options.owner, revision: (saved?.revision ?? 0) + 1, bytes, count, data: sealed }); matched = true;
            } catch (error) { failure = error; tx.abort(); } };
            tx.oncomplete = () => { try { check(); resolve(matched); } catch (error) { reject(error); } };
            tx.onabort = () => reject(failure ?? tx.error ?? new Error('history_storage'));
          });
          if (committed) return next;
        } finally { db.close(); }
      }
      throw new Error('history_storage_busy');
    },
    async remove(peer: string, id: string): Promise<LocalChatData | null> {
      guard();
      for (let retry = 0; retry < 4; retry++) {
        const saved = await readSaved(), next = await data(saved); if (!saved || !next) return null;
        const conversation = next.chats.byPeer[peer]; if (!conversation) return next;
        const message = conversation.messages.find(item => item.id === id);
        conversation.messages = conversation.messages.filter(item => item.id !== id);
        conversation.deletedIds = [...new Set([...(conversation.deletedIds ?? []), id])];
        if (conversation.deletedIds.length > 100000) throw new Error('history_capacity');
        const fileId = message?.file ? `${peer}:${message.file.id}` : null;
        const deleted = fileId && !referencedBackupFiles(next).has(fileId) ? fileId : null;
        const content = deleted ? await readFile(deleted) : null, size = content?.length ?? 0, count = content ? 1 : 0; content?.fill(0);
        const sealed = await sealChatData(options.key, scope, next), db = await open(factory, guard);
        try {
          const matched = await new Promise<boolean>((resolve, reject) => {
            const tx = db.transaction(['history','files'], 'readwrite', { durability: 'strict' }); let updated = false, failure: unknown;
            const request = tx.objectStore('history').get(options.device);
            request.onsuccess = () => { try { guard(); const actual = request.result as Saved | undefined;
              if (actual?.revision !== saved.revision) return;
              if (deleted) tx.objectStore('files').delete(`${scope}:${deleted}`);
              tx.objectStore('history').put({ ...saved, revision: saved.revision + 1, bytes: Math.max(0, saved.bytes-size), count: Math.max(0, saved.count-count), data: sealed }); updated = true;
            } catch (error) { failure = error; tx.abort(); } };
            tx.onabort = () => reject(failure ?? tx.error ?? new Error('history_storage'));
            tx.oncomplete = () => { try { guard(); resolve(updated); } catch (error) { reject(error); } };
          });
          if (matched) return next;
        } finally { db.close(); }
      }
      throw new Error('history_storage_busy');
    },
    async clear() {
      guard(); generation++; const db = await open(factory, guard);
      try { await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['history','files'], 'readwrite', { durability: 'strict' }); let failure: unknown;
        tx.objectStore('history').delete(options.device);
        const cursor = tx.objectStore('files').openKeyCursor(IDBKeyRange.bound(`${scope}:`, `${scope}:\uffff`));
        cursor.onsuccess = () => { try { guard(); if (cursor.result) { tx.objectStore('files').delete(cursor.result.primaryKey); cursor.result.continue(); } }
          catch (error) { failure = error; tx.abort(); } };
        tx.oncomplete = () => { try { guard(); resolve(); } catch (error) { reject(error); } };
        tx.onabort = () => reject(failure ?? tx.error ?? new Error('history_storage'));
      }); } finally { db.close(); }
    }, close() { closed = true; }
  });
}
export async function clearDeviceHistory(factory: IDBFactory = indexedDB): Promise<void> {
  const db = await open(factory, () => {});
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['history', 'files'], 'readwrite', { durability: 'strict' });
    tx.objectStore('history').clear(); tx.objectStore('files').clear();
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error ?? new Error('history_storage'));
  }); } finally { db.close(); }
}
