import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { encodeAccountId } from '$lib/addressing/bech32m.js';
import { beginStorageReset } from '$lib/application/storage-reset';
import { removeMessages } from './chat-actions';
import { addMedia, emptyMediaLibrary, libraryFileId, prepareMedia } from './media-library';
import { cleanedHistory, managedFiles } from '$lib/application/storage-summary';
import { restoreChats, saveChats } from './session-chats';
import { clearAllChatStorage, deleteLocalFiles, deriveChatStoreKey, inspectChatStorage, loadLocalChatData,
  loadLocalFileData, saveChatDataWithFileDeletion, saveLocalChatData, saveLocalFileData, saveLocalSessionData, type LocalChatData } from './local-store';
const account = encodeAccountId(new Uint8Array(20).fill(1));
const other = encodeAccountId(new Uint8Array(20).fill(2));
const data: LocalChatData = { selfNickname: 'Test', readReceiptsEnabled: true, autoLockMinutes: 15,
  aliases: {}, declaredNames: {}, peerPublicKeys: {}, peerReadPreferences: {}, chats: { order: [], byPeer: {} } };
beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('IDBKeyRange', IDBKeyRange);
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value) });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('storage transactions', () => {
  it('keeps encrypted profile media independent from attachment deletion and history cleanup',async()=>{
    const key=await deriveChatStoreKey(new Uint8Array(32).fill(3),account);
    const gif=Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'),c=>c.charCodeAt(0));
    const media=await prepareMedia(gif,'secret.gif'); const mediaLibrary=addMedia(emptyMediaLibrary(),[media]);
    const id=libraryFileId(media.asset.id); const attachment=`${other}:${crypto.randomUUID()}`;
    await saveLocalSessionData(key,account,{...data,mediaLibrary},new Map([[id,gif],[attachment,gif]]));
    expect((await loadLocalChatData(key,account))?.mediaLibrary).toEqual(mediaLibrary);
    expect(await loadLocalFileData(key,other,id)).toBeNull();
    const inventory=await inspectChatStorage(account);
    expect(managedFiles(restoreChats(data.chats),inventory,new Map()).map(f=>f.id)).toEqual([attachment]);
    await saveChatDataWithFileDeletion(key,account,cleanedHistory({...data,mediaLibrary}),[attachment]);
    expect(await loadLocalFileData(key,account,id)).toEqual(gif);
    expect(await loadLocalFileData(key,account,attachment)).toBeNull();
    expect((await loadLocalChatData(key,account))?.mediaLibrary).toEqual(mediaLibrary);
    const wrongKey=await deriveChatStoreKey(new Uint8Array(32).fill(4),account);
    await expect(loadLocalFileData(wrongKey,account,id)).rejects.toThrow();
  });
  it('atomically removes a selected message/file, preserves other messages and persists its tombstone', async () => {
    const key = await deriveChatStoreKey(new Uint8Array(32).fill(3), account);
    const id = crypto.randomUUID(); const retained = crypto.randomUUID(); const fileKey = `${other}:${id}`;
    const baseline: LocalChatData = { ...data, chats: { order: [other], byPeer: { [other]: { contact: 'accepted', messages: [
      { id, from: other, text: 'remove', timestamp: 1, direction: 'incoming' },
      { id: retained, from: other, text: 'keep', timestamp: 2, direction: 'incoming' },
    ] } } } };
    await saveLocalChatData(key, account, baseline); await saveLocalFileData(key, account, fileKey, new Uint8Array([7]));
    const next = removeMessages(restoreChats(baseline.chats), other, [id]);
    await saveChatDataWithFileDeletion(key, account, { ...baseline, chats: saveChats(next) }, [fileKey]);
    const restored = await loadLocalChatData(key, account);
    expect(restored?.chats.byPeer[other].messages.map(message => message.id)).toEqual([retained]);
    expect(restored?.chats.byPeer[other].deletedIds).toEqual([id]);
    expect(await loadLocalFileData(key, account, fileKey)).toBeNull();
  });
  it('reports ciphertext payload sizes without opening another account', async () => {
    const key = await deriveChatStoreKey(new Uint8Array(32).fill(1), account);
    const otherKey = await deriveChatStoreKey(new Uint8Array(32).fill(2), other);
    await saveLocalChatData(key, account, data); await saveLocalChatData(otherKey, other, data);
    await saveLocalFileData(key, account, 'a', new Uint8Array(10));
    await saveLocalFileData(otherKey, other, 'secret-other-id', new Uint8Array(20));
    const inventory = await inspectChatStorage(account);
    expect(inventory.files).toEqual([{ id: 'a', bytes: 38 }]); expect(inventory.allFileBytes).toBe(86);
    expect(inventory.historyBytes).toBeGreaterThan(28); expect(inventory.otherAccountBytes).toBeGreaterThan(48);
    expect(JSON.stringify(inventory)).not.toContain('secret-other-id');
  });
  it('deletes exactly selected files and atomically replaces the account snapshot', async () => {
    const key = await deriveChatStoreKey(new Uint8Array(32).fill(1), account);
    await saveLocalChatData(key, account, data);
    await saveLocalFileData(key, account, 'a', new Uint8Array([1]));
    await saveLocalFileData(key, account, 'b', new Uint8Array([2]));
    await saveLocalFileData(key, other, 'a', new Uint8Array([3]));
    await saveChatDataWithFileDeletion(key, account, { ...data, selfNickname: 'Clean' }, ['a']);
    expect(await loadLocalFileData(key, account, 'a')).toBeNull();
    expect(await loadLocalFileData(key, account, 'b')).toEqual(new Uint8Array([2]));
    expect(await loadLocalFileData(key, other, 'a')).toEqual(new Uint8Array([3]));
    expect((await loadLocalChatData(key, account))?.selfNickname).toBe('Clean');
    await deleteLocalFiles(account); expect((await inspectChatStorage(account)).files).toEqual([]);
    expect(await loadLocalFileData(key, other, 'a')).not.toBeNull();
  });
  it('clears all accounts, not only the current account', async () => {
    const key = await deriveChatStoreKey(new Uint8Array(32).fill(1), account);
    for (const id of [account, other]) { await saveLocalChatData(key, id, data); await saveLocalFileData(key, id, 'a', new Uint8Array([1])); }
    await clearAllChatStorage();
    expect(await inspectChatStorage(account)).toEqual({ historyBytes: 0, otherAccountBytes: 0, allFileBytes: 0, files: [] });
    expect(await loadLocalChatData(key, account)).toBeNull(); expect(await loadLocalChatData(key, other)).toBeNull();
  });
  it('cannot resurrect an archive or file encrypted before a cross-tab emergency reset', async () => {
    const key = await deriveChatStoreKey(new Uint8Array(32).fill(1), account);
    for (const write of [() => saveLocalChatData(key, account, data), () => saveLocalFileData(key, account, 'a', new Uint8Array([1]))]) {
      const original = crypto.subtle.encrypt.bind(crypto.subtle);
      let ready!: () => void; let release!: () => void;
      const called = new Promise<void>(resolve => ready = resolve); const gate = new Promise<void>(resolve => release = resolve);
      const spy = vi.spyOn(crypto.subtle, 'encrypt').mockImplementation(async (...args) => {
        const cipher = await original(...args); ready(); await gate; return cipher;
      });
      const pending = write(); const assertion = expect(pending).rejects.toThrow('storage_reset_during_operation');
      await called; beginStorageReset(); await clearAllChatStorage(); release(); await assertion;
      spy.mockRestore(); expect((await inspectChatStorage(account)).allFileBytes).toBe(0);
      expect(await loadLocalChatData(key, account)).toBeNull();
    }
  });
});
