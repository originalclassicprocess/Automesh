import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { accountFromMnemonic } from '$lib/application/account';
import { encodeAccountId } from '$lib/addressing/bech32m.js';
import { createFullBackup, openFullBackup, isFullBackup, disposeFullBackup, restoredChatData,
  MAX_FULL_BACKUP_BYTES, type BackupProfile } from './full-backup';
import { captureFullBackup, restoreFullBackup } from './full-backup-browser';
import { deriveChatStoreKey, loadLocalChatData, loadLocalFileData, saveLocalSessionData, type LocalChatData } from '$lib/chat/local-store';
import { sha256Hex } from '$lib/chat/file-transfer';
import { openBrowserProfileBundle } from '$lib/profiles/browser';
import { deriveProfileSeed } from '$lib/profiles/keys';
import { addMedia, emptyMediaLibrary, prepareMedia, libraryFileId } from '$lib/chat/media-library';
import { messageStatus } from '$lib/chat/message-presentation';
import { beginStorageReset } from '$lib/application/storage-reset';

// Public test vector; never reads browser user storage or a real account.
const phrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const mnemonic = new TextEncoder().encode(phrase), password = 'test-only-backup-password';
const peer = encodeAccountId(new Uint8Array(20).fill(2)), foreign = encodeAccountId(new Uint8Array(20).fill(3));
const fileId = '10000000-0000-4000-8000-000000000001', bytes = new Uint8Array([1,2,3,4]);
let owner: string, file: Blob;
const base = (): LocalChatData => ({ selfNickname: 'Test', readReceiptsEnabled: true, autoLockMinutes: 30,
  peerReadPreferences: {}, aliases: { [peer]: 'Friend' }, declaredNames: {}, peerPublicKeys: {},
  networkSettings: { quickReserve: true, nodes: [] }, chats: { order: [peer], byPeer: { [peer]: { contact: 'accepted',
    deletedIds: ['10000000-0000-4000-8000-000000000099'], messages: [
      { id: '10000000-0000-4000-8000-000000000002', from: peer, direction: 'incoming', text: 'private message', timestamp: 10 },
      { id: fileId, from: owner, direction: 'outgoing', text: '', timestamp: 20, delivery: 'queued', fileStatus: 'queued',
        file: { id: fileId, name: 'private.bin', size: 4, mime: 'application/octet-stream', sha256: '' } },
    ] } } } });
