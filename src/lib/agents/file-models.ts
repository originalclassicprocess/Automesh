export type FileModel = { id: string; name: string; bytes: number };
type StoredFileModel = FileModel & { file: File };

const storeName = 'models';

function openModels(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('automesh-file-models', 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function modelTransaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openModels();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      const request = run(transaction.objectStore(storeName));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

export async function listFileModels(): Promise<FileModel[]> {
  const entries: StoredFileModel[] = await modelTransaction('readonly', store => store.getAll());
  return entries.map(({ id, name, bytes }) => ({ id, name, bytes })).sort((a, b) => a.name.localeCompare(b.name));
}

export async function importFileModel(file: File): Promise<FileModel> {
  if (!/\.gguf$/i.test(file.name)) throw new Error('agent_file_format');
  const header = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (file.size < 24 || new TextDecoder().decode(header) !== 'GGUF') throw new Error('agent_file_invalid');
  const entry = { id: crypto.randomUUID(), name: file.name, bytes: file.size };
  await modelTransaction('readwrite', store => store.add({ ...entry, file }));
  return entry;
}

export async function readFileModel(id: string): Promise<File> {
  const entry: StoredFileModel | undefined = await modelTransaction('readonly', store => store.get(id));
  if (!entry) throw new Error('agent_file_missing');
  return entry.file;
}

export async function hasFileModel(id: string): Promise<boolean> {
  return !!id && !!(await modelTransaction('readonly', store => store.getKey(id)));
}

export async function removeFileModel(id: string): Promise<void> {
  await modelTransaction('readwrite', store => store.delete(id));
}

export async function clearFileModels(): Promise<void> {
  await modelTransaction('readwrite', store => store.clear());
}
