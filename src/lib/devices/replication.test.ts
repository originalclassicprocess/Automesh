import { describe, expect, it, vi } from 'vitest';
import { encodeAccountId } from '../addressing/bech32m.js';
import { emptySessionChats, ensureConversation, recordSentMessage } from '../chat/session-chats';
import { deviceCopyJobs, deviceCopyKinds, readOwnIncoming, withoutDeviceCopy } from './replication';
import { dataOnlyChatData } from '../backup/data-backup';
import { normalizeLocalChatData } from '../chat/local-store';
import { messageStatus } from '../chat/message-presentation';
const self = encodeAccountId(new Uint8Array(20).fill(1)), peer = encodeAccountId(new Uint8Array(20).fill(2));
const id = '10000000-0000-4000-8000-000000000001';
const message = () => ({ id, from: self, text: 'Text', timestamp: 10, direction: 'outgoing' as const, deviceCopies: ['own', 'peer'] as Array<'own' | 'peer'> });
function chats() { const state = ensureConversation(emptySessionChats(), peer); state.byPeer[peer].contact = 'accepted'; return recordSentMessage(state, peer, message()); }
describe('primary-independent device replication', () => {
  it('creates scheduling hints only for actual unrevoked device certificates', () => {
    const roster = (author: string, revokedAt: number | null) => ({ record: { author, body: { devices: [{ revokedAt, certificate: { record: { expiresAt: Date.now() + 10000 } } }] } } }) as never;
    expect(deviceCopyKinds(self, peer, false, [])).toEqual([]);
    expect(deviceCopyKinds(self, peer, false, [roster(self, null), roster(peer, null)])).toEqual(['own', 'peer']);
    expect(deviceCopyKinds(self, peer, true, [roster(self, null), roster(peer, null)])).toEqual(['own']);
    expect(deviceCopyKinds(self, peer, false, [roster(self, 1)])).toEqual([]);
  });
  it('schedules separate own/peer jobs without changing ordinary delivery state', () => {
    const state = chats(), before = JSON.stringify(state);
    const jobs = deviceCopyJobs(state, self);
    expect(jobs.map(job => job.kind)).toEqual(['own', 'peer']); expect(JSON.stringify(state)).toBe(before);
    const original = state.byPeer[peer].messages[0], next = withoutDeviceCopy(original, 'own');
    expect(next.deviceCopies).toEqual(['peer']); expect(original.deviceCopies).toEqual(['own', 'peer']);
    expect(withoutDeviceCopy(next, 'peer').deviceCopies).toBeUndefined();
  });
  it('does not replay archive history, files or disappearing content', () => {
    for (const patch of [{ restoredFromBackup: true }, { details: { ephemeral: { views: 1, allowDownload: false } } }, { file: {} }, { deviceMessage: true }]) {
      const state = chats(); Object.assign(state.byPeer[peer].messages[0], patch);
      expect(deviceCopyJobs(state, self)).toEqual([]);
    }
    const data = normalizeLocalChatData({ chats: { order: [peer], byPeer: { [peer]: { messages: [message()] } } } });
    expect(dataOnlyChatData(data).chats.byPeer[peer].messages[0].deviceCopies).toBeUndefined();
  });
  it('only accepts incoming-history attestations from the physical owner to its own account', () => {
    const state = chats(); Object.assign(state.byPeer[peer].messages[0], { direction: 'incoming', from: peer });
    const job = deviceCopyJobs(state, self)[0];
    const event = { id, from: self, to: self, authorDevice: self, text: job.text, timestamp: 20 };
    expect(readOwnIncoming(event, self)).toMatchObject({ peer, timestamp: 10 });
    for (const patch of [{ authorDevice: peer }, { from: peer }, { to: peer }]) expect(() => readOwnIncoming({ ...event, ...patch }, self)).toThrow('denied');
  });
  it('keeps primary pending state when a delegated device confirms receipt', () => {
    const entry = { ...message(), delivery: 'queued' as const, deviceCopyDelivery: 'delivered' as const };
    expect(messageStatus(entry).label).toBe('Доставлено на устройство'); expect(entry.delivery).toBe('queued');
  });
});
