import { PROFILE_DATABASE_NAME, PROFILE_SELECTION_DATABASE_NAME, clearAllProfileStorage, openBrowserProfileBundle } from './browser';
import { WebCryptoIdentity } from '../identity/webcrypto';
import { accountIdFromPublicKey } from '../addressing/account-id.js';
import { UUID_PATTERN } from '../core/objects';

export function profileCheckFactory(factory: IDBFactory, runId: string): IDBFactory {
  if (!UUID_PATTERN.test(runId)) throw new Error('invalid_profile_check_id');
  return { open(name: string, version?: number) {
    if (name !== PROFILE_DATABASE_NAME && name !== PROFILE_SELECTION_DATABASE_NAME) throw new Error('unexpected_profile_check_database');
    return factory.open('automesh-profile-check-v1-' + runId + (name === PROFILE_SELECTION_DATABASE_NAME ? '-selection' : ''), version);
  } } as IDBFactory;
}
export async function openProfileBrowserCheck(runId: string) {
  const factory = profileCheckFactory(indexedDB, runId);
  const root = new Uint8Array(32); root[31] = 1; // PUBLIC fixture, never user's seed.
  const identity = new WebCryptoIdentity();
  try {
    const scope = await accountIdFromPublicKey((await identity.fromSeed(root)).publicKey);
    const bundle = await openBrowserProfileBundle({ root, scope, trusted: true, factory });
    return { bundle, clear: () => clearAllProfileStorage(factory), close: bundle.close };
  } finally { identity.dispose(); root.fill(0); }
}
