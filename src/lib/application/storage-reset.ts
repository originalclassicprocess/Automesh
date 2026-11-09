// Non-secret origin-local tombstone. Prevents old tabs/async writes from
// resurrecting data after an emergency reset. It intentionally survives reset.
export const RESET_KEY = 'automesh-storage-reset-v1';
export function storageEpoch(): string | null { return localStorage.getItem(RESET_KEY); }
export function requireStorageEpoch(epoch: string | null): void {
  if (storageEpoch() !== epoch) throw new Error('storage_reset_during_operation');
}
export function beginStorageReset(): void { localStorage.setItem(RESET_KEY, crypto.randomUUID()); }
