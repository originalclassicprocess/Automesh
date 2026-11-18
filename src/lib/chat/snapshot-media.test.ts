import { describe, expect, it } from 'vitest';
import { preserveSnapshotMediaRefs } from './snapshot-media';
import { emptySessionChats, ensureConversation, saveChats, type ChatEntry } from './session-chats';

function message(id: string, hash = 'a'.repeat(64)): ChatEntry {
  return { id, from: 'sender', text: 'hello', timestamp: 1, direction: 'outgoing', delivery: 'queued',
    file: { id, name: 'sticker.gif', mime: 'image/gif', size: 42, sha256: hash } };
}

describe('queued snapshot media references', () => {
  it('reconciles only matching files within their own peer, leaving delivery and live state untouched', () => {
    const live = ensureConversation(ensureConversation(emptySessionChats(), 'alice'), 'bob');
    live.byPeer.alice.messages = [message('shared'), message('changed'), message('deleted'), message('gone')];
    live.byPeer.bob.messages = [message('shared')];
    const snapshot = saveChats(live), before = structuredClone(snapshot);
    live.byPeer.alice.messages[0] = { ...live.byPeer.alice.messages[0], mediaRef: 'alice-ref', delivery: 'delivered' };
    live.byPeer.alice.messages[1] = { ...message('changed', 'b'.repeat(64)), mediaRef: 'other-file' };
    snapshot.byPeer.alice.messages[2].fileDeleted = true;
    live.byPeer.alice.messages[2].mediaRef = 'deleted-ref';
    live.byPeer.alice.messages.pop();
    live.byPeer.bob.messages[0].mediaRef = 'bob-ref';
    const liveBefore = structuredClone(live);
    preserveSnapshotMediaRefs(snapshot, live);
    expect(snapshot.byPeer.alice.messages[0]).toEqual({ ...before.byPeer.alice.messages[0], mediaRef: 'alice-ref' });
    expect(snapshot.byPeer.alice.messages[1]).toEqual(before.byPeer.alice.messages[1]);
    expect(snapshot.byPeer.alice.messages[2].mediaRef).toBeUndefined();
    expect(snapshot.byPeer.alice.messages[3]).toEqual(before.byPeer.alice.messages[3]);
    expect(snapshot.byPeer.bob.messages[0].mediaRef).toBe('bob-ref');
    expect(live).toEqual(liveBefore);
  });

  it('keeps existing references when a peer disappears and keeps first-match semantics for duplicate IDs', () => {
    const live = ensureConversation(ensureConversation(emptySessionChats(), 'alice'), 'bob');
    live.byPeer.alice.messages = [{ ...message('same'), mediaRef: 'first' }, { ...message('same'), mediaRef: 'second' }];
    live.byPeer.bob.messages = [{ ...message('same'), mediaRef: 'durable' }];
    const snapshot = saveChats(live);
    delete live.byPeer.bob;
    preserveSnapshotMediaRefs(snapshot, live);
    expect(snapshot.byPeer.alice.messages.map(m => m.mediaRef)).toEqual(['first', 'first']);
    expect(snapshot.byPeer.bob.messages[0].mediaRef).toBe('durable');
  });

  it('reads a linear number of IDs in a 20,000-message history', () => {
    const count = 20_000, live = ensureConversation(emptySessionChats(), 'alice');
    live.byPeer.alice.messages = Array.from({ length: count }, (_, i) => ({ ...message(String(i)), mediaRef: 'cached' }));
    const snapshot = saveChats(live);
    let idReads = 0;
    live.byPeer.alice.messages = live.byPeer.alice.messages.map(row => ({ ...row, get id() { idReads++; return row.id; } }));
    preserveSnapshotMediaRefs(snapshot, live);
    expect(idReads).toBeLessThanOrEqual(count * 3);
    expect(snapshot.byPeer.alice.messages.every(m => m.mediaRef === 'cached')).toBe(true);
  });
});
