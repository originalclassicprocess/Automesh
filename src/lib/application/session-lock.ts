import { openSealedChatData, openSealedFileData, sealChatData, sealLocalFileData,
  type LocalChatData, type SealedRecord, type SealedFileRecord } from '$lib/chat/local-store';

// The locked state retains neither a CryptoKey nor plaintext history/file data.
// The key is derived again only after the existing vault/profile unlock succeeds.
export type LockedSession = { accountId: string; trusted: boolean; history: SealedRecord; files: Map<string, SealedFileRecord> };
export type OpenedSession = { data: LocalChatData; files: Map<string, Uint8Array> };

export function clearUnownedFileBytes(bytes: Uint8Array | undefined, retained: Iterable<Uint8Array>): void {
  if (!bytes) return;
  // A different view may still share this buffer with the active file cache.
  for (const value of retained) if (value.buffer === bytes.buffer) return;
  bytes.fill(0);
}

export class SessionTasks {
  private readonly pending = new Set<Promise<unknown>>();
  track<T>(work: Promise<T>): Promise<T> {
    this.pending.add(work);
    void work.then(() => this.pending.delete(work), () => this.pending.delete(work));
    return work;
  }
  async settled(): Promise<void> {
    // A finishing operation can enqueue another write; wait for that too.
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }
}

export function discardLockedSession(session: LockedSession | null): void {
  if (!session) return;
  for (const record of [session.history, ...session.files.values()]) {
    record.iv.fill(0); new Uint8Array(record.cipher).fill(0);
  }
  session.files.clear();
}

export function discardOpenedSession(session: OpenedSession | null): void {
  if (!session) return;
  for (const bytes of session.files.values()) bytes.fill(0);
  session.files.clear();
}

export async function openLockedSession(session: LockedSession, key: CryptoKey, accountId: string,
  guard: () => void): Promise<OpenedSession> {
  guard();
  if (session.accountId !== accountId) throw Error('locked_session_account_mismatch');
  const files = new Map<string, Uint8Array>();
  try {
    const data = await openSealedChatData(key, accountId, session.history); guard();
    for (const [id, record] of session.files) {
      const bytes = await openSealedFileData(key, accountId, id, record);
      files.set(id, bytes); guard();
    }
    return { data, files };
  } catch (error) {
    for (const bytes of files.values()) bytes.fill(0);
    files.clear(); throw error;
  }
}

export async function prepareSessionLock(options: {
  key: CryptoKey; accountId: string; trusted: boolean; guard(): void;
  drain(): Promise<void>; capture(): { data: LocalChatData; files: ReadonlyMap<string, Uint8Array> };
  save(data: LocalChatData, files: ReadonlyMap<string, Uint8Array>): Promise<void>;
}): Promise<{ session: LockedSession; persistenceFailed: boolean }> {
  options.guard(); await options.drain(); options.guard();
  const { data, files } = options.capture();
  let session: LockedSession | null = null;
  try {
    session = { accountId: options.accountId, trusted: options.trusted,
      history: await sealChatData(options.key, options.accountId, data), files: new Map() };
    options.guard();
    for (const [id, bytes] of files) {
      const record = await sealLocalFileData(options.key, options.accountId, id, bytes);
      session.files.set(id, record); options.guard();
    }
    let persistenceFailed = false;
    if (options.trusted) {
      try { await options.save(data, files); }
      catch { persistenceFailed = true; }
      options.guard();
    }
    return { session, persistenceFailed };
  } catch (error) { discardLockedSession(session); throw error; }
}
