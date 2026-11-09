import { CORE_DATABASE_NAME, clearAllCoreStorage, createIndexedDbCoreRecords } from '../core-storage/indexeddb';
import { requireStorageEpoch, storageEpoch } from '../application/storage-reset';
import { webCryptoEnvironment, type CoreEnvironment } from '../core/ports';
import type { IdentityProvider } from '../identity/identity';
import { isValidAccountId } from '../addressing/bech32m.js';
import { createOwnerDeviceStore } from './owner-store';
export const OWNER_DEVICE_DATABASE = 'automesh-owner-devices-prototype-v1';
function namespaced(factory: IDBFactory): IDBFactory {
  if (!factory) throw new Error('device_storage_unavailable');
  return { open(name: string, version?: number) {
    if (name !== CORE_DATABASE_NAME) throw new Error('unexpected_device_database');
    return factory.open(OWNER_DEVICE_DATABASE, version);
  } } as IDBFactory;
}
export async function deriveOwnerDeviceKey(root: Uint8Array, owner: string, subtle: SubtleCrypto = crypto.subtle) {
  if (root.length !== 32 || !isValidAccountId(owner)) throw new Error('invalid_device_owner_key');
  const copy = new Uint8Array(root);
  try {
    const material = await subtle.importKey('raw', copy, 'HKDF', false, ['deriveKey']);
    return await subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256',
      salt: new TextEncoder().encode('Automesh private owner devices prototype v1'), info: new TextEncoder().encode(owner) },
      material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  } finally { copy.fill(0); }
}
export async function openBrowserOwnerDevices(options: { root: Uint8Array; owner: string; signer: IdentityProvider;
  trusted: boolean; isCurrent(): boolean; factory?: IDBFactory; environment?: CoreEnvironment }) {
  return openBrowserOwnerDevicesWithKey({ ...options, key: await deriveOwnerDeviceKey(options.root, options.owner) });
}
export function openBrowserOwnerDevicesWithKey(options: { key: CryptoKey; owner: string; signer: IdentityProvider;
  trusted: boolean; isCurrent(): boolean; factory?: IDBFactory; environment?: CoreEnvironment }) {
  if (options.trusted !== true) throw new Error('devices_require_trusted_session');
  const epoch = storageEpoch(), isCurrent = options.isCurrent; let closed = false;
  const guard = () => { requireStorageEpoch(epoch); if (closed || !isCurrent()) throw new Error('device_session_changed'); };
  guard(); const key = options.key;
  const records = createIndexedDbCoreRecords(namespaced(options.factory ?? indexedDB), guard);
  const store = createOwnerDeviceStore({ owner: options.owner, signer: options.signer, key, records,
    environment: options.environment ?? webCryptoEnvironment(), guard });
  return Object.freeze({ ...store, close() { closed = true; store.close(); records.close(); } });
}
export async function clearOwnerDeviceStorage(factory: IDBFactory = indexedDB) { await clearAllCoreStorage(namespaced(factory)); }
