import { expect, it } from 'vitest';
import { idleCall } from './controller';
import { callRecordLabel, normalizeCallRecord, recordCall, recoverCallRecord } from './history';
import { emptySessionChats, ensureConversation } from '$lib/chat/session-chats';
import { selectEveryMessage, selectionSummary } from '$lib/chat/message-selection';

it('updates a single local call entry without delivery queue or unread receipts', () => {
  const view = { ...idleCall(), id: crypto.randomUUID(), peer: 'bob', outgoing: true, created: 1000, phase: 'outgoing' as const };
  let state = recordCall(ensureConversation(emptySessionChats(), 'bob'), 'alice', view);
  expect(state.byPeer.bob.messages).toHaveLength(1); expect(state.byPeer.bob.messages[0].delivery).toBeUndefined();
  expect(recordCall(state, 'alice', view)).toBe(state);
  state = recordCall(state, 'alice', { ...view, phase: 'ended', started: 2000, ended: 34000, reason: 'finished' });
  expect(state.byPeer.bob.messages).toHaveLength(1); expect(state.byPeer.bob.messages[0].text).toContain('0:32'); expect(state.byPeer.bob.unread).toBe(0);
  expect(selectEveryMessage(state.byPeer.bob.messages)).toEqual([]); expect(selectionSummary(state.byPeer.bob.messages, [])).toMatchObject({ total: 0 });
});
it('distinguishes failed and missed calls, and does not invent audio duration after restart', () => {
  const record = { ...idleCall(), id: crypto.randomUUID(), phase: 'ended' as const, created: 1000, ended: 2000, reason: 'unanswered' as const };
  expect(callRecordLabel(record)).toContain('пропущен'); expect(callRecordLabel({ ...record, outgoing: true })).toContain('нет ответа');
  expect(callRecordLabel({ ...record, reason: 'network' })).toContain('не удалось');
  const recovered = recoverCallRecord({ ...record, phase: 'active', started: 1500, ended: 0 }, 100000);
  expect(recovered.started).toBe(0); expect(recovered.phase).toBe('ended');
  expect(normalizeCallRecord({ ...record, ended: -1 })).toBeNull(); expect(normalizeCallRecord({ ...record, reason: 'SDP secret' })).toBeNull();
});
