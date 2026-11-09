import { describe, expect, it, vi } from 'vitest';
import { acquireAccountLease } from './account-lease';

function lockManager() {
  const held = new Set<string>();
  const request = vi.fn(async (name: string, _options: LockOptions, callback: LockGrantedCallback<unknown>) => {
    if (held.has(name)) return callback(null);
    held.add(name);
    try { return await callback({ name, mode: 'exclusive' } as Lock); }
    finally { held.delete(name); }
  });
  return { manager: { request } as unknown as LockManager, held };
}

describe('one active account per browser origin', () => {
  it('refuses a second copy, permits different accounts, and releases on exit', async () => {
    const { manager, held } = lockManager();
    const first = await acquireAccountLease('alice', manager);
    expect(first.available).toBe(true);
    expect((await acquireAccountLease('alice', manager)).available).toBe(false);
    const other = await acquireAccountLease('bob', manager);
    expect(other.available).toBe(true);
    // A UI lock does not release the owner: it retains a private chat snapshot.
    expect((await acquireAccountLease('alice', manager)).available).toBe(false);
    first.release(); first.release();
    await vi.waitFor(() => expect(held.has('Automesh/account-session/v1:alice')).toBe(false));
    const next = await acquireAccountLease('alice', manager);
    expect(next.available).toBe(true);
    next.release(); other.release();
    await vi.waitFor(() => expect(held.size).toBe(0));
  });

  it('exposes lack of browser support instead of pretending coordination succeeded', async () => {
    // Node 24 also exposes navigator.locks; passing undefined invokes the
    // default parameter rather than modelling a browser without Web Locks.
    vi.stubGlobal('navigator', {});
    try {
      const lease = await acquireAccountLease('alice');
      expect(lease.supported).toBe(false);
      lease.release();
    } finally { vi.unstubAllGlobals(); }
  });

  it('propagates API failures rather than allowing an uncoordinated entry', async () => {
    const manager = { request: () => Promise.reject(new Error('locks_denied')) } as unknown as LockManager;
    await expect(acquireAccountLease('alice', manager)).rejects.toThrow('locks_denied');
  });
});
