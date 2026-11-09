import { describe, expect, it } from 'vitest';
import { encodeAccountId } from '$lib/addressing/bech32m.js';
import { deriveChatStoreKey, openSealedChatData, openSealedFileData, sealChatData, sealLocalFileData, snapshotLocalChatData, type LocalChatData } from './local-store';
import { emptyCourierState, restoreCourierState } from '$lib/node/courier-state';
import { emptyOfflineState, restoreOfflineState } from '$lib/node/offline-state';
import { avatarFixture } from './avatar.fixture';
import { idleCall } from '$lib/calls/controller';
import { callRecordLabel } from '$lib/calls/history';
import {portableChatData} from '$lib/backup/full-backup';
import {dataOnlyChatData} from '$lib/backup/data-backup';
import {dataDestinationEmpty} from '$lib/backup/data-backup-browser';

const accountId = encodeAccountId(new Uint8Array(20).fill(1));
const otherId = encodeAccountId(new Uint8Array(20).fill(2));

describe('encrypted local chat data', () => {
  it('encrypts native channel history separately from account chats and retains it in portable data without radio secrets',async()=>{
    const key=await deriveChatStoreKey(new Uint8Array(32).fill(25),accountId);
    const data:LocalChatData={selfNickname:'',readReceiptsEnabled:true,autoLockMinutes:15,peerReadPreferences:{},aliases:{},declaredNames:{},peerPublicKeys:{},chats:{order:[],byPeer:{}},
      meshtastic:{enabled:true,channels:[{key:'a'.repeat(64),node:100,index:1,name:'City',public:true,signature:false,unread:1,messages:[{id:7,from:200,name:'🌲',text:'native channel private local copy',timestamp:1000,outgoing:false,status:'accepted'}]}]}};
    const sealed=await sealChatData(key,accountId,data);expect(new TextDecoder().decode(sealed.cipher)).not.toContain('native channel');
    const restored=await openSealedChatData(key,accountId,sealed);expect(restored.meshtastic).toEqual(data.meshtastic);expect(restored.chats.order).toEqual([]);
    const portable=portableChatData(restored);expect(portable.meshtastic).toEqual(data.meshtastic);expect(portable.radioState).toBeUndefined();
    expect(dataOnlyChatData(restored).meshtastic).toEqual(data.meshtastic);expect(dataDestinationEmpty(restored,accountId)).toBe(false);
    await expect(openSealedChatData(key,otherId,sealed)).rejects.toThrow('account_mismatch');
  });
  it('persists terminal node notices and their dismissal without resuming a send', () => {
    for(const nodeQueue of ['canceling','canceled','expired'] as const){
      const owner=encodeAccountId(new Uint8Array(20).fill(7));
      const data:LocalChatData={selfNickname:'',readReceiptsEnabled:true,autoLockMinutes:15,peerReadPreferences:{},aliases:{},declaredNames:{},peerPublicKeys:{},chats:{order:[owner],byPeer:{[owner]:{messages:[{id:'notice',from:owner,direction:'outgoing',text:'test',timestamp:1,delivery:'stored',nodeQueue,nodeQueueDismissed:true}]}}}};
      const row=snapshotLocalChatData(data).chats.byPeer[owner].messages[0];
      expect(row.nodeQueue).toBe(nodeQueue);expect(row.nodeQueueDismissed).toBe(true);
    }
  });
  it('recovers committed saving rows as queued and only retains allowlisted delivery diagnostics', async () => {
    const key = await deriveChatStoreKey(new Uint8Array(32).fill(25), accountId);
    const entry = { id: crypto.randomUUID(), from: accountId, direction: 'outgoing' as const, timestamp: 1, text: 'durable draft', delivery: 'saving' as const,
      deliveryIssue: 'node_denied' as const, deliveryError: 'not_member' as const, directFallback: true };
    const data: LocalChatData = { selfNickname: '', readReceiptsEnabled: true, autoLockMinutes: 15, peerReadPreferences: {}, aliases: {}, declaredNames: {}, peerPublicKeys: {},
      chats: { order: [otherId], byPeer: { [otherId]: { contact: 'accepted', messages: [entry] } } } };
    const opened = await openSealedChatData(key, accountId, await sealChatData(key, accountId, data));
    expect(opened.chats.byPeer[otherId].messages[0]).toMatchObject({ ...entry, delivery: 'queued' });
    const malformed = { ...entry, deliveryIssue: 'https://secret.invalid/token', deliveryError: 'secret-body', directFallback: 'true' };
    const sanitized = await openSealedChatData(key, accountId, await sealChatData(key, accountId, { ...data, chats: { order: [otherId], byPeer: { [otherId]: { contact: 'accepted', messages: [malformed] } } } } as unknown as LocalChatData));
    const row = sanitized.chats.byPeer[otherId].messages[0];
    expect(row.deliveryIssue).toBeUndefined(); expect(row.deliveryError).toBeUndefined(); expect(row.directFallback).toBeUndefined();
  });
  it('preserves local ended-call history in ciphertext without adding delivery jobs', async () => {
    const key = await deriveChatStoreKey(new Uint8Array(32).fill(25), accountId);
    const localCall = { ...idleCall(), id: crypto.randomUUID(), outgoing: true, phase: 'ended' as const, created: 1000, started: 2000, ended: 19000, reason: 'finished' as const };
    const data: LocalChatData = { selfNickname: '', readReceiptsEnabled: true, autoLockMinutes: 15, peerReadPreferences: {}, aliases: {}, declaredNames: {}, peerPublicKeys: {},
      chats: { order: [otherId], byPeer: { [otherId]: { contact: 'accepted', messages: [{ id: localCall.id, from: accountId, direction: 'outgoing', timestamp: 1000, text: callRecordLabel(localCall), localCall, readState: 'skipped' }] } } } };
    const sealed = await sealChatData(key, accountId, data);
    expect(new TextDecoder().decode(sealed.cipher)).not.toContain('localCall');
    const reopened = await openSealedChatData(key, accountId, sealed);
    const entry = reopened.chats.byPeer[otherId].messages[0];
    expect(entry.localCall).toMatchObject({ id: localCall.id, ended: 19000 }); expect(entry.text).toContain('0:17'); expect(entry.delivery).toBeUndefined();
  });
  it('keeps photo avatars in encrypted account-bound storage and removes invalid sources', async () => {
    const key = await deriveChatStoreKey(new Uint8Array(32).fill(25), accountId);
    const data: LocalChatData = { selfNickname: 'Alice', selfAvatar: avatarFixture(), peerAvatars: { [otherId]: avatarFixture(1) },
      readReceiptsEnabled: true, autoLockMinutes: 5, peerReadPreferences: {}, aliases: {}, declaredNames: {}, peerPublicKeys: {}, chats: { order: [], byPeer: {} } };
    const sealed = await sealChatData(key, accountId, data);
    expect(new TextDecoder().decode(sealed.cipher)).not.toContain(data.selfAvatar);
    expect(await openSealedChatData(key, accountId, sealed)).toEqual(data);
    await expect(openSealedChatData(key, otherId, sealed)).rejects.toThrow('account_mismatch');
    const invalid = await sealChatData(key, accountId, { ...data, selfAvatar: 'https://tracking.test/avatar', peerAvatars: { [otherId]: 'data:image/svg+xml;base64,PHN2Zy8+' } });
    expect(await openSealedChatData(key, accountId, invalid)).toMatchObject({ selfAvatar: '', peerAvatars: {} });
  });
  it('locks and unlocks repeated reactive snapshots without DataCloneError or changing queued state', async () => {
    const key = await deriveChatStoreKey(new Uint8Array(32).fill(25), accountId);
    const state = new Proxy(emptyCourierState(), {}); const offline = new Proxy(emptyOfflineState(), {});
    expect(() => restoreCourierState(state)).toThrow(); // Same failure as Svelte state passed to structuredClone.
    const live: LocalChatData = { selfNickname: 'Alice', readReceiptsEnabled: true, autoLockMinutes: 5,
      peerReadPreferences: {}, aliases: {}, declaredNames: {}, peerPublicKeys: {}, chats: { order: [], byPeer: {} },
      courierState: state, offlineState: offline };
    const locked = snapshotLocalChatData(live);
    live.selfNickname = 'changed'; state.enabled = true;
    expect(locked.selfNickname).toBe('Alice'); expect(locked.courierState?.enabled).toBe(false);
    for (let i = 0; i < 3; i++) {
      expect(restoreCourierState(locked.courierState).keys).toEqual([]);
      expect(restoreOfflineState(locked.offlineState).pending).toEqual([]);
      const reopened = await openSealedChatData(key, accountId, await sealChatData(key, accountId, locked));
      expect(reopened).toEqual(locked);
    }
  });
  it('preserves Saved, reply/forward/contact metadata, counters and tombstones in encrypted storage', async () => {
    const key = await deriveChatStoreKey(new Uint8Array(32).fill(25), accountId);
    const id = '12345678-1234-4234-8234-123456789abc';
    const data: LocalChatData = { selfNickname: 'Alice', readReceiptsEnabled: true, autoLockMinutes: 15,
      allowForwardAttribution: false, peerReadPreferences: {}, aliases: {}, declaredNames: {}, peerPublicKeys: {},
      chats: { order: [accountId], byPeer: { [accountId]: { contact: 'accepted', deletedIds: [id], messages: [{
        id: crypto.randomUUID(), from: accountId, direction: 'outgoing', text: 'saved reply', timestamp: 1,
        details: { reply: { id, from: accountId, preview: 'quote' }, forwarded: { sourceId: id },
          contactCard: { accountId: otherId, nickname: 'Bob' }, allowForwardAttribution: false }, forwardedTo: [otherId],
      }] } } } };
    const record = await sealChatData(key, accountId, data);
    expect(await openSealedChatData(key, accountId, record)).toEqual(data);
    expect(new TextDecoder().decode(record.cipher)).not.toContain('quote');
  });
  it('preserves explicit file/media preferences and local deletion markers inside ciphertext', async () => {
    const key = await deriveChatStoreKey(new Uint8Array(32).fill(21), accountId);
    const data: LocalChatData = { selfNickname: '', readReceiptsEnabled: true, autoLockMinutes: 15,
      autoReceiveFilesEnabled: false, autoPlayVideoEnabled: false, cleanImageMetadataEnabled: false, peerReadPreferences: {}, aliases: {}, declaredNames: {}, peerPublicKeys: {},
      chats: { order: [otherId], byPeer: { [otherId]: { contact: 'accepted', messages: [{
        id: '12345678-1234-4234-8234-123456789abc', from: otherId, direction: 'incoming', text: '', timestamp: 1,
        file: { id: '12345678-1234-4234-8234-123456789abc', name: 'photo.png', mime: 'image/png', size: 10, sha256: 'a'.repeat(64) },
        fileDeleted: true, fileStatus: 'canceled',
      }] } } } };
    const record = await sealChatData(key, accountId, data);
    expect(await openSealedChatData(key, accountId, record)).toEqual(data);
    expect(new TextDecoder().decode(record.cipher)).not.toContain('autoReceiveFilesEnabled');
    expect(new TextDecoder().decode(record.cipher)).not.toContain('cleanImageMetadataEnabled');
  });
  it('persists backup verification only as an explicit boolean in the encrypted account archive', async () => {
    const key = await deriveChatStoreKey(new Uint8Array(32).fill(19), accountId);
    const data: LocalChatData = { selfNickname: '', seedBackupVerified: true, readReceiptsEnabled: false,
      autoLockMinutes: 15, peerReadPreferences: {}, aliases: {}, declaredNames: {}, peerPublicKeys: {},
      chats: { order: [], byPeer: {} } };
    const sealed = await sealChatData(key, accountId, data);
    expect(new TextDecoder().decode(sealed.cipher)).not.toContain('seedBackupVerified');
    expect((await openSealedChatData(key, accountId, sealed)).seedBackupVerified).toBe(true);
    const unverified = await sealChatData(key, accountId, { ...data, seedBackupVerified: false });
    expect((await openSealedChatData(key, accountId, unverified)).seedBackupVerified).toBe(false);
    const malformed = await sealChatData(key, accountId, { ...data, seedBackupVerified: 'true' } as unknown as LocalChatData);
    expect((await openSealedChatData(key, accountId, malformed)).seedBackupVerified).not.toBe(true);
  });
  it('encrypts local node addresses/preferences alongside history without changing the account key', async () => {
    const key = await deriveChatStoreKey(new Uint8Array(32).fill(8), accountId);
    const data: LocalChatData = { selfNickname: '', readReceiptsEnabled: false, autoLockMinutes: 15,
      peerReadPreferences: {}, aliases: {}, declaredNames: {}, peerPublicKeys: {}, chats: { order: [], byPeer: {} },
      networkSettings: { quickReserve: true, nodes: [{ url: 'wss://192.168.0.20:3002/signal', name: 'Home', enabled: true }] } };
    const sealed = await sealChatData(key, accountId, data);
    expect(new TextDecoder().decode(sealed.cipher)).not.toContain('192.168.0.20');
    expect(await openSealedChatData(key, accountId, sealed)).toEqual(data);
  });
  it('round-trips across reload with the same seed, but not a different account or seed', async () => {
    const seed = new Uint8Array(32).fill(3);
    const key = await deriveChatStoreKey(seed, accountId);
    const data: LocalChatData = {
      selfNickname: 'Alice',
      readReceiptsEnabled: true,
      autoLockMinutes: 0,
      peerReadPreferences: { [otherId]: true },
      aliases: { [otherId]: 'Друг' },
      declaredNames: {},
      peerPublicKeys: {},
      chats: {
        order: [otherId],
        byPeer: {
          [otherId]: {
            contact: 'pending',
            messages: [{ id: 'm1', text: 'secret chat text', from: otherId, timestamp: 1, direction: 'incoming', readState: 'waiting' }],
          },
        },
      },
    };
    const sealed = await sealChatData(key, accountId, data);
    expect(new TextDecoder().decode(sealed.cipher)).not.toContain('secret chat text');
    expect(await openSealedChatData(await deriveChatStoreKey(seed, accountId), accountId, sealed)).toEqual(data);
    await expect(openSealedChatData(key, otherId, sealed)).rejects.toThrow();
    const wrongKey = await deriveChatStoreKey(new Uint8Array(32).fill(4), accountId);
    await expect(openSealedChatData(wrongKey, accountId, sealed)).rejects.toThrow();
  });

  it('opens a pre-request archive as accepted chats with read receipts off', async () => {
    const key = await deriveChatStoreKey(new Uint8Array(32).fill(9), accountId);
    const legacy = {
      selfNickname: 'Old', aliases: {}, declaredNames: {}, peerPublicKeys: {},
      chats: { order: [otherId], byPeer: { [otherId]: {
        messages: [{ id: 'old', text: 'earlier', from: otherId, timestamp: 1, direction: 'incoming' as const }],
      } } },
    };
    const sealed = await sealChatData(key, accountId, legacy as LocalChatData);
    const opened = await openSealedChatData(key, accountId, sealed);
    expect(opened.readReceiptsEnabled).toBe(false);
    expect(opened.autoLockMinutes).toBe(15);
    expect(opened.seedBackupVerified).not.toBe(true);
    expect(opened.peerReadPreferences).toEqual({});
    expect(opened.chats.byPeer[otherId].contact).toBe('accepted');
  });

  it('preserves safe file metadata and blocked contact state in sealed history', async () => {
    const key = await deriveChatStoreKey(new Uint8Array(32).fill(7), accountId);
    const offer = { id: '12345678-1234-4234-8234-123456789abc', name: 'sample.txt', size: 3,
      mime: 'text/plain', sha256: 'a'.repeat(64) };
    const data: LocalChatData = {
      selfNickname: '', readReceiptsEnabled: false, peerReadPreferences: {}, aliases: {}, declaredNames: {}, peerPublicKeys: {},
      autoLockMinutes: 5,
      chats: { order: [otherId], byPeer: { [otherId]: { contact: 'blocked', blockedFrom: 'accepted', messages: [
        { id: offer.id, text: '', from: otherId, timestamp: 1, direction: 'incoming', file: offer,
          fileStatus: 'ready', fileProgress: 3, fileAccepted: true },
      ] } } },
    };
    const opened = await openSealedChatData(key, accountId, await sealChatData(key, accountId, data));
    expect(opened.chats.byPeer[otherId]).toEqual(data.chats.byPeer[otherId]);
  });

  it('encrypts attachment bytes and binds them to account and peer/file key', async () => {
    const seed = new Uint8Array(32).fill(11);
    const key = await deriveChatStoreKey(seed, accountId);
    const id = `${otherId}:12345678-1234-4234-8234-123456789abc`;
    const bytes = new TextEncoder().encode('private attachment');
    const sealed = await sealLocalFileData(key, accountId, id, bytes);
    expect(new TextDecoder().decode(sealed.cipher)).not.toContain('private attachment');
    expect(await openSealedFileData(key, accountId, id, sealed)).toEqual(bytes);
    await expect(openSealedFileData(key, accountId, `${otherId}:another-id`, sealed)).rejects.toThrow();
    await expect(openSealedFileData(await deriveChatStoreKey(new Uint8Array(32).fill(12), accountId), accountId, id, sealed)).rejects.toThrow();
    const damaged = { ...sealed, cipher: sealed.cipher.slice(0) };
    new Uint8Array(damaged.cipher)[0] ^= 1;
    await expect(openSealedFileData(key, accountId, id, damaged)).rejects.toThrow();
  });
});
