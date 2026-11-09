import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { accountFromMnemonic } from '../application/account';
import { readProfilesForBackup } from './backup-browser';
import { openBrowserProfileBundle, PROFILE_DATABASE_NAME } from './browser';
import { createIndexedDbCoreRecords } from '../core-storage/indexeddb';
const phrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const seed = new TextEncoder().encode(phrase);
let factory: IDBFactory;
beforeEach(() => { factory = new IDBFactory(); vi.stubGlobal('localStorage', { getItem: () => null }); });
afterEach(() => vi.unstubAllGlobals());
describe('authenticated profile export reader', () => {
  it('keeps seed-only accounts compatible without creating a profile registry', async () => {
    const account = await accountFromMnemonic(phrase);
    try { expect(await readProfilesForBackup(seed, account.accountId, () => true, factory)).toBeUndefined(); }
    finally { account.identitySeed.fill(0); account.provider.dispose(); }
  });
  it('reads the saved registry using the authenticated root account', async () => {
    const account = await accountFromMnemonic(phrase);
    const bundle = await openBrowserProfileBundle({ root: account.identitySeed, scope: account.accountId, trusted: true, factory });
    try {
      await bundle.initialize('Личный'); const r = await bundle.create('incoming', 'Входящий');
      const exported = await readProfilesForBackup(seed, account.accountId, () => true, factory);
      expect(exported!.profiles).toEqual(r.profiles); expect(new TextDecoder().decode(seed)).toBe(phrase);
      await expect(readProfilesForBackup(seed, account.accountId, () => false, factory)).rejects.toThrow('profile_session_changed');
    } finally { bundle.close(); account.identitySeed.fill(0); account.provider.dispose(); }
  });
  it('fails on corrupted ciphertext rather than silently exporting only the seed', async () => {
    const account = await accountFromMnemonic(phrase);
    const mapped = { open: (_name: string, version?: number) => factory.open(PROFILE_DATABASE_NAME, version) } as IDBFactory;
    const records = createIndexedDbCoreRecords(mapped, () => {});
    try {
      await records.compareAndSwap(account.accountId, null, { schema: 1, revision: 1, iv: new Uint8Array(12), cipher: new ArrayBuffer(17) });
      await expect(readProfilesForBackup(seed, account.accountId, () => true, factory)).rejects.toThrow();
    } finally { records.close(); account.identitySeed.fill(0); account.provider.dispose(); }
  });
});