async function fixture(): Promise<BackupProfile> {
  const data = base(); data.chats.byPeer[peer].messages[1].file!.sha256 = await sha256Hex(bytes);
  return { accountId: owner, data, files: new Map([[`${peer}:${fileId}`, bytes.slice()]]) };
}
beforeAll(async () => {
  const account = await accountFromMnemonic(phrase); owner = account.accountId;
  account.identitySeed.fill(0); account.provider.dispose();
  file = (await createFullBackup({ seed: mnemonic, password, accountId: owner, nickname: 'Test', profiles: [await fixture()] })).file;
});
beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('IDBKeyRange', IDBKeyRange);
  const values = new Map<string,string>(); vi.stubGlobal('localStorage', { getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string,v: string) => values.set(k,v) });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('full encrypted backup', () => {
  it('round trips contacts, tombstones, messages, settings and exact attachment bytes', async () => {
    const opened = await openFullBackup(file, password, owner);
    try {
      expect(opened.accountId).toBe(owner); expect(new TextDecoder().decode(opened.seed)).toBe(phrase);
      expect(opened.full.summary).toEqual({ profiles: 1, contacts: 1, messages: 2, files: 1, missingFiles: 0 });
      expect(opened.full.profiles[0].data).toEqual((await fixture()).data);
      expect(opened.full.profiles[0].files.get(`${peer}:${fileId}`)).toEqual(bytes);
      const text = await file.text(); for (const secret of [phrase, owner, peer, 'private message', 'private.bin']) expect(text).not.toContain(secret);
      expect(isFullBackup(new Uint8Array(await file.slice(0,8).arrayBuffer()))).toBe(true);
    } finally { opened.seed.fill(0); disposeFullBackup(opened.full); }
  });
  it('refuses wrong passwords and foreign accounts', async () => {
    await expect(openFullBackup(file, 'wrong-password')).rejects.toThrow('backup_cannot_decrypt');
    await expect(openFullBackup(file, password, foreign)).rejects.toThrow('backup_wrong_account');
  });
  it.each([8, 24, 40])('authenticates corruption at byte %i', async offset => {
    const changed = new Uint8Array(await file.arrayBuffer()); changed[offset] ^= 1;
    await expect(openFullBackup(new Blob([changed]), password)).rejects.toThrow('backup_cannot_decrypt');
  });
  it('refuses truncation, appended bytes, unknown format and excessive size', async () => {
    await expect(openFullBackup(file.slice(0,file.size - 1),password)).rejects.toThrow();
    await expect(openFullBackup(new Blob([file,new Uint8Array([1])]),password)).rejects.toThrow();
    await expect(openFullBackup(new Blob([new Uint8Array(60)]),password)).rejects.toThrow('backup_invalid');
    const large = new Blob(); Object.defineProperty(large,'size',{ value: MAX_FULL_BACKUP_BYTES + 1 });
    await expect(openFullBackup(large,password)).rejects.toThrow('backup_too_large');
  });
  it('reports unavailable files; never invents bytes or silently drops corruption', async () => {
    const profile = await fixture(); profile.files.clear();
    const created = await createFullBackup({ seed: mnemonic,password,accountId: owner,nickname:'Test',profiles:[profile] });
    expect(created.summary.missingFiles).toBe(1);
    const corrupt = await fixture(); corrupt.files.get(`${peer}:${fileId}`)![0] = 99;
    await expect(createFullBackup({ seed: mnemonic,password,accountId: owner,nickname:'Test',profiles:[corrupt] })).rejects.toThrow('backup_file_corrupt');
  });
  it('rejects unrelated and duplicate profiles', async () => {
    const profile = await fixture(); profile.accountId = foreign;
    await expect(createFullBackup({ seed: mnemonic,password,accountId: owner,nickname:'Test',profiles:[profile] })).rejects.toThrow();
    const valid = await fixture();
    await expect(createFullBackup({ seed: mnemonic,password,accountId: owner,nickname:'Test',profiles:[valid,valid] })).rejects.toThrow();
  });
  it('honors cancellation during asynchronous crypto', async () => {
    let calls = 0;
    await expect(openFullBackup(file,password,owner,() => { if (++calls > 2) throw new Error('cancelled'); })).rejects.toThrow('cancelled');
  });
  it('restores no transport jobs, pending ACKs, automatic resends or automatic node connections', async () => {
    const profile = await fixture();
    profile.data.deviceSettings = { enabled: true, allowCached: true, peers: [], authority: {
      url: 'https://node.example', nodeId: 'a'.repeat(32), publicKey: '04' + 'b'.repeat(128) } };
    const restored = restoredChatData(profile);
    expect(restored.deviceSettings).toEqual({ ...profile.data.deviceSettings, enabled: false, allowCached: false });
    expect(profile.data.deviceSettings.enabled).toBe(true);
    expect(restored.offlineState).toBeUndefined(); expect(restored.courierState).toBeUndefined();
    expect(restored.chats.byPeer[peer].messages[1].delivery).toBeUndefined();
    expect(restored.chats.byPeer[peer].messages[1].fileStatus).toBe('ready');
    expect(restored.chats.byPeer[peer].messages[0].readState).toBe('skipped');
    expect(restored.networkSettings?.signalingEnabled).toBe(false);
    expect(profile.data.chats.byPeer[peer].messages[1].delivery).toBe('queued');
    expect(messageStatus(restored.chats.byPeer[peer].messages[1]).label).toBe('Из резервной копии');
  });
  it('retains GIF library metadata and exact library bytes', async () => {
    const profile=await fixture();
    const gif=Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'),c=>c.charCodeAt(0));
    const prepared=await prepareMedia(gif,'fixture.gif');
    profile.data.mediaLibrary=addMedia(emptyMediaLibrary(),[prepared]); profile.files.set(libraryFileId(prepared.asset.id),gif);
    const created=await createFullBackup({seed:mnemonic,password,accountId:owner,nickname:'Test',profiles:[profile]});
    const opened=await openFullBackup(created.file,password,owner);
    try {
      expect(opened.full.profiles[0].data.mediaLibrary).toEqual(profile.data.mediaLibrary);
      expect(opened.full.profiles[0].files.get(libraryFileId(prepared.asset.id))).toEqual(gif);
    } finally { opened.seed.fill(0); disposeFullBackup(opened.full); }
  });
  it('does not bypass media dimension checks even when an archive has matching hashes',async()=>{
    const profile=await fixture(), gif=Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'),c=>c.charCodeAt(0));
    const prepared=await prepareMedia(gif,'fixture.gif'); gif[6]=255;gif[7]=255;
    prepared.asset.hash=await sha256Hex(gif);
    profile.data.mediaLibrary=addMedia(emptyMediaLibrary(),[prepared]); profile.files.set(libraryFileId(prepared.asset.id),gif);
    await expect(createFullBackup({seed:mnemonic,password,accountId:owner,nickname:'Test',profiles:[profile]})).rejects.toThrow();
  });
  it('preserves the selected profile without changing account derivation',async()=>{
    const account=await accountFromMnemonic(phrase), bundle=await openBrowserProfileBundle({root:account.identitySeed,scope:owner,trusted:true});
    try {
      const registry=await bundle.initializePersonal(true), selected=registry.profiles.find(p=>p.role==='personal')!;
      const created=await createFullBackup({seed:mnemonic,password,accountId:owner,nickname:'Test',registry,selectedProfileId:selected.id,profiles:[await fixture()]});
      const opened=await openFullBackup(created.file,password,owner);
      try { expect(opened.full.selectedProfileId).toBe(selected.id); expect(opened.profiles).toEqual(registry); }
      finally { opened.seed.fill(0);disposeFullBackup(opened.full); }
    } finally { bundle.close();account.identitySeed.fill(0);account.provider.dispose(); }
  });
  it('rejects a contact public key that does not match its pinned address', async()=>{
    const profile=await fixture(), account=await accountFromMnemonic(phrase);
    try {
      profile.data.peerPublicKeys[peer]=account.publicKey;
      await expect(createFullBackup({seed:mnemonic,password,accountId:owner,nickname:'Test',profiles:[profile]})).rejects.toThrow('backup_invalid');
    } finally { account.identitySeed.fill(0); account.provider.dispose(); }
  });
  it('atomically imports only into empty storage and never overwrites a later history', async () => {
    const opened = await openFullBackup(file,password,owner), account = await accountFromMnemonic(phrase);
    const key = await deriveChatStoreKey(account.identitySeed,owner);
    try {
      await restoreFullBackup(opened.full,account.identitySeed,owner,undefined,() => {});
      expect((await loadLocalChatData(key,owner))?.aliases[peer]).toBe('Friend');
      expect(await loadLocalFileData(key,owner,`${peer}:${fileId}`)).toEqual(bytes);
      // Resume after a crash between committed data and vault/profile setup.
      await expect(restoreFullBackup(opened.full,account.identitySeed,owner,undefined,() => {})).resolves.toBeUndefined();
      await saveLocalSessionData(key,owner,{...base(),selfNickname:'Newer history'},new Map());
      await expect(restoreFullBackup(opened.full,account.identitySeed,owner,undefined,() => {})).rejects.toThrow('backup_destination_not_empty');
      expect((await loadLocalChatData(key,owner))?.selfNickname).toBe('Newer history');
    } finally { opened.seed.fill(0); disposeFullBackup(opened.full); account.identitySeed.fill(0); account.provider.dispose(); }
  });
  it('rolls back the entire import if attachment insertion fails', async () => {
    const opened = await openFullBackup(file,password,owner), account = await accountFromMnemonic(phrase);
    const key = await deriveChatStoreKey(account.identitySeed,owner);
    const { IDBObjectStore } = await import('fake-indexeddb'); const add = IDBObjectStore.prototype.add;
    vi.spyOn(IDBObjectStore.prototype,'add').mockImplementation(function(this: IDBObjectStore, value, key) {
      if (this.name === 'files') throw new Error('simulated quota failure'); return add.call(this,value,key);
    });
    try {
      await expect(restoreFullBackup(opened.full,account.identitySeed,owner,undefined,() => {})).rejects.toThrow();
      expect(await loadLocalChatData(key,owner)).toBeNull(); expect(await loadLocalFileData(key,owner,`${peer}:${fileId}`)).toBeNull();
    } finally { opened.seed.fill(0); disposeFullBackup(opened.full); account.identitySeed.fill(0); account.provider.dispose(); }
  });
  it('captures all derived profiles including archived ones, without unrelated accounts or pending file chunks', async () => {
    const account = await accountFromMnemonic(phrase), bundle = await openBrowserProfileBundle({ root:account.identitySeed,scope:owner,trusted:true });
    try {
      const registry = await bundle.initializePersonal(), child = registry.profiles.find(p => p.role === 'personal')!;
      await bundle.update(child.id,{archived:true});
      const childSeed = await deriveProfileSeed(account.identitySeed,child.index!,crypto.subtle);
      const childKey = await deriveChatStoreKey(childSeed,child.accountId); childSeed.fill(0);
      const profile = await fixture(); const childData = {...profile.data,chats:{order:[],byPeer:{}}};
      const key = await deriveChatStoreKey(account.identitySeed,owner);
      await saveLocalSessionData(key,owner,profile.data,profile.files);
      await saveLocalSessionData(childKey,child.accountId,childData,new Map([['pending:courier:1',new Uint8Array([9])]]));
      const foreignKey = await deriveChatStoreKey(new Uint8Array(32).fill(7),foreign);
      await saveLocalSessionData(foreignKey,foreign,{...childData,selfNickname:'foreign private'},new Map());
      const captured = await captureFullBackup(mnemonic,owner,() => {});
      expect(captured.profiles.map(p=>p.accountId).sort()).toEqual([owner,child.accountId].sort());
      expect(captured.registry?.profiles.find(p=>p.id===child.id)?.archived).toBe(true);
      expect(captured.profiles.find(p=>p.accountId===child.accountId)!.files.size).toBe(0);
      disposeFullBackup({ profiles:captured.profiles } as never);
    } finally { bundle.close(); account.identitySeed.fill(0); account.provider.dispose(); }
  });
  it('does not insert an earlier profile if a later profile already exists',async()=>{
    const account=await accountFromMnemonic(phrase), bundle=await openBrowserProfileBundle({root:account.identitySeed,scope:owner,trusted:true});
    try {
      const registry=await bundle.initializePersonal(), child=registry.profiles.find(p=>p.role==='personal')!;
      const childSeed=await deriveProfileSeed(account.identitySeed,child.index!,crypto.subtle);
      const childKey=await deriveChatStoreKey(childSeed,child.accountId); childSeed.fill(0);
      const rootKey=await deriveChatStoreKey(account.identitySeed,owner);
      const existing={...base(),chats:{order:[],byPeer:{}},selfNickname:'Keep existing child'};
      await saveLocalSessionData(childKey,child.accountId,existing,new Map());
      const profiles=[await fixture(),{accountId:child.accountId,data:existing,files:new Map<string,Uint8Array>()}];
      await expect(restoreFullBackup({profiles} as never,account.identitySeed,owner,registry,()=>{})).rejects.toThrow('backup_destination_not_empty');
      expect(await loadLocalChatData(rootKey,owner)).toBeNull();
      expect((await loadLocalChatData(childKey,child.accountId))?.selfNickname).toBe('Keep existing child');
    } finally { bundle.close(); account.identitySeed.fill(0); account.provider.dispose(); }
  });
  it('aborts an import if a storage reset happens before commit',async()=>{
    const account=await accountFromMnemonic(phrase), profile=await fixture();
    try {
      let guards=0;
      await expect(restoreFullBackup({profiles:[profile]} as never,account.identitySeed,owner,undefined,()=>{
        if (++guards===7) beginStorageReset();
        if (guards>7) throw new Error('session closed');
      })).rejects.toThrow();
    } finally { account.identitySeed.fill(0); account.provider.dispose(); }
  });
});
