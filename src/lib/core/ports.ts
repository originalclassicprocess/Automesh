export interface CoreEnvironment {
  readonly subtle: SubtleCrypto;
  readonly now: () => number;
  readonly newId: () => string;
}

// Storage adapters must implement claim atomically; a read followed by a write
// is not sufficient across processes/tabs. No silent eviction of live claims.
export interface ReplayStore {
  claim(key: string, expiresAt: number, now: number): Promise<boolean>;
}

export function webCryptoEnvironment(): CoreEnvironment {
  return { subtle: globalThis.crypto.subtle, now: () => Date.now(), newId: () => globalThis.crypto.randomUUID() };
}

export function checkedTime(now: () => number): number {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('invalid_core_clock');
  return value;
}

export class MemoryReplayStore implements ReplayStore {
  private readonly entries = new Map<string, number>();
  constructor(private readonly capacity = 1024) {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 100_000) throw new Error('invalid_replay_capacity');
  }
  async claim(key: string, expiresAt: number, now: number): Promise<boolean> {
    if (typeof key !== 'string' || key.length > 512 || !key.length || !Number.isSafeInteger(now) || now < 0 ||
        !Number.isSafeInteger(expiresAt) || expiresAt <= now) throw new Error('invalid_replay_claim');
    for (const [id, expiry] of this.entries) if (expiry <= now) this.entries.delete(id);
    if (this.entries.has(key)) return false;
    if (this.entries.size >= this.capacity) throw new Error('replay_capacity');
    this.entries.set(key, expiresAt);
    return true;
  }
}
