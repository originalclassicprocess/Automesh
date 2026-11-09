import { describe, expect, it } from 'vitest';
import { automaticAudioOffers, automaticFileOffers, autoReceiveAudio, validateAttachmentBatch } from './attachment-policy';
import { MAX_FILE_BYTES, type FileOffer } from './file-transfer';
import { MAX_VOICE_BYTES } from './voice-recorder';
import { emptySessionChats, ensureConversation, updateConversation } from './session-chats';
describe('bounded attachments', () => {
  it('auto-accepts a verified courier offer without a direct connection, respecting opt-out and budgets', () => {
    let state = ensureConversation(emptySessionChats(), 'peer');
    state = updateConversation(state, 'peer', c => ({ ...c, contact: 'accepted', connection: 'offline', messages: [{ id: 'id', from: 'peer', direction: 'incoming', text: '', timestamp: 1,
      file: { id: 'id', name: 'doc.pdf', mime: 'application/pdf', size: 1000, sha256: 'a'.repeat(64) }, fileStatus: 'offered', courierVia: 'node' }] }));
    expect(automaticFileOffers(state, 0, 1000, true)).toHaveLength(1);
    expect(automaticFileOffers(state, 0, 999, true)).toEqual([]); expect(automaticFileOffers(state, 0, 1000, false)).toEqual([]);
    expect(automaticFileOffers(state, 2, 1000, true)).toEqual([]);
  });
  it('auto-receives all file kinds only when enabled, accepted, connected and inside the budget', () => {
    let state = ensureConversation(emptySessionChats(), 'peer');
    const messages = ['image/png', 'video/mp4', 'application/pdf'].map((mime, i) => ({ id: String(i), from: 'peer',
      direction: 'incoming' as const, text: '', timestamp: 1, fileStatus: 'offered' as const,
      file: { id: String(i), name: `file-${i}`, mime, size: 1000, sha256: 'a'.repeat(64) } }));
    state = updateConversation(state, 'peer', c => ({ ...c, messages, contact: 'accepted', connection: 'connected' }));
    expect(automaticFileOffers(state, 0, 10000, false)).toEqual([]);
    expect(automaticFileOffers(state, 0, 10000, true).map(file => file.id)).toEqual(['0', '1']);
    expect(automaticFileOffers(state, 0, 1000, true)).toHaveLength(1);
    expect(automaticFileOffers(state, 2, 10000, true)).toEqual([]);
    for (const contact of ['pending', 'blocked', 'outgoing'] as const) {
      state = updateConversation(state, 'peer', c => ({ ...c, contact }));
      expect(automaticFileOffers(state, 0, 10000, true)).toEqual([]);
    }
    state = updateConversation(state, 'peer', c => ({ ...c, contact: 'accepted', messages: messages.map(message => ({ ...message, fileDeleted: true })) }));
    expect(automaticFileOffers(state, 0, 10000, true)).toEqual([]);
  });
  it('allows several files while bounding each size and total pending count', () => {
    expect(validateAttachmentBatch([{ size: MAX_FILE_BYTES }, { size: 1 }], 14)).toBeNull();
    expect(validateAttachmentBatch([{ size: 1 }, { size: 1 }], 15)).toContain('16');
    expect(validateAttachmentBatch([{ size: MAX_FILE_BYTES + 1 }], 0)).toContain('20');
  });
  it('only automatically accepts small, allowlisted audio, never active files or large media', () => {
    const offer: FileOffer = { id: '12345678-1234-4234-8234-123456789abc', name: 'voice.m4a', mime: 'audio/mp4', size: 1024, sha256: 'a'.repeat(64) };
    expect(autoReceiveAudio(offer)).toBe(true);
    expect(autoReceiveAudio({ ...offer, size: MAX_VOICE_BYTES + 1 })).toBe(false);
    expect(autoReceiveAudio({ ...offer, size: 0 })).toBe(false);
    expect(autoReceiveAudio({ ...offer, name: 'attack.html' })).toBe(false);
    expect(autoReceiveAudio({ ...offer, name: 'photo.png', mime: 'image/png' })).toBe(false);
  });
  it('does not download unknown, blocked or offline contacts and bounds slots and cumulative bytes', () => {
    let state = ensureConversation(emptySessionChats(), 'peer');
    const messages = [1, 2, 3].map(i => ({ id: String(i), direction: 'incoming' as const, from: 'peer', text: '', timestamp: 1,
      fileStatus: 'offered' as const, file: { id: String(i), name: 'voice.m4a', mime: 'audio/mp4', size: 1000, sha256: 'a'.repeat(64) } }));
    state = updateConversation(state, 'peer', c => ({ ...c, messages, connection: 'connected' }));
    expect(automaticAudioOffers(state, 0, 5000)).toEqual([]);
    state = updateConversation(state, 'peer', c => ({ ...c, contact: 'accepted' }));
    expect(automaticAudioOffers(state, 0, 5000).map(x => x.id)).toEqual(['1', '2']);
    expect(automaticAudioOffers(state, 1, 5000)).toHaveLength(1);
    expect(automaticAudioOffers(state, 2, 5000)).toEqual([]);
    expect(automaticAudioOffers(state, 0, 1500)).toHaveLength(1);
    expect(automaticAudioOffers(state, 0, 999)).toEqual([]);
    state = updateConversation(state, 'peer', c => ({ ...c, contact: 'blocked' }));
    expect(automaticAudioOffers(state, 0, 5000)).toEqual([]);
    state = updateConversation(state, 'peer', c => ({ ...c, contact: 'accepted', connection: 'offline' }));
    expect(automaticAudioOffers(state, 0, 5000)).toEqual([]);
  });
  it('does not repeatedly auto-accept a manually rejected, failed or already accepted transfer', () => {
    let state = ensureConversation(emptySessionChats(), 'peer');
    const file: FileOffer = { id: 'id', name: 'voice.m4a', mime: 'audio/mp4', size: 1000, sha256: 'a'.repeat(64) };
    for (const patch of [{ fileAccepted: true, fileStatus: 'offered' as const }, { fileStatus: 'rejected' as const }, { fileStatus: 'failed' as const }]) {
      state = updateConversation(state, 'peer', c => ({ ...c, contact: 'accepted', connection: 'connected', messages: [
        { id: 'id', from: 'peer', direction: 'incoming', text: '', timestamp: 1, file, ...patch },
      ] }));
      expect(automaticAudioOffers(state, 0, 5000)).toEqual([]);
    }
  });
});
