import { CORE_DATABASE_NAME, clearAllCoreStorage, createIndexedDbCoreRecords } from '../core-storage/indexeddb';
import { storageEpoch, requireStorageEpoch } from '../application/storage-reset';
import { webCryptoEnvironment } from '../core/ports';
import { openProfileBundle } from './bundle';
import { deriveProfileSelectionKey } from './keys';
import { createProfileSelectionStore } from './selection';

export const PROFILE_DATABASE_NAME = 'automesh-private-profiles-v1';
export const PROFILE_SELECTION_DATABASE_NAME = 'automesh-private-profile-selection-v1';
function registryFactory(factory: IDBFactory, database = PROFILE_DATABASE_NAME): IDBFactory {
  return { open(name: string, version?: number) {
    if (name !== CORE_DATABASE_NAME) throw new Error('unexpected_profile_database');
    return factory.open(database, version);
  } } as IDBFactory;
}
export async function openBrowserProfileBundle(options: {
  root: Uint8Array; scope: string; trusted: boolean; factory?: IDBFactory; isCurrent?: () => boolean;
}) {
  if (options.trusted !== true) throw new Error('profiles_require_trusted_session');
  const factory = options.factory ?? globalThis.indexedDB;
  if (!factory) throw new Error('profile_storage_unavailable');
  const epoch = storageEpoch(), guard = () => {
    requireStorageEpoch(epoch);
    if (options.isCurrent && !options.isCurrent()) throw new Error('profile_session_changed');
  };
  const records = createIndexedDbCoreRecords(registryFactory(factory), guard);
  try {
    const bundle = await openProfileBundle({ root: options.root, scope: options.scope, records,
      environment: webCryptoEnvironment(), randomBytes: n => crypto.getRandomValues(new Uint8Array(n)), guard });
    return Object.freeze({ ...bundle, close: () => { bundle.close(); records.close(); } });
  } catch (error) { records.close(); throw error; }
}
export async function withBrowserProfileSelection<T>(options: {
  root: Uint8Array; scope: string; trusted: boolean; factory?: IDBFactory; guard(): void;
}, work: (store: ReturnType<typeof createProfileSelectionStore>) => Promise<T>): Promise<T> {
  if (!options.trusted) throw new Error('profiles_require_trusted_session');
  const epoch = storageEpoch(), guard = () => { requireStorageEpoch(epoch); options.guard(); };
  const records = createIndexedDbCoreRecords(registryFactory(options.factory ?? indexedDB, PROFILE_SELECTION_DATABASE_NAME), guard);
  try {
    guard(); const key = await deriveProfileSelectionKey(options.root, options.scope, crypto.subtle); guard();
    return await work(createProfileSelectionStore({ scope: options.scope, key, records, guard }));
  } finally { records.close(); }
}
export const clearAllProfileStorage = async (factory: IDBFactory = globalThis.indexedDB) => {
  if (!factory) throw new Error('profile_storage_unavailable');
  await clearAllCoreStorage(registryFactory(factory));
  await clearAllCoreStorage(registryFactory(factory, PROFILE_SELECTION_DATABASE_NAME));
};
