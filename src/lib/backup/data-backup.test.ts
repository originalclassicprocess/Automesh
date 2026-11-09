import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb';
import { accountFromMnemonic } from '$lib/application/account';
import { encodeAccountId } from '$lib/addressing/bech32m.js';
import { normalizeLocalChatData, deriveChatStoreKey, loadLocalChatData, loadLocalFileData,
  saveLocalSessionData, snapshotLocalStorage, sealChatData, replaceObservedLocalStorage } from '$lib/chat/local-store';
import { sha256Hex } from '$lib/chat/file-transfer';
import { createDataBackup, openDataBackup, isDataBackup, dataOnlyChatData, type DataBackupContents } from './data-backup';
import { restoreDataBackupToStore } from './data-backup-browser';
import { disposeFullBackup, openFullBackup, type BackupProfile } from './full-backup';
import { beginStorageReset } from '$lib/application/storage-reset';

const phrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const password = 'separate-data-password-2026';
const peer = encodeAccountId(new Uint8Array(20).fill(2)), other = encodeAccountId(new Uint8Array(20).fill(3));
const id = '10000000-0000-4000-8000-000000000001', fileId = `${peer}:${id}`, content = new Uint8Array([1, 2, 3, 4]);
let owner: string, identitySeed: Uint8Array, file: Blob;
async function profile(): Promise<BackupProfile> {
  return { accountId: owner, data: normalizeLocalChatData({ selfNickname: 'Backup fixture', aliases: { [peer]: 'Friend' },
    readReceiptsEnabled: true, autoLockMinutes: 30, seedBackupVerified: true,
    networkSettings: { quickReserve: true, nodes: [{ url: 'wss://private-node.invalid/signal', enabled: true }] },
    deviceSettings: { enabled: true, allowCached: false, authority: null, peers: [] },
    chats: { order: [peer], byPeer: { [peer]: { contact: 'accepted', deletedIds: ['10000000-0000-4000-8000-000000000099'], messages: [
      { id, from: owner, direction: 'outgoing', text: 'private history', timestamp: 10, delivery: 'queued', deviceMessage: true,
        courierVia: 'private-route', fileStatus: 'queued', file: { id, name: 'fixture.bin', size: 4, mime: 'application/octet-stream', sha256: await sha256Hex(content) } },
    ] } } } }), files: new Map([[fileId, content.slice()]]) };
}
beforeAll(async () => {
  const account = await accountFromMnemonic(phrase); owner = account.accountId; identitySeed = account.identitySeed.slice();
  account.identitySeed.fill(0); account.provider.dispose();
  file = (await createDataBackup({ profile: await profile(), accountId: owner, password })).file;
});
beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('IDBKeyRange', IDBKeyRange);
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('independent encrypted data-only backup', () => {
  it('roundtrips history/files but contains no identity, network or device credentials', async () => {
    const data = await openDataBackup(file, password, owner);
    try {
      expect(isDataBackup(new Uint8Array(await file.slice(0, 8).arrayBuffer()))).toBe(true);
      expect(Object.keys(data).sort()).toEqual(['accountId', 'backupId', 'createdAt', 'profiles', 'summary']);
      expect(data.summary).toEqual({ profiles: 1, contacts: 1, messages: 1, files: 1, missingFiles: 0 });
      expect(data.profiles[0].files.get(fileId)).toEqual(content);
      const serialized = JSON.stringify(data.profiles[0].data);
      for (const field of ['seed', 'networkSettings', 'deviceSettings', 'offlineState', 'courierState', 'deviceMessage', 'courierVia']) expect(serialized).not.toContain(`"${field}"`);
      for (const secret of [phrase, owner, peer, 'private history', 'fixture.bin']) expect(await file.text()).not.toContain(secret);
      await expect(openFullBackup(file, password)).rejects.toThrow('backup_invalid');
    } finally { disposeFullBackup(data); }
  });
  it('uses an allowlist even if a new secret field is added to runtime data', async () => {
    const data = (await profile()).data;
    Object.assign(data, { seed: phrase, devicePrivateKey: 'private', futureCredential: 'private' });
    const result = dataOnlyChatData(data);
    expect(result).not.toHaveProperty('seed'); expect(result).not.toHaveProperty('futureCredential');
    expect(result).not.toHaveProperty('devicePrivateKey'); expect(result).not.toHaveProperty('seedBackupVerified');
    expect(data.chats.byPeer[peer].messages[0].deviceMessage).toBe(true);
  });
  it('excludes disappearing bodies and opening reports', async () => {
    const source = await profile(), message = source.data.chats.byPeer[peer].messages[0];
    source.data.chats.byPeer[peer].messages.push({ ...message, id: crypto.randomUUID(), file: undefined,
      text: 'protected', details: { ephemeral: { views: 1, allowDownload: false } } });
    const created = await createDataBackup({ profile: source, accountId: owner, password });
    const data = await openDataBackup(created.file, password, owner);
    try { expect(data.summary.messages).toBe(1); expect(JSON.stringify(data.profiles[0].data)).not.toContain('protected'); }
    finally { disposeFullBackup(data); }
  });
  it('refuses wrong passwords, foreign accounts and mismatched export scopes', async () => {
    await expect(openDataBackup(file, 'wrong-password')).rejects.toThrow('backup_cannot_decrypt');
    await expect(openDataBackup(file, password, other)).rejects.toThrow('backup_wrong_account');
    await expect(createDataBackup({ profile: await profile(), accountId: other, password })).rejects.toThrow('backup_wrong_account');
  });
  it.each([8, 24, 40])('authenticates altered header/cipher byte %i', async index => {
    const changed = new Uint8Array(await file.arrayBuffer()); changed[index] ^= 1;
    await expect(openDataBackup(new Blob([changed]), password)).rejects.toThrow('backup_cannot_decrypt');
  });
  it('refuses truncated/trailing ciphertext, weak passwords and cancelled work', async () => {
    await expect(openDataBackup(file.slice(0, file.size - 1), password)).rejects.toThrow();
    await expect(openDataBackup(new Blob([file, new Uint8Array([0])]), password)).rejects.toThrow();
    await expect(createDataBackup({ profile: await profile(), accountId: owner, password: 'short' })).rejects.toThrow('backup_password_short');
    await expect(openDataBackup(file, password, owner, () => { throw new Error('cancelled'); })).rejects.toThrow('cancelled');
  });
  it('reports missing files and refuses corrupt bytes rather than truncating them', async () => {
    const source = await profile(); source.files.clear();
    const created = await createDataBackup({ profile: source, accountId: owner, password });
    expect(created.summary.missingFiles).toBe(1);
    source.files.set(fileId, new Uint8Array([5, 6, 7, 8]));
    await expect(createDataBackup({ profile: source, accountId: owner, password })).rejects.toThrow('backup_file_corrupt');
  });
  it('refuses an authenticated archive that smuggles identity or network fields into its manifest', async () => {
    const header = new Uint8Array(await file.slice(0, 36).arrayBuffer());
    const aad = new TextEncoder().encode('Automesh data backup v1:PBKDF2-SHA256-600000:AES-256-GCM');
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', iterations: 600000, salt: header.slice(8, 24) }, material,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: header.slice(24, 36), additionalData: aad }, key, await file.slice(36).arrayBuffer()));
    try {
      const size = new DataView(plain.buffer).getUint32(0), meta = JSON.parse(new TextDecoder().decode(plain.subarray(4, 4 + size)));
      meta.data.seed = phrase;
      const json = new TextEncoder().encode(JSON.stringify(meta)), forged = new Uint8Array(4 + json.length + plain.length - 4 - size);
      new DataView(forged.buffer).setUint32(0, json.length); forged.set(json, 4); forged.set(plain.subarray(4 + size), 4 + json.length);
      // New nonce for the modified fixture; never reuse an AEAD nonce.
      const iv = crypto.getRandomValues(new Uint8Array(12)); header.set(iv, 24);
      const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, forged);
      forged.fill(0); json.fill(0);
      await expect(openDataBackup(new Blob([header, cipher]), password, owner)).rejects.toThrow('backup_invalid');
    } finally { plain.fill(0); }
  });
});

