import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { SessionTasks, prepareSessionLock, openLockedSession, discardLockedSession, discardOpenedSession, clearUnownedFileBytes } from './session-lock';
import { SerializedWrites } from './serialized-writes';
import { OutboxController, type TextSender } from './outbox';
import { beginStorageReset, requireStorageEpoch, storageEpoch } from './storage-reset';
import { deriveChatStoreKey, normalizeLocalChatData, saveLocalSessionData, loadLocalChatData, loadLocalFileData, inspectChatStorage } from '$lib/chat/local-store';
import { emptySessionChats, ensureConversation, restoreChats, saveChats, type ChatEntry } from '$lib/chat/session-chats';
import { encodeAccountId } from '$lib/addressing/bech32m';
import { sha256Hex, FILE_CHUNK_BYTES } from '$lib/chat/file-transfer';
import { FileReceiver } from './file-receiver';
import { prepareMedia, makePack, addMedia, emptyMediaLibrary, libraryFileId } from '$lib/chat/media-library';

const owner = encodeAccountId(new Uint8Array(20).fill(1)), peer = encodeAccountId(new Uint8Array(20).fill(2));
beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('IDBKeyRange', IDBKeyRange);
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function deferred() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
async function fixture() {
  const key = await deriveChatStoreKey(new Uint8Array(32).fill(7), owner);
  const bytes = new Uint8Array(FILE_CHUNK_BYTES + 19).fill(37), id = crypto.randomUUID();
  const message: ChatEntry = { id, from: owner, text: '', timestamp: 1, direction: 'outgoing', delivery: 'queued', fileStatus: 'queued',
    file: { id, name: 'private.bin', size: bytes.length, mime: 'application/octet-stream', sha256: await sha256Hex(bytes) } };
  const current = ensureConversation(emptySessionChats(), peer); current.byPeer[peer].messages = [message];
  const data = normalizeLocalChatData({ selfNickname: 'private-name', chats: saveChats(current) });
  const files = new Map([[`${peer}:${id}`, bytes]]);
  const save = vi.fn((next: typeof data, blobs: ReadonlyMap<string, Uint8Array>) => saveLocalSessionData(key, owner, next, blobs));
  return { key, bytes, id, message, current, data, files, save };
}

