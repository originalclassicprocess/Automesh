export type AccountLease = {
  accountId: string;
  available: boolean;
  supported: boolean;
  release(): void;
};

// Local coordination only, not a security boundary against same-origin XSS.
// Hold through UI lock because the tab still owns its in-memory chat snapshot.
export async function acquireAccountLease(accountId: string, manager: LockManager | undefined =
  typeof navigator === 'undefined' ? undefined : navigator.locks): Promise<AccountLease> {
  if (!accountId || accountId.length > 128) throw new Error('invalid_account_id');
  if (!manager) return { accountId, available: true, supported: false, release() {} };
  return new Promise<AccountLease>((resolve, reject) => {
    let release!: () => void;
    const held = new Promise<void>(done => { release = done; });
    // ifAvailable avoids waiting indefinitely behind another tab. The browser
    // releases the lock even when the owner crashes or closes abruptly.
    const request = manager.request(`Automesh/account-session/v1:${accountId}`,
      { mode: 'exclusive', ifAvailable: true }, async lock => {
        if (!lock) {
          resolve({ accountId, available: false, supported: true, release() {} });
          return;
        }
        resolve({ accountId, available: true, supported: true, release });
        await held;
      });
    void request.catch(reject);
  });
}
