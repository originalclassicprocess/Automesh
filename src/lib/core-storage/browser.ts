import { storageEpoch, requireStorageEpoch } from '../application/storage-reset';
import { createDurableCoreState, type DurableCoreOptions } from '../core/durable-state';
import { webCryptoEnvironment } from '../core/ports';
import { createIndexedDbCoreRecords } from './indexeddb';

export interface BrowserCoreStateOptions {
  accountId: string;
  key: CryptoKey;
  trusted: boolean;
  factory?: IDBFactory;
  environment?: DurableCoreOptions['environment'];
  claimCapacity?: number;
  policyCapacity?: number;
}

// Host-owned, account-scoped adapter. No persistent core writes for an
// untrusted session, and no silent fallback to in-memory replay protection.
export function createBrowserCoreState(options: BrowserCoreStateOptions) {
  if (options.trusted !== true) throw new Error('core_storage_requires_trusted_session');
  const epoch = storageEpoch();
  const records = createIndexedDbCoreRecords(options.factory ?? globalThis.indexedDB, () => requireStorageEpoch(epoch));
  const state = createDurableCoreState({ scope: options.accountId, key: options.key, records,
    environment: options.environment ?? webCryptoEnvironment(), randomBytes: n => crypto.getRandomValues(new Uint8Array(n)),
    claimCapacity: options.claimCapacity, policyCapacity: options.policyCapacity });
  return Object.freeze({ replayStore: state.replayStore, policyStore: state.policyStore,
    close: () => { state.close(); records.close(); } });
}