describe('encrypted locked sessions', () => {
  it('zeroes scratch bytes without corrupting another view owned by the active cache', () => {
    const shared = new Uint8Array(12).fill(5), scratch = new Uint8Array(12).fill(7);
    clearUnownedFileBytes(shared, [shared.subarray(2, 8)]);
    expect(shared.every(byte => byte === 5)).toBe(true);
    clearUnownedFileBytes(scratch, [shared]);
    expect(scratch.every(byte => byte === 0)).toBe(true);
  });
  it.each([false, true])('keeps history and file bytes after wiping open buffers (trusted=%s)', async trusted => {
    const f = await fixture(), original = f.bytes.slice(), expected = structuredClone(f.data);
    const { session, persistenceFailed } = await prepareSessionLock({ ...f, accountId: owner, trusted,
      guard: () => {}, drain: async () => {}, capture: () => ({ data: f.data, files: f.files }) });
    expect(persistenceFailed).toBe(false);
    expect(Object.keys(session).sort()).toEqual(['accountId', 'files', 'history', 'trusted']);
    expect(new TextDecoder().decode(session.history.cipher)).not.toContain('private-name');
    expect(session.files.values().next().value?.cipher).toBeInstanceOf(ArrayBuffer);
    expect(f.save).toHaveBeenCalledTimes(trusted ? 1 : 0);
    f.bytes.fill(0); f.files.clear(); f.data.selfNickname = ''; f.data.chats = { order: [], byPeer: {} };
    const opened = await openLockedSession(session, f.key, owner, () => {});
    expect(opened.data).toEqual(expected); expect(opened.files.get(`${peer}:${f.id}`)).toEqual(original);
    expect(await loadLocalChatData(f.key, owner)).toEqual(trusted ? expected : null);
    if (trusted) expect(await loadLocalFileData(f.key, owner, `${peer}:${f.id}`)).toEqual(original);
    else expect((await inspectChatStorage(owner)).files).toHaveLength(0);
    const restoredBytes = opened.files.get(`${peer}:${f.id}`)!; discardOpenedSession(opened);
    expect(restoredBytes.every(byte => byte === 0)).toBe(true);
    discardLockedSession(session); expect(new Uint8Array(session.history.cipher).every(byte => byte === 0)).toBe(true);
  });

  it('retains an encrypted recovery copy when trusted persistence fails', async () => {
    const f = await fixture(); f.save.mockRejectedValueOnce(Error('quota'));
    const result = await prepareSessionLock({ ...f, accountId: owner, trusted: true,
      guard: () => {}, drain: async () => {}, capture: () => f });
    expect(result.persistenceFailed).toBe(true);
    f.bytes.fill(0);
    expect((await openLockedSession(result.session, f.key, owner, () => {})).data.chats.byPeer[peer].messages[0].id).toBe(f.id);
    expect((await openLockedSession(result.session, f.key, owner, () => {})).files.get(`${peer}:${f.id}`)?.every(byte => byte === 37)).toBe(true);
  });

  it('rejects wrong keys, profiles, tampering and file substitution without consuming the retry copy', async () => {
    const f = await fixture(), options = { ...f, accountId: owner, trusted: false, guard: () => {}, drain: async () => {}, capture: () => f };
    const { session } = await prepareSessionLock(options);
    const wrong = await deriveChatStoreKey(new Uint8Array(32).fill(8), owner);
    await expect(openLockedSession(session, wrong, owner, () => {})).rejects.toThrow();
    await expect(openLockedSession(session, f.key, peer, () => {})).rejects.toThrow('account_mismatch');
    const tampered = structuredClone(session); new Uint8Array(tampered.history.cipher)[0] ^= 1;
    await expect(openLockedSession(tampered, f.key, owner, () => {})).rejects.toThrow();
    const swapped = structuredClone(session), record = swapped.files.values().next().value!;
    swapped.files = new Map([['different-id', record]]);
    await expect(openLockedSession(swapped, f.key, owner, () => {})).rejects.toThrow('account_mismatch');
    expect((await openLockedSession(session, f.key, owner, () => {})).files.get(`${peer}:${f.id}`)).toEqual(f.bytes);
  });

  it('clears partially decrypted files when unlock is canceled, while preserving the sealed copy', async () => {
    const f = await fixture(), { session } = await prepareSessionLock({ ...f, accountId: owner, trusted: false,
      guard: () => {}, drain: async () => {}, capture: () => f });
    const decrypt = crypto.subtle.decrypt.bind(crypto.subtle), buffers: ArrayBuffer[] = [];
    vi.spyOn(crypto.subtle, 'decrypt').mockImplementation(async (...args) => {
      const result = await decrypt(...args); buffers.push(result); return result;
    });
    let checks = 0;
    await expect(openLockedSession(session, f.key, owner, () => { if (++checks === 3) throw Error('auth_cancelled'); })).rejects.toThrow('auth_cancelled');
    expect(buffers).toHaveLength(2);
    expect(buffers.every(buffer => new Uint8Array(buffer).every(byte => byte === 0))).toBe(true);
    expect((await openLockedSession(session, f.key, owner, () => {})).files.get(`${peer}:${f.id}`)).toEqual(f.bytes);
  });

  it('leaves originals available if encryption fails, and zeroes temporary encryption inputs', async () => {
    const f = await fixture(), before = f.bytes.slice(), encrypt = crypto.subtle.encrypt.bind(crypto.subtle), inputs: ArrayBuffer[] = [];
    vi.spyOn(crypto.subtle, 'encrypt').mockImplementation(async (...args) => {
      inputs.push(args[2] as ArrayBuffer);
      if (inputs.length === 2) throw Error('crypto_failure');
      return encrypt(...args);
    });
    await expect(prepareSessionLock({ ...f, accountId: owner, trusted: false,
      guard: () => {}, drain: async () => {}, capture: () => f })).rejects.toThrow('crypto_failure');
    expect(f.bytes).toEqual(before); expect(f.data.selfNickname).toBe('private-name'); expect(f.save).not.toHaveBeenCalled();
    expect(inputs.every(input => new Uint8Array(input).every(byte => byte === 0))).toBe(true);
  });

  it('does not publish a snapshot after a profile change or storage reset during a write', async () => {
    const f = await fixture(), barrier = deferred(), epoch = storageEpoch();
    const save = vi.fn(async () => { await barrier.promise; });
    const pending = prepareSessionLock({ ...f, accountId: owner, trusted: true, save,
      guard: () => requireStorageEpoch(epoch), drain: async () => {}, capture: () => f });
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce()); beginStorageReset(); barrier.release();
    await expect(pending).rejects.toThrow('storage_reset_during_operation');
    expect(f.bytes.every(byte => byte === 37)).toBe(true);
    let current = false;
    await expect(prepareSessionLock({ ...f, accountId: owner, trusted: false,
      guard: () => { if (!current) throw Error('profile_changed'); }, drain: async () => {}, capture: () => f })).rejects.toThrow('profile_changed');
  });

  it('captures completed late writes only after all queued work settles', async () => {
    const f = await fixture(), tasks = new SessionTasks(), writes = new SerializedWrites(), barrier = deferred();
    tasks.track((async () => {
      await barrier.promise;
      tasks.track(writes.enqueue(async () => { f.data.aliases[peer] = 'late-alias'; f.message.delivery = 'delivered';
        f.data.chats.byPeer[peer].messages[0].delivery = 'delivered'; }));
    })());
    const capture = vi.fn(() => f);
    const pending = prepareSessionLock({ ...f, accountId: owner, trusted: false, guard: () => {},
      drain: async () => { await tasks.settled(); await writes.settled(); }, capture });
    await Promise.resolve(); expect(capture).not.toHaveBeenCalled(); barrier.release();
    const { session } = await pending, opened = await openLockedSession(session, f.key, owner, () => {});
    expect(opened.data.aliases[peer]).toBe('late-alias');
    expect(opened.data.chats.byPeer[peer].messages[0].delivery).toBe('delivered');
    expect(opened.files.get(`${peer}:${f.id}`)).toEqual(f.bytes);
  });

  it.each([false, true])('preserves a sticker import committed while lock waits (trusted=%s)', async trusted => {
    const f = await fixture(), tasks = new SessionTasks(), writes = new SerializedWrites(), barrier = deferred();
    const gif = Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), c => c.charCodeAt(0));
    const sticker = await prepareMedia(gif, 'one.gif'), pack = await makePack('late pack', [sticker]);
    tasks.track((async () => {
      await barrier.promise;
      await writes.enqueue(async () => {
        f.data.mediaLibrary = addMedia(emptyMediaLibrary(), [sticker], pack);
        f.files.set(libraryFileId(sticker.asset.id), gif);
        if (trusted) await f.save(f.data, f.files);
      });
    })());
    const pending = prepareSessionLock({ ...f, accountId: owner, trusted, guard: () => {},
      drain: async () => { await tasks.settled(); await writes.settled(); }, capture: () => f });
    barrier.release();
    const { session } = await pending;
    for (const bytes of f.files.values()) bytes.fill(0);
    const opened = await openLockedSession(session, f.key, owner, () => {});
    expect(opened.data.mediaLibrary?.packs).toEqual([pack]);
    expect(await sha256Hex(opened.files.get(libraryFileId(sticker.asset.id))!)).toBe(sticker.asset.hash);
    if (trusted) expect((await loadLocalChatData(f.key, owner))?.mediaLibrary?.packs).toEqual([pack]);
  });

  it('keeps partial incoming files retryable and never promotes them to received', async () => {
    const f = await fixture(), partial = new FileReceiver(f.bytes.length); partial.append(0, f.bytes.subarray(0, FILE_CHUNK_BYTES));
    const incoming = { ...f.message, id: crypto.randomUUID(), direction: 'incoming' as const, fileStatus: 'receiving' as const, fileProgress: partial.received };
    incoming.file = { ...incoming.file!, id: incoming.id };
    f.data.chats.byPeer[peer].messages.push(incoming);
    const { session } = await prepareSessionLock({ ...f, accountId: owner, trusted: false, guard: () => {},
      drain: async () => { partial.bytes.fill(0); }, capture: () => f });
    const opened = await openLockedSession(session, f.key, owner, () => {}), restored = restoreChats(opened.data.chats);
    expect(restored.byPeer[peer].messages[1].fileStatus).toBe('offered');
    expect(opened.files.has(`${peer}:${incoming.id}`)).toBe(false);
    expect(restored.byPeer[peer].messages[0].delivery).toBe('queued');
  });

  it('retries interrupted text with the same message ID after unlock and ignores the old sender result', async () => {
    const f = await fixture(), id = crypto.randomUUID(), barrier = deferred();
    f.current.byPeer[peer].messages = [{ id, from: owner, text: 'pending text', timestamp: 2, direction: 'outgoing', delivery: 'queued' }];
    f.current.byPeer[peer].contact = 'accepted'; f.current.byPeer[peer].connection = 'connected';
    let state = f.current, sender: TextSender | null = { send: vi.fn(async () => { await barrier.promise; }) };
    const outbox = new OutboxController({ state: () => state, setState: next => { state = next; }, sender: () => sender, persist: () => true });
    const old = outbox.flush(peer, sender!); await vi.waitFor(() => expect(state.byPeer[peer].messages[0].delivery).toBe('sending'));
    sender = null; outbox.reset();
    const { session } = await prepareSessionLock({ ...f, accountId: owner, trusted: false, guard: () => {}, drain: async () => {},
      capture: () => ({ data: normalizeLocalChatData({ chats: saveChats(state) }), files: f.files }) });
    barrier.release(); await old;
    const opened = await openLockedSession(session, f.key, owner, () => {}); state = restoreChats(opened.data.chats);
    expect(state.byPeer[peer].messages[0]).toMatchObject({ id, text: 'pending text', delivery: 'queued' });
    state.byPeer[peer].connection = 'connected'; sender = { send: vi.fn(async () => {}) };
    await outbox.flush(peer, sender);
    expect(sender.send).toHaveBeenCalledWith('pending text', peer, id);
    outbox.acknowledge(peer, id); outbox.reset();
  });
});
