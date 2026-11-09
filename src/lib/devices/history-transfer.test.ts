import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore, IDBKeyRange } from 'fake-indexeddb';
import { encodeAccountId } from '../addressing/bech32m.js';
import { normalizeLocalChatData, saveLocalSessionData, loadLocalChatData, loadLocalFileData, snapshotLocalStorage } from '../chat/local-store';
import { restoreChats, setContactState, updateConversation, recordSentMessage } from '../chat/session-chats';
import { sha256Hex } from '../chat/file-transfer';
import { createHistorySender, createHistoryReceiver, idleHistoryStatus } from './history-transfer';
import { captureDeviceHistory, selectHistoryData, historyView, requireHistoryConsistency } from './history-data';
import { deviceHistoryStore, clearDeviceHistory } from './history-store';
import type { BackupProfile } from '../backup/full-backup';
import { beginStorageReset } from '../application/storage-reset';
const owner = encodeAccountId(new Uint8Array(20).fill(1)), device = encodeAccountId(new Uint8Array(20).fill(2)), peer = encodeAccountId(new Uint8Array(20).fill(3));
const id = '10000000-0000-4000-8000-000000000001';
let key: CryptoKey, rootKey: CryptoKey;
beforeEach(async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('IDBKeyRange', IDBKeyRange);
  const values = new Map<string, string>(); vi.stubGlobal('localStorage', { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v) });
  key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  rootKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function profile(size = 36000): Promise<BackupProfile> {
  const bytes = new Uint8Array(size).map((_, i) => i % 255);
  return { accountId: owner, data: normalizeLocalChatData({ aliases: { [peer]: 'Private friend' }, chats: { order: [peer], byPeer: { [peer]: { contact: 'accepted', messages: [
    { id, from: owner, text: 'Old private history', timestamp: 1, direction: 'outgoing', delivery: 'queued', deviceMessage: true,
      file: { id, name: 'private.bin', mime: 'application/octet-stream', size, sha256: await sha256Hex(bytes) }, fileStatus: 'queued' }
  ] } } } }), files: new Map([[`${peer}:${id}`, bytes]]) };
}
function rig(options: { authorize?: () => Promise<void>; commit?: (profile: BackupProfile) => Promise<void>; now?: () => number; guard?: () => void } = {}) {
  let source = idleHistoryStatus(), target = idleHistoryStatus(), commits = 0, allowed = true;
  const wire: Array<{ from: string; to: string; value: any }> = [], sent: any[] = [];
  const send = (from: string) => async (to: string, value: unknown) => { const item = { from, to, value: structuredClone(value) }; wire.push(item); sent.push(item); };
  const sender = createHistorySender({ owner, device, guard: options.guard ?? (() => {}), now: options.now, authorize: options.authorize ?? (async () => {}), send: send(owner), update: value => source = value });
  const receiver = createHistoryReceiver({ owner, device, guard: () => {}, now: options.now, allowed: () => allowed, send: send(device), update: value => target = value,
    commit: async data => { await options.commit?.(data); commits++; } });
  async function drain(filter: (item: typeof wire[number]) => boolean = () => true) {
    for (let i = 0; wire.length; i++) { if (i > 1000) throw new Error('history_test_loop'); const item = wire.shift()!; if (!filter(item)) continue;
      await (item.to === device ? receiver.receive(item.from, item.value) : sender.receive(item.from, item.value)); }
  }
  return { sender, receiver, wire, sent, drain, get source() { return source; }, get target() { return target; }, get commits() { return commits; },
    revoke() { allowed = false; }, close() { sender.close(); receiver.close(); } };
}
describe('independent encrypted history transfer', () => {
  it('waits for explicit recipient consent, validates encrypted archive and commits once', async () => {
    const store = deviceHistoryStore({ owner, device, key, guard: () => {} });
    const r = rig({ commit: async p => { await store.import(p); } });
    try {
      await r.sender.start(await profile()); await r.drain(); expect(r.target.phase).toBe('offered');
      expect(r.sent.some(row => row.value.op === 'chunk')).toBe(false); expect(r.commits).toBe(0);
      await r.receiver.accept(); await r.drain(); expect(r.source.phase).toBe('done'); expect(r.target.phase).toBe('done'); expect(r.commits).toBe(1);
      expect((await store.load())?.chats.byPeer[peer].messages[0]).toMatchObject({ restoredFromBackup: true, importedFromDevice: true, fileStatus: 'ready' });
      expect(await store.file(`${peer}:${id}`)).toEqual((await profile()).files.get(`${peer}:${id}`));
      const chunks = r.sent.filter(row => row.value.op === 'chunk');
      expect(JSON.stringify(chunks)).not.toContain('Old private history'); expect(JSON.stringify(chunks)).not.toContain('private.bin');
      await r.receiver.tick(); await r.drain(); expect(r.commits).toBe(1);
    } finally { r.close(); store.close(); }
  });
  it('recovers after lost final ACK and done without importing duplicate history', async () => {
    const r = rig(); let lostFinalAck = false, lostDone = false;
    const filter = (item: any) => {
      if (item.value.op === 'ack' && item.value.next === 3 && !lostFinalAck) { lostFinalAck = true; return false; }
      if (item.value.op === 'done' && !lostDone) { lostDone = true; return false; } return true;
    };
    try { await r.sender.start(await profile()); await r.drain(); await r.receiver.accept(); await r.drain(filter);
      await r.sender.tick(); await r.receiver.tick(); await r.drain(filter);
      await r.sender.tick(); await r.receiver.tick(); await r.drain();
      expect(lostDone).toBe(true); expect(r.commits).toBe(1); expect(r.source.phase).toBe('done');
    } finally { r.close(); }
  });
  it('rejects corrupted ciphertext without committing partial files or history', async () => {
    const r = rig(); let changed = false;
    try { await r.sender.start(await profile()); await r.drain(); await r.receiver.accept(); await r.drain(item => {
      if (item.value.op === 'chunk' && !changed) { item.value.data = (item.value.data[0] === 'A' ? 'B' : 'A') + item.value.data.slice(1); changed = true; } return true;
    }); expect(r.commits).toBe(0); expect(r.target.phase).toBe('error'); expect(r.source.phase).not.toBe('done');
    } finally { r.close(); }
  });
  it('ignores packets from a foreign or different delegated physical device', async () => {
    const r = rig();
    try { await r.sender.start(await profile(1)); const offer = r.wire.shift()!.value;
      await r.receiver.receive(peer, offer); expect(r.target.phase).toBe('idle');
      await r.receiver.receive(owner, { ...offer, device: peer }); expect(r.target.phase).toBe('idle');
      await r.receiver.receive(owner, offer); expect(r.target.phase).toBe('offered'); expect(r.commits).toBe(0);
    } finally { r.close(); }
  });
  it('stops on owner-side revocation during chunks; no stale-policy fallback', async () => {
    let checks = 0; const r = rig({ authorize: async () => { if (++checks >= 4) throw new Error('history_access'); } });
    try { await r.sender.start(await profile()); await r.drain(); await r.receiver.accept(); await r.drain();
      expect(r.source.phase).toBe('error'); expect(r.commits).toBe(0);
    } finally { r.close(); }
  });
  it('does not report success after storage failure or cancellation before commit', async () => {
    const failed = rig({ commit: async () => { throw new Error('quota'); } });
    try { await failed.sender.start(await profile(1)); await failed.drain(); await failed.receiver.accept(); await failed.drain();
      expect(failed.target.phase).toBe('error'); expect(failed.source.phase).not.toBe('done'); expect(failed.commits).toBe(0);
    } finally { failed.close(); }
    const cancelled = rig();
    try { await cancelled.sender.start(await profile(1)); await cancelled.drain(); await cancelled.receiver.accept(); await cancelled.drain(item => {
      if (item.value.op === 'ready') return false; return true;
    }); await cancelled.receiver.cancel(); await cancelled.drain(); expect(cancelled.commits).toBe(0);
    } finally { cancelled.close(); }
  });
  it('bounds expiry and declared archive size before allocating content', async () => {
    let now = Date.now(); const r = rig({ now: () => now });
    try { await r.sender.start(await profile(1)); const offer = r.wire.shift()!.value;
      await r.receiver.receive(owner, { ...offer, bytes: 129 * 1024 * 1024 }); expect(r.target.phase).toBe('error');
      now += 31 * 60000; await r.sender.tick(); expect(r.source.phase).toBe('error'); expect(r.commits).toBe(0);
    } finally { r.close(); }
  });
  it('cancels before consent without sending chunks, then accepts a new independent offer', async () => {
    const r = rig();
    try {
      await r.sender.start(await profile(1)); await r.drain(); await r.receiver.cancel(); await r.drain();
      expect(r.sent.some(item => item.value.op === 'chunk')).toBe(false); expect(r.source.phase).toBe('error');
      await r.sender.start(await profile(1)); await r.drain(); expect(r.target.phase).toBe('offered');
      await r.receiver.accept(); await r.drain(); expect(r.source.phase).toBe('done'); expect(r.commits).toBe(1);
      const sent = r.sent.length; await r.receiver.cancel(); await r.drain();
      expect(r.sent).toHaveLength(sent); // Hiding completed UI is not cancellation.
      await r.sender.start(await profile(1)); await r.drain(); expect(r.target.phase).toBe('offered');
      expect(r.commits).toBe(1); // A repeat still needs explicit consent.
    } finally { r.close(); }
  });
  it('notifies a waiting recipient when the owner closes before consent', async () => {
    const r = rig();
    try { await r.sender.start(await profile(1)); await r.drain(); r.sender.close(); await r.drain();
      expect(r.target.phase).toBe('error'); expect(r.target.error).toContain('Перенос остановлен');
      expect(r.commits).toBe(0); expect(r.sent.some(item => item.value.op === 'chunk')).toBe(false);
    } finally { r.close(); }
  });
  it('requires fresh owner authorization after archive verification, before commit', async () => {
    let revoked = false; const r = rig({ authorize: async () => { if (revoked) throw new Error('history_access'); } });
    try {
      await r.sender.start(await profile(1)); await r.drain(); await r.receiver.accept();
      await r.drain(item => { if (item.value.op === 'ready') revoked = true; return true; });
      expect(r.commits).toBe(0); expect(r.source.phase).toBe('error');
      expect(r.sent.some(item => item.value.op === 'commit')).toBe(false);
    } finally { r.close(); }
  });
  it('allows restart after preparation is interrupted before an offer exists', async () => {
    let hidden = true; const r = rig({ guard: () => { if (hidden) throw new Error('history_paused'); } });
    try {
      await r.sender.start(await profile(1)); expect(r.source.phase).toBe('error'); expect(r.wire).toHaveLength(0);
      hidden = false; await r.sender.start(await profile(1)); await r.drain();
      expect(r.target.phase).toBe('offered'); await r.receiver.accept(); await r.drain(); expect(r.source.phase).toBe('done');
    } finally { r.close(); }
  });
});

