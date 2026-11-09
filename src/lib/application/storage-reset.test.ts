import { afterEach, describe, expect, it, vi } from 'vitest';
import { beginStorageReset, requireStorageEpoch, storageEpoch } from './storage-reset';
afterEach(() => vi.unstubAllGlobals());
describe('storage reset tombstone', () => {
  it('invalidates old writes and allows new operations only in the new epoch', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value) });
    const old = storageEpoch(); requireStorageEpoch(old); beginStorageReset();
    expect(() => requireStorageEpoch(old)).toThrow('storage_reset_during_operation');
    const fresh = storageEpoch(); requireStorageEpoch(fresh); beginStorageReset();
    expect(() => requireStorageEpoch(fresh)).toThrow();
    expect(values.size).toBe(1); // no identities, passwords, seed or history
  });
});
