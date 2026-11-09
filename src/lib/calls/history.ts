import type { CallView, CallReason } from './controller';
import { callTime } from './presentation';
import { MESSAGE_ID } from '$lib/chat/message-details';
import { updateConversation, type SessionChats } from '$lib/chat/session-chats';

// Local observation, never a wire message or a receipt/delivery assertion.
export type CallRecord = Pick<CallView, 'id' | 'outgoing' | 'created' | 'started' | 'ended' | 'phase' | 'reason'>;
export function normalizeCallRecord(raw: unknown): CallRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as CallRecord;
  if (typeof v.id !== 'string' || !MESSAGE_ID.test(v.id) || typeof v.outgoing !== 'boolean' ||
      !['incoming', 'outgoing', 'connecting', 'active', 'reconnecting', 'ended'].includes(v.phase) ||
      ![v.created, v.started, v.ended].every(n => Number.isSafeInteger(n) && n >= 0) ||
      v.reason !== undefined && !['finished', 'declined', 'busy', 'unanswered', 'network', 'microphone', 'security', 'unsupported'].includes(v.reason)) return null;
  return { id: v.id, outgoing: v.outgoing, created: v.created, started: v.started, ended: v.ended, phase: v.phase, ...(v.reason ? { reason: v.reason } : {}) };
}
export function callRecordLabel(v: CallRecord): string {
  const direction = v.outgoing ? 'Исходящий звонок' : 'Входящий звонок';
  if (v.phase !== 'ended') return `${direction} · ${v.started ? 'идёт разговор' : 'попытка соединения'}`;
  const reasons: Record<CallReason, string> = { finished: v.started ? 'завершён' : v.outgoing ? 'отменён' : 'отменён собеседником', declined: 'отклонён', busy: 'занято', unanswered: v.outgoing ? 'нет ответа' : 'пропущен', network: v.started ? 'связь прервалась' : 'не удалось подключиться', microphone: 'микрофон недоступен', security: 'проверка защиты не пройдена', unsupported: 'браузер не поддерживает звонок' };
  return `${direction} · ${reasons[v.reason ?? 'finished']}${v.started && v.ended ? ` · ${callTime(v.started, v.ended)}` : ''}`;
}
export function recordCall(state: SessionChats, self: string, view: CallView): SessionChats {
  if (view.phase === 'idle' || !state.byPeer[view.peer]) return state;
  const record = normalizeCallRecord(view); if (!record) return state;
  const existing = state.byPeer[view.peer].messages.find(m => m.id === view.id);
  if (existing && (!existing.localCall || JSON.stringify(existing.localCall) === JSON.stringify(record)) || state.byPeer[view.peer].deletedIds?.includes(view.id)) return state;
  return updateConversation(state, view.peer, conversation => {
    if (conversation.deletedIds?.includes(view.id)) return conversation;
    const previous = conversation.messages.find(m => m.id === view.id);
    if (previous && !previous.localCall) return conversation;
    if (JSON.stringify(previous?.localCall) === JSON.stringify(record)) return conversation;
    const entry = { id: view.id, timestamp: view.created, from: view.outgoing ? self : view.peer,
      direction: view.outgoing ? 'outgoing' as const : 'incoming' as const,
      text: callRecordLabel(record), localCall: record, readState: 'skipped' as const };
    return { ...conversation, messages: previous ? conversation.messages.map(m => m.id === entry.id ? entry : m) : [...conversation.messages, entry] };
  });
}
export function recoverCallRecord(record: CallRecord, now: number): CallRecord {
  // A browser restart does not establish when audio stopped. Do not manufacture
  // a duration covering the time the app was closed.
  return record.phase === 'ended' ? record : { ...record, phase: 'ended', started: 0, ended: now, reason: 'network' };
}
