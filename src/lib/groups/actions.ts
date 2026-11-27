import { isReactionEmoji, REACTIONS } from '$lib/chat/reactions';
import type { ReactionView } from '$lib/chat/message-updates';
import { GROUP_ACTION_HISTORY, GROUP_HISTORY, GROUP_TEXT_BYTES, groupEpoch, uuid } from './protocol';
import { parseGroupMentions, type GroupMention } from './mentions';
import type { GroupEntry, GroupRoom } from './storage';

export type GroupAction = { revision: number } & (
  | { kind:'edit'; targetId:string; text:string; mentions?:GroupMention[] }
  | { kind:'reaction'; targetId:string; emoji:string|null }
  | { kind:'pin'; targetId:string|null }
);
export type GroupActionRequest =
  | { kind:'edit'; targetId:string; text:string; previousRevision:number }
  | { kind:'reaction'; targetId:string; emoji:string }
  | { kind:'pin'; targetId:string|null };

export function parseGroupAction(value: unknown): GroupAction | undefined {
  if (!value || typeof value !== 'object') return;
  const { kind, targetId, revision, emoji, text, mentions } = value as Record<string, unknown>;
  if (!groupEpoch(revision)) return;
  if (kind === 'pin' && (targetId === null || uuid(targetId))) return { kind, targetId, revision };
  if (!uuid(targetId)) return;
  if (kind === 'reaction' && (emoji === null || isReactionEmoji(emoji))) return { kind, targetId, revision, emoji };
  if (kind !== 'edit' || typeof text !== 'string' || !text.trim() || text.length > GROUP_TEXT_BYTES ||
      new TextEncoder().encode(text).length > GROUP_TEXT_BYTES) return;
  const parsed = parseGroupMentions(text, mentions);
  return { kind, targetId, revision, text, ...(parsed?.length ? { mentions:parsed } : {}) };
}

export const groupCanEdit = (entry: GroupEntry) => !entry.file && !entry.forwarded && !!entry.text.trim();
export const groupCanAddress = (room: GroupRoom, entry: GroupEntry) =>
  room.members.every(peer => (entry.audience ?? room.members).includes(peer));
export const groupRecords = (room: GroupRoom) => [...room.entries, ...(room.actions ?? [])];
const slot = (actor: string, action: Pick<GroupAction,'kind'|'targetId'>) =>
  [actor, action.kind, action.kind === 'pin' ? '' : action.targetId].join(':');

export function latestGroupAction(room: GroupRoom, actor: string, request: Pick<GroupAction,'kind'|'targetId'>) {
  return room.actions?.find(entry => entry.from === actor && entry.action && slot(actor, entry.action) === slot(actor, request))?.action;
}

export function retainGroupActions(room: GroupRoom, records: readonly GroupEntry[]): GroupEntry[] {
  const messages = new Map(room.entries.map(entry => [entry.id, entry]));
  const latest = new Map<string, GroupEntry>();
  for (const record of records) {
    const action = record.action;
    if (!action) continue;
    if (action.kind === 'pin' && (!room.members.includes(record.from) || room.changes?.some(change =>
      (record.epoch ?? 1) <= change.plan.epoch &&
      (!change.previous.includes(record.from) || !change.plan.members.includes(record.from))))) continue;
    const target = action.targetId ? messages.get(action.targetId) : undefined;
    // New MLS members may only receive actions for posts in their audience.
    if (target && (!(record.audience ?? room.members).every(peer => (target.audience ?? room.members).includes(peer)) ||
        action.kind === 'edit' && (target.from !== record.from || !groupCanEdit(target)))) continue;
    const key = slot(record.from, action), previous = latest.get(key);
    if (!previous || action.revision > previous.action!.revision ||
        action.revision === previous.action!.revision && record.id > previous.id) latest.set(key, record);
  }
  const pinsAndEdits: GroupEntry[] = [], reactions: GroupEntry[] = [], pending: GroupEntry[] = [];
  for (const record of latest.values()) {
    const action = record.action!;
    if (action.kind === 'pin') pinsAndEdits.push(record);
    else if (!messages.has(action.targetId)) pending.push(record);
    else (action.kind === 'edit' ? pinsAndEdits : reactions).push(record);
  }
  return [...reactions, ...pinsAndEdits, ...pending.slice(-32)].slice(-GROUP_ACTION_HISTORY);
}

export function trimGroupHistory(room: GroupRoom, entries: GroupEntry[]): GroupEntry[] {
  if (entries.length <= GROUP_HISTORY) return entries;
  const pinned = new Set(groupPins(room).map(({ targetId }) => targetId));
  const keep = new Set(entries.filter(entry => pinned.has(entry.id)).map(entry => entry.id));
  for (let i = entries.length - 1; i >= 0 && keep.size < GROUP_HISTORY; i--) keep.add(entries[i].id);
  return entries.filter(entry => keep.has(entry.id));
}

export function groupPins(room: GroupRoom) {
  return (room.actions ?? []).flatMap(entry => entry.action?.kind === 'pin' && entry.action.targetId &&
    room.members.includes(entry.from) ? [{ actor:entry.from, targetId:entry.action.targetId, id:entry.id, at:entry.sentAt ?? 0 }] : [])
    .sort((a,b) => b.at - a.at || (a.id < b.id ? 1 : -1));
}

export function groupEdits(room: GroupRoom) {
  return new Map((room.actions ?? []).flatMap(entry => entry.action?.kind === 'edit'
    ? [[entry.action.targetId, entry.action] as const] : []));
}

export function applyGroupEdit(entry: GroupEntry, edits: ReturnType<typeof groupEdits>): GroupEntry {
  const edit = edits.get(entry.id);
  return edit ? { ...entry, text:edit.text, mentions:edit.mentions } : entry;
}

export function groupReactions(room: GroupRoom): Map<string, ReactionView[]> {
  const byTarget = new Map<string, Map<string, string[]>>();
  for (const entry of room.actions ?? []) {
    const action = entry.action;
    if (action?.kind !== 'reaction' || !action.emoji) continue;
    const byEmoji = byTarget.get(action.targetId) ?? new Map<string, string[]>();
    const actors = byEmoji.get(action.emoji) ?? [];
    actors.push(entry.from);
    byEmoji.set(action.emoji, actors);
    byTarget.set(action.targetId, byEmoji);
  }
  return new Map([...byTarget].map(([target, emojis]) => [target, REACTIONS.flatMap(emoji => {
    const actors = emojis.get(emoji);
    return actors?.length ? [{ emoji, actors:actors.sort() }] : [];
  })]));
}

// The prefix avoids resending known packets. It is not an author or content proof.
export function groupActionToken(hash: string) {
  return btoa(String.fromCharCode(...hash.slice(0,24).match(/../g)!.map(pair => parseInt(pair,16))));
}