describe('data-only restore in an authenticated profile', () => {
  let opened: DataBackupContents, key: CryptoKey;
  beforeEach(async () => { opened = await openDataBackup(file, password, owner); key = await deriveChatStoreKey(identitySeed, owner); });
  afterEach(() => disposeFullBackup(opened));
  const baseline = () => normalizeLocalChatData({ selfNickname: 'Current', seedBackupVerified: true,
    networkSettings: { quickReserve: false, nodes: [] }, deviceSettings: { enabled: false, allowCached: false, authority: null, peers: [] } });
  it('restores into initialized empty storage, preserves local authority/settings and does not replay outgoing messages', async () => {
    const before = baseline(); await saveLocalSessionData(key, owner, before, new Map());
    const restored = await restoreDataBackupToStore(opened, key, owner, () => {});
    expect(restored.networkSettings).toEqual(before.networkSettings); expect(restored.deviceSettings).toEqual(before.deviceSettings);
    expect(restored.seedBackupVerified).toBe(true);
    const message = restored.chats.byPeer[peer].messages[0];
    expect(message.restoredFromBackup).toBe(true); expect(message.delivery).toBeUndefined(); expect(message.deviceMessage).toBeUndefined();
    expect(await loadLocalFileData(key, owner, fileId)).toEqual(content);
    expect((await loadLocalChatData(key, owner))?.aliases[peer]).toBe('Friend');
  });
  it('refuses existing messages/contacts and foreign destination without changing either', async () => {
    const before = (await profile()).data; await saveLocalSessionData(key, owner, before, new Map());
    await expect(restoreDataBackupToStore(opened, key, owner, () => {})).rejects.toThrow('backup_destination_not_empty');
    await expect(restoreDataBackupToStore(opened, key, other, () => {})).rejects.toThrow('backup_wrong_account');
    expect((await loadLocalChatData(key, owner))?.chats.byPeer[peer].messages[0].restoredFromBackup).not.toBe(true);
  });
  it('atomically rolls back the account replacement if an attachment cannot be inserted', async () => {
    const before = baseline(); await saveLocalSessionData(key, owner, before, new Map());
    const add = IDBObjectStore.prototype.add;
    vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function(this: IDBObjectStore, value, key) {
      if (this.name === 'files') throw new Error('simulated quota'); return add.call(this, value, key);
    });
    await expect(restoreDataBackupToStore(opened, key, owner, () => {})).rejects.toThrow();
    expect((await loadLocalChatData(key, owner))?.selfNickname).toBe('Current');
    expect(await loadLocalFileData(key, owner, fileId)).toBeNull();
  });
  it('does not overwrite a concurrent write between observation and transaction', async () => {
    await saveLocalSessionData(key, owner, baseline(), new Map());
    const observed = (await snapshotLocalStorage([owner], 1024 * 1024, () => {})).accounts[0];
    const next = await sealChatData(key, owner, (await profile()).data);
    await saveLocalSessionData(key, owner, { ...baseline(), selfNickname: 'Concurrent update' }, new Map());
    await expect(replaceObservedLocalStorage({ accounts: [next], files: [] }, observed, () => {})).rejects.toThrow('backup_destination_changed');
    expect((await loadLocalChatData(key, owner))?.selfNickname).toBe('Concurrent update');
  });
  it('does not resurrect a snapshot after an emergency storage reset', async () => {
    await saveLocalSessionData(key, owner, baseline(), new Map());
    let calls = 0;
    await expect(restoreDataBackupToStore(opened, key, owner, () => {
      if (++calls === 5) beginStorageReset();
    })).rejects.toThrow('storage_reset_during_operation');
    expect((await loadLocalChatData(key, owner))?.selfNickname).toBe('Current');
  });
});
