// Separate device database. No root account/vault/profile database is touched.
import { CORE_DATABASE_NAME, clearAllCoreStorage, createIndexedDbCoreRecords } from '../core-storage/indexeddb';
import { storageEpoch, requireStorageEpoch } from '../application/storage-reset';
import { webCryptoEnvironment, type CoreEnvironment } from '../core/ports';
import { createPendingDeviceVault, openPendingDeviceVault, type PendingDeviceVault } from './pending-vault';

export const PENDING_DEVICE_DATABASE = 'automesh-pending-device-prototype-v1';
function namespaced(factory: IDBFactory): IDBFactory {
  if (!factory || typeof factory.open !== 'function') throw new Error('device_storage_unavailable');
  return { open(name: string, version?: number) {
    if (name !== CORE_DATABASE_NAME) throw new Error('unexpected_device_database');
    return factory.open(PENDING_DEVICE_DATABASE, version);
  } } as IDBFactory;
}
export function createPendingDeviceBrowser(options: {
  trusted: boolean; factory?: IDBFactory; environment?: CoreEnvironment; isCurrent(): boolean;
}) {
  if (options.trusted !== true) throw new Error('device_storage_requires_trusted_session');
  const isCurrent = options.isCurrent;
  if (typeof isCurrent !== 'function') throw new Error('device_session_guard_required');
  const epoch = storageEpoch(); let closed = false;
  const sessions = new Set<PendingDeviceVault>();
  const guard = () => {
    requireStorageEpoch(epoch);
    if (closed || !isCurrent()) throw new Error('device_session_changed');
  };
  const records = createIndexedDbCoreRecords(namespaced(options.factory ?? globalThis.indexedDB), guard);
  const environment = options.environment ?? webCryptoEnvironment();
  async function remember(pending: Promise<PendingDeviceVault>) {
    const vault = await pending;
    try { guard(); sessions.add(vault); return vault; }
    catch (error) { vault.close(); throw error; }
  }
  return Object.freeze({
    create: (label: string, password: string) => remember(createPendingDeviceVault(label, password, { records, environment, guard })),
    open: (deviceId: string, password: string) => remember(openPendingDeviceVault(deviceId, password, { records, environment, guard })),
    close() { closed = true; for (const session of sessions) session.close(); sessions.clear(); records.close(); }
  });
}
// Main emergency reset invalidates sessions before clearing this database.
// Local erasure does not revoke an already issued remote grant.
export async function clearPendingDeviceStorage(factory: IDBFactory = globalThis.indexedDB) {
  await clearAllCoreStorage(namespaced(factory));
}
