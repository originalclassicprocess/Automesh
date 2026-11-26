import { isValidAccountId } from '$lib/addressing/bech32m.js';
import { MAX_GROUP_MEMBERS } from './protocol';

// The range is measured in UTF-16 code units, like a textarea's selection.
export type GroupMention = [start: number, end: number, accountId: string];

export function parseGroupMentions(text: string, value: unknown): GroupMention[] | null {
  if (!Array.isArray(value) || value.length > MAX_GROUP_MEMBERS) return null;
  const mentions: GroupMention[] = [];
  let previousEnd = 0;
  for (const item of value) {
    if (!Array.isArray(item) || item.length !== 3) return null;
    const [start, end, accountId] = item;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < previousEnd ||
      end > text.length || end - start < 2 || end - start > 65 ||
      typeof accountId !== 'string' || !isValidAccountId(accountId)) return null;
    const label = text.slice(start + 1, end);
    if (text[start] !== '@' || label !== label.trim() || /[\u0000-\u001f\u007f]/.test(label)) return null;
    mentions.push([start, end, accountId]);
    previousEnd = end;
  }
  return mentions;
}

export type MentionEdit = { start: number; end: number; type: string };

export function moveGroupMentions(mentions: GroupMention[], start: number, end: number, inserted: number): GroupMention[] {
  const delta = inserted - (end - start);
  return mentions.flatMap(([from, to, accountId]): GroupMention[] => {
    if (to <= start) return [[from, to, accountId]];
    if (from >= end) return [[from + delta, to + delta, accountId]];
    return [];
  });
}

export function editGroupMentions(before: string, after: string, mentions: GroupMention[], edit?: MentionEdit): GroupMention[] {
  if (!mentions.length || !edit) return [];
  let { start, end } = edit;
  // For a deletion without a selection the browser reports the original caret.
  // Use the edit location so equal adjacent nicknames never exchange IDs.
  if (start === end && edit.type.startsWith('delete')) {
    const removed = Math.max(0, before.length - after.length);
    if (edit.type.endsWith('Backward')) start -= removed;
    else if (edit.type.endsWith('Forward')) end += removed;
  }
  const suffix = before.length - end;
  const inserted = after.length - start - suffix;
  if (start < 0 || end > before.length || inserted < 0 || !after.startsWith(before.slice(0, start)) ||
    !after.endsWith(before.slice(end))) return [];
  return moveGroupMentions(mentions, start, end, inserted);
}

export function mentionQuery(text: string, caret: number, mentions: GroupMention[]) {
  const start = caret > 0 ? text.lastIndexOf('@', caret - 1) : -1;
  if (start < 0 || start > 0 && !/[\s([{"“‘,;:!?]/u.test(text[start - 1]) ||
    mentions.some(([from, to]) => start >= from && start < to)) return null;
  const query = text.slice(start + 1, caret);
  const rest = text.slice(caret).match(/^[\p{L}\p{N}_-]+/u)?.[0] ?? '';
  return query.length <= 64 && !/[\r\n\t]/.test(query) ? { start, end:caret + rest.length, query } : null;
}

export function groupMentionParts(text: string, mentions: GroupMention[]) {
  let start = 0;
  const parts: { text: string; accountId?: string }[] = [];
  for (const [from, to, accountId] of mentions) {
    if (from > start) parts.push({ text:text.slice(start, from) });
    parts.push({ text:text.slice(from, to), accountId });
    start = to;
  }
  if (start < text.length) parts.push({ text:text.slice(start) });
  return parts;
}
