import { isValidAccountId } from '$lib/addressing/bech32m.js';
import { digest, encodedMls, GROUP_HISTORY, GROUP_TEXT_BYTES, groupMembers, groupTitle, MAX_GROUPS, uuid } from './protocol';

export type GroupKeyDraft = { packet: string; init: string; leaf: string; signature: string };
export type GroupPost = { id: string; from: string; text: string };
export type GroupEntry = GroupPost & { hash: string; packet: string; receivedBy?: string[] };
export type GroupRoom = {
  id: string; title: string; owner: string; members: string[];
  draft?: GroupKeyDraft; keys: Record<string, string>; welcome?: string; mls?: string; entries: GroupEntry[];
  activityAt?: number;
};
export type GroupRooms = GroupRoom[];

const encoder = new TextEncoder();
export const validPost = (value: unknown): value is GroupPost => {
  if (!value || typeof value !== 'object') return false;
  const post = value as GroupPost;
  return uuid(post.id) && isValidAccountId(post.from) && typeof post.text === 'string' &&
    !!post.text.trim() && post.text.length <= GROUP_TEXT_BYTES && encoder.encode(post.text).length <= GROUP_TEXT_BYTES;
};

export function restoreGroups(value: unknown): GroupRooms {
  if (!Array.isArray(value)) return [];
  const rooms: GroupRooms = [];
  for (const raw of value.slice(0, MAX_GROUPS)) {
    if (!raw || !uuid(raw.id) || !groupTitle(raw.title) || !groupMembers(raw.members) ||
      !isValidAccountId(raw.owner) || !raw.members.includes(raw.owner) || rooms.some(room => room.id === raw.id)) continue;
    const members: string[] = raw.members;
    const keys = Object.fromEntries(members.filter(member => member !== raw.owner && encodedMls(raw.keys?.[member]))
      .map(member => [member, raw.keys[member]]));
    const draft = raw.draft;
    const records: GroupEntry[] = Array.isArray(raw.entries) ? raw.entries.slice(-GROUP_HISTORY) : [];
    const entries = records.filter(entry => validPost(entry) && members.includes(entry.from) &&
      digest(entry.hash) && encodedMls(entry.packet, 6000)).map(entry => ({
      ...entry, receivedBy: Array.isArray(entry.receivedBy)
        ? members.filter(peer => peer !== entry.from && entry.receivedBy!.includes(peer)) : [],
    }));
    rooms.push({ id:raw.id, title:raw.title, owner:raw.owner, members, keys, entries,
      ...(Number.isSafeInteger(raw.activityAt) && raw.activityAt > 0 ? { activityAt:raw.activityAt } : {}),
      ...(encodedMls(raw.mls, 240000) ? { mls:raw.mls } : {}),
      ...(encodedMls(raw.welcome) ? { welcome:raw.welcome } : {}),
      ...(draft && encodedMls(draft.packet) && [draft.init, draft.leaf, draft.signature].every(key => encodedMls(key, 256))
        ? { draft:{ packet:draft.packet, init:draft.init, leaf:draft.leaf, signature:draft.signature } } : {}),
    });
  }
  return rooms;
}