describe('history data cannot become live transport state', () => {
  it('orders history and delayed live messages chronologically, preserving equal-time source order and live status', async () => {
    const p = await profile(4), first = p.data.chats.byPeer[peer].messages[0];
    p.data.chats.byPeer[peer].messages = [{ ...first, id: 'z', timestamp: 3 }, { ...first, id: 'b', timestamp: 1 }, { ...first, id: 'a', timestamp: 1 }];
    const historical = selectHistoryData(p.data,[peer]);
    expect(historyView(restoreChats(normalizeLocalChatData({}).chats), historical).byPeer[peer].messages.map(m => m.id)).toEqual(['b','a','z']);
    const live = restoreChats(p.data.chats), before = JSON.stringify(live);
    expect(historyView(live,null).byPeer[peer].messages.map(m => m.id)).toEqual(['b','a','z']);
    expect(historyView(live,historical).byPeer[peer].messages.at(-1)?.delivery).toBe('queued');
    expect(JSON.stringify(live)).toBe(before);
  });
  it('captures selected profile chats and referenced files, excluding protected data and credentials', async () => {
    const p = await profile(4); Object.assign(p.data, { futureSecret: 'NEVER', seed: 'NEVER', selfAvatar: undefined });
    const protectedMessage = { ...p.data.chats.byPeer[peer].messages[0], id: crypto.randomUUID(), file: undefined, text: 'Ephemeral secret', details: { ephemeral: { views: 1, allowDownload: false } } };
    p.data.chats.byPeer[peer].messages.push(protectedMessage);
    await saveLocalSessionData(rootKey, owner, p.data, p.files);
    const captured = await captureDeviceHistory(owner, rootKey, [peer], true, () => {});
    expect(captured.data.chats.byPeer[peer].messages).toHaveLength(1); expect(captured.files.size).toBe(1);
    const json = JSON.stringify(captured.data);
    for (const field of ['seed','futureSecret','deviceSettings','networkSettings','offlineState','courierState','deviceMessage','deviceCopies']) expect(json).not.toContain('"' + field + '"');
    expect(json).not.toContain('Ephemeral secret');
  });
  it('does not allocate/count unrelated file ciphertext against the selected-history snapshot', async () => {
    const p = await profile(4); p.files.set('unrelated-file', new Uint8Array(20000));
    await saveLocalSessionData(rootKey, owner, p.data, p.files);
    const selected = await snapshotLocalStorage([owner], 10000, () => {}, file => file.id.startsWith(`${peer}:`));
    expect(selected.files.map(file => file.id)).toEqual([`${peer}:${id}`]);
    const metadata = await captureDeviceHistory(owner, rootKey, [peer], false, () => {});
    expect(metadata.files.size).toBe(0); expect(metadata.data.chats.byPeer[peer].messages).toHaveLength(1);
  });
  it('preserves live queued jobs, drafts, blocked contacts and deletion tombstones without mutation', async () => {
    const p = await profile(4), history = selectHistoryData(p.data, [peer]);
    let live = setContactState(restoreChats(p.data.chats), peer, 'blocked');
    live = updateConversation(live, peer, c => ({ ...c, messages: [], deletedIds: [id], draft: 'Not sent yet' }));
    const queued = { id: crypto.randomUUID(), from: owner, text: 'Live queued', timestamp: 100, direction: 'outgoing' as const, delivery: 'queued' as const, deviceMessage: true };
    live = recordSentMessage(live, peer, queued); const before = JSON.stringify(live);
    const view = historyView(live, history); expect(view.byPeer[peer].messages).toEqual([queued]); expect(view.byPeer[peer].draft).toBe('Not sent yet');
    expect(view.byPeer[peer].contact).toBe('blocked'); expect(JSON.stringify(live)).toBe(before);
  });
  it('rejects conflicting immutable message bodies, while timestamp/status differences do not replace live state', async () => {
    const p = await profile(4), other = normalizeLocalChatData(p.data);
    other.chats.byPeer[peer].messages[0].timestamp++; other.chats.byPeer[peer].messages[0].delivery = 'delivered';
    expect(() => requireHistoryConsistency(p.data, other)).not.toThrow();
    other.chats.byPeer[peer].messages[0].text = 'Forged'; expect(() => requireHistoryConsistency(p.data, other)).toThrow('conflict');
  });
  it('atomically stores history/files separately, merges repeats, and never changes live data or file bytes', async () => {
    const p = await profile(4), live = normalizeLocalChatData({ chats: { order: [], byPeer: {} }, selfNickname: 'Live device' });
    await saveLocalSessionData(key, device, live, new Map([['live-file', new Uint8Array([99])]]));
    const before = await loadLocalChatData(key, device), store = deviceHistoryStore({ owner, device, key, guard: () => {} });
    try { await store.import(p); await store.import(p);
      expect((await store.load())?.chats.byPeer[peer].messages).toHaveLength(1);
      expect(await loadLocalChatData(key, device)).toEqual(before); expect(await loadLocalFileData(key, device, 'live-file')).toEqual(new Uint8Array([99]));
      await clearDeviceHistory(); expect(await store.load()).toBeNull(); expect(await loadLocalChatData(key, device)).toEqual(before);
    } finally { store.close(); }
  });
  it('aborts both historical metadata and attachment writes on a transaction failure', async () => {
    const store = deviceHistoryStore({ owner, device, key, guard: () => {} }), p = await profile(4), original = IDBObjectStore.prototype.add;
    const fail = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function(this: IDBObjectStore, ...args) {
      if (this.name === 'files') throw new Error('quota'); return original.apply(this, args as any);
    });
    try { await expect(store.import(p)).rejects.toThrow('quota'); expect(await store.load()).toBeNull(); expect(await store.file(`${peer}:${id}`)).toBeNull(); }
    finally { fail.mockRestore(); store.close(); }
  });
  it('enforces the retained metadata bound on the very first import, before writing files', async () => {
    const store = deviceHistoryStore({ owner, device, key, guard: () => {} }), p = await profile(4);
    p.data.chats.byPeer[peer].messages[0].text = 'x'.repeat(16 * 1024 * 1024);
    try { await expect(store.import(p)).rejects.toThrow('history_capacity');
      expect(await store.load()).toBeNull(); expect(await store.file(`${peer}:${id}`)).toBeNull();
    } finally { store.close(); }
  });
  it('rejects duplicate IDs inside a single archive before they can break the live chat view', async () => {
    const store = deviceHistoryStore({ owner, device, key, guard: () => {} }), p = await profile(4);
    p.data.chats.byPeer[peer].messages.push({ ...p.data.chats.byPeer[peer].messages[0] });
    try { await expect(store.import(p)).rejects.toThrow('history_message_conflict'); expect(await store.load()).toBeNull();
      expect(await store.file(`${peer}:${id}`)).toBeNull();
    } finally { store.close(); }
  });
  it('binds encrypted history to device/owner/key and prevents post-reset resurrection', async () => {
    const store = deviceHistoryStore({ owner, device, key, guard: () => {} }); await store.import(await profile(4));
    const wrongKey = deviceHistoryStore({ owner, device, key: rootKey, guard: () => {} }), wrongOwner = deviceHistoryStore({ owner: peer, device, key, guard: () => {} });
    try { await expect(wrongKey.load()).rejects.toThrow(); await expect(wrongOwner.load()).rejects.toThrow('history_storage');
      beginStorageReset(); await expect(store.import(await profile(4))).rejects.toThrow('storage_reset');
    } finally { store.close(); wrongKey.close(); wrongOwner.close(); }
  });
  it('erases a deleted historical attachment and does not resurrect it on a repeated transfer', async () => {
    const store = deviceHistoryStore({ owner, device, key, guard: () => {} }), p = await profile(4);
    try { await store.import(p); await store.remove(peer, id); await store.import(p);
      expect((await store.load())?.chats.byPeer[peer].messages).toHaveLength(0); expect(await store.file(`${peer}:${id}`)).toBeNull();
    } finally { store.close(); }
  });
  it('clears only this device historical namespace and preserves another device and all live records', async () => {
    const store = deviceHistoryStore({ owner, device, key, guard: () => {} }), other = deviceHistoryStore({ owner, device: peer, key: rootKey, guard: () => {} });
    try { await store.import(await profile(4)); await other.import(await profile(4)); await store.clear();
      expect(await store.load()).toBeNull(); expect(await store.file(`${peer}:${id}`)).toBeNull(); expect(await other.load()).not.toBeNull();
    } finally { store.close(); other.close(); }
  });
  it('retries concurrent imports without lost messages or duplicate file accounting', async () => {
    const store = deviceHistoryStore({ owner, device, key, guard: () => {} }), p = await profile(4), q = await profile(4);
    const second = '10000000-0000-4000-8000-000000000002';
    const message = q.data.chats.byPeer[peer].messages[0]; message.id = second; message.file!.id = second;
    q.files = new Map([[`${peer}:${second}`, q.files.get(`${peer}:${id}`)!]]);
    try {
      await Promise.all([store.import(p), store.import(q)]);
      expect((await store.load())?.chats.byPeer[peer].messages).toHaveLength(2);
      expect(await store.file(`${peer}:${id}`)).toEqual(p.files.get(`${peer}:${id}`));
      expect(await store.file(`${peer}:${second}`)).toEqual(q.files.get(`${peer}:${second}`));
      await store.import(p); expect((await store.load())?.chats.byPeer[peer].messages).toHaveLength(2);
    } finally { store.close(); }
  });
});
