import { isValidAccountId } from '$lib/addressing/bech32m.js';
import { normalizeFileOffer, type FileOffer } from '$lib/chat/file-transfer';
import { parseGroupMentions, type GroupMention } from './mentions';
import { digest, encodedMls, GROUP_HISTORY, GROUP_TEXT_BYTES, groupEpoch, groupMembers, groupTitle, GROUP_CHANGE_HISTORY, MAX_GROUPS, MAX_GROUP_MEMBERS, parseGroupFrame, parseGroupProfile, uuid,
  validGroupProof, validGroupReceipt, type GroupCommit, type GroupFrame, type GroupLeave, type GroupOffer, type GroupPlan, type GroupProfile, type GroupProof, type GroupReceipt } from './protocol';

export type GroupKeyDraft = { packet: string; init: string; leaf: string; signature: string };
export type GroupPost = { id: string; from: string; text: string; sentAt?: number; replyTo?: string; after?: string[]; forwarded?: true; file?: FileOffer; mentions?: GroupMention[] };
export type GroupNodeStatus = 'stored' | 'delivered' | 'finished';
export type GroupRoute = { peer: string; node?: string };
export type GroupEntry = GroupPost & { hash: string; packet: string; audience?: string[]; epoch?: number; unread?: true; route?: GroupRoute; nodeSince?: number;
  nodeStatus?: Record<string, GroupNodeStatus>; nodeFileStatus?: Record<string, GroupNodeStatus>; fileNode?: string; fileRequested?: true;
  fileReady?: true; hidden?: true; fileReceivedBy?: string[]; receivedBy?: string[]; receipts?: GroupReceipt[] };
export type GroupRoom = {
  id: string; title: string; owner: string; members: string[];
  draft?: GroupKeyDraft; keys: Record<string, string>; welcome?: string; mls?: string; entries: GroupEntry[];
  activityAt?: number;
  epoch?: number;
  departed?: string;
  leaving?: GroupLeave;
  leaves?: GroupLeave[];
  offer?: GroupOffer;
  plan?: GroupPlan;
  memberEpochs?: Record<string, number>;
  profiles?: Record<string, GroupProfile>;
  changes?: GroupChange[];
  welcomeProof?: GroupProof;
};
export type GroupRooms = GroupRoom[];
export type GroupChange = { plan: GroupPlan; commit: GroupCommit; previous: string[] };
export const epochOf = (room: GroupRoom) => room.epoch ?? 1;
export const groupVisible = (room: GroupRoom) => !room.departed && !room.leaving;
export const groupAudience = (room: GroupRoom, entry: GroupEntry) => entry.audience ?? room.members;

export const groupTimestamp = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 8.64e15;
export const groupEntryUnread = (entry: GroupEntry, self: string) => !entry.hidden && entry.unread === true && entry.from !== self;
export const groupPostMentions = (entry: GroupEntry, accountId: string) =>
  entry.mentions?.some(mention => mention[2] === accountId) === true;

export function groupPredecessors(value: unknown, self: string) {
  return Array.isArray(value) && value.length <= MAX_GROUP_MEMBERS &&
    value.every(id => uuid(id) && id !== self) && new Set(value).size === value.length ? value as string[] : undefined;
}

export function groupChronology(entries: readonly GroupEntry[]): GroupEntry[] {
  const pending = [...entries].sort((a, b) =>
    (a.sentAt ?? 0) - (b.sentAt ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const ids = new Set(entries.map(entry => entry.id));
  const placed = new Set<string>();
  const timeline: GroupEntry[] = [];
  const dependencies = new Map(pending.map(entry => [entry, [...entry.after ?? [], entry.replyTo]
    .filter((id): id is string => !!id && ids.has(id) && id !== entry.id)]));
  while (pending.length) {
    // The author can prove what they had already seen. Between independent
    // messages, sender time and ID give all clients the same order.
    const ready = pending.findIndex(entry => dependencies.get(entry)!.every(id => placed.has(id)));
    const [next] = pending.splice(Math.max(0, ready), 1);
    timeline.push(next);
    placed.add(next.id);
  }
  return timeline;
}

export function groupPeers(room: GroupRoom, self: string): string[] {
  if (room.departed) return [];
  return [...new Set([...room.members, ...(room.offer ? [room.offer.target] : [])])].filter(peer => peer !== self);
}

function storedFrame<T extends GroupFrame['type']>(value: unknown, type: T, group: string) {
  const frame = parseGroupFrame(value);
  return frame?.type === type && frame.group === group ? frame as Extract<GroupFrame, { type: T }> : undefined;
}

const encoder = new TextEncoder();
export function groupFileOffer(value: unknown, id: string): FileOffer | null {
  const file = normalizeFileOffer(value);
  if (!file || file.id !== id) return null;
  const media = file.details?.media;
  if (file.details && (!file.size || Object.keys(file.details).length !== 1 || !media ||
      (media.kind === 'sticker' ? !['image/webp','image/png','image/gif'].includes(file.mime)
        : media.kind !== 'gif' || file.mime !== 'image/gif'))) return null;
  return file;
}

export const validPost = (value: unknown): value is GroupPost => {
  if (!value || typeof value !== 'object') return false;
  const post = value as GroupPost;
  return uuid(post.id) && isValidAccountId(post.from) && typeof post.text === 'string' &&
    !!post.text.trim() && post.text.length <= GROUP_TEXT_BYTES && encoder.encode(post.text).length <= GROUP_TEXT_BYTES &&
    (post.file === undefined || groupFileOffer(post.file, post.id) !== null);
};

export function restoreGroups(value: unknown): GroupRooms {
  if (!Array.isArray(value)) return [];
  const rooms: GroupRooms = [];
  for (const raw of value.slice(0, MAX_GROUPS * 8)) {
    if (!raw || !uuid(raw.id) || !groupTitle(raw.title) || !groupMembers(raw.members) ||
      !isValidAccountId(raw.owner) || !raw.members.includes(raw.owner) || rooms.some(room => room.id === raw.id)) continue;
    const members: string[] = raw.members;
    const keys = Object.fromEntries(members.filter(member => member !== raw.owner && encodedMls(raw.keys?.[member]))
      .map(member => [member, raw.keys[member]]));
    const draft = raw.draft;
    const records: GroupEntry[] = Array.isArray(raw.entries) ? raw.entries.slice(-GROUP_HISTORY) : [];
    const entries = records.filter(entry => validPost(entry) &&
      (groupMembers(entry.audience) ? entry.audience : members).includes(entry.from) &&
      digest(entry.hash) && encodedMls(entry.packet, 6000)).map(entry => {
      const audience = groupMembers(entry.audience) ? entry.audience : members;
      const file = groupFileOffer(entry.file, entry.id);
      const mentions = parseGroupMentions(entry.text, entry.mentions)?.filter(([, , peer]) => peer !== entry.from && audience.includes(peer));
      const restoreNodeStatus = (statuses?: Record<string, GroupNodeStatus>) => Object.fromEntries(audience.flatMap(peer => {
        const value = statuses?.[peer];
        return peer !== entry.from && (value === 'stored' || value === 'delivered' || value === 'finished') ? [[peer, value]] : [];
      }));
      return {
        id:entry.id, from:entry.from, text:entry.text, hash:entry.hash, packet:entry.packet, audience,
        ...(file ? { file } : {}),
        ...(mentions?.length ? { mentions } : {}),
        epoch:groupEpoch(entry.epoch) ? entry.epoch : 1,
        ...(groupTimestamp(entry.sentAt) ? { sentAt:entry.sentAt } : {}),
        ...(uuid(entry.replyTo) && entry.replyTo !== entry.id ? { replyTo:entry.replyTo } : {}),
        ...(entry.after ? { after:groupPredecessors(entry.after, entry.id) } : {}),
        ...(entry.forwarded === true ? { forwarded:true as const } : {}),
        ...(groupTimestamp(entry.nodeSince) ? { nodeSince:entry.nodeSince, nodeStatus:restoreNodeStatus(entry.nodeStatus) } : {}),
        ...(file && entry.nodeFileStatus ? { nodeFileStatus:restoreNodeStatus(entry.nodeFileStatus) } : {}),
        ...(file && isValidAccountId(entry.fileNode ?? '') ? { fileNode:entry.fileNode } : {}),
        ...(file && entry.fileRequested === true ? { fileRequested:true as const } : {}),
        ...(file && entry.fileReady === true ? { fileReady:true as const } : {}),
        ...(file && Array.isArray(entry.fileReceivedBy) ? { fileReceivedBy:audience.filter(peer => peer !== entry.from && entry.fileReceivedBy!.includes(peer)) } : {}),
        ...(entry.hidden === true ? { hidden:true as const } : {}),
        ...(isValidAccountId(entry.route?.peer ?? '') ? { route:{ peer:entry.route!.peer,
          ...(isValidAccountId(entry.route?.node ?? '') ? { node:entry.route!.node } : {}) } } : {}),
        ...(entry.unread === true ? { unread:true as const } : {}),
        receivedBy: Array.isArray(entry.receivedBy)
          ? audience.filter(peer => peer !== entry.from && entry.receivedBy!.includes(peer)) : [],
        receipts: Array.isArray(entry.receipts) ? audience.flatMap(peer => {
          if (peer === entry.from) return [];
          const receipt = entry.receipts!.find(item => validGroupReceipt(item) && item.hash === entry.hash && item.by === peer);
          return receipt ? [receipt] : [];
        }) : [],
      };
    });
    const plan = storedFrame(raw.plan, 'group-plan', raw.id);
    const epoch = groupEpoch(raw.epoch) ? raw.epoch : undefined;
    const memberEpochs = Object.fromEntries(members.flatMap(peer => {
      const seen = raw.memberEpochs?.[peer];
      return groupEpoch(seen) && seen <= (epoch ?? 1) ? [[peer, seen]] : [];
    }));
    const profiles = Object.fromEntries(members.flatMap(peer => {
      const profile = parseGroupProfile(raw.profiles?.[peer]);
      return profile?.by === peer ? [[peer, profile]] : [];
    }));
    const changes = Array.isArray(raw.changes) ? raw.changes.slice(-GROUP_CHANGE_HISTORY).flatMap((value: GroupChange) => {
      const plan = storedFrame(value?.plan, 'group-plan', raw.id), commit = storedFrame(value?.commit, 'group-commit', raw.id);
      return plan && commit && plan.change === commit.change && plan.epoch === commit.epoch && groupMembers(value.previous)
        ? [{ plan, commit, previous:value.previous }] : [];
    }) : undefined;
    rooms.push({ id:raw.id, title:raw.title, owner:raw.owner, members, keys, entries,
      epoch, memberEpochs, ...(Object.keys(profiles).length ? { profiles } : {}),
      departed:typeof raw.departed === 'string' && isValidAccountId(raw.departed) ? raw.departed : undefined,
      leaving:storedFrame(raw.leaving, 'group-leave', raw.id),
      leaves:Array.isArray(raw.leaves) ? raw.leaves.slice(0, members.length).flatMap((value: unknown) => {
        const frame = storedFrame(value, 'group-leave', raw.id);
        return frame && members.includes(frame.by) ? [frame] : [];
      }) : undefined,
      offer:storedFrame(raw.offer, 'group-offer', raw.id),
      plan, changes,
      ...(Number.isSafeInteger(raw.activityAt) && raw.activityAt > 0 ? { activityAt:raw.activityAt } : {}),
      ...(encodedMls(raw.mls, 1048576) ? { mls:raw.mls } : {}),
      ...(encodedMls(raw.welcome) ? { welcome:raw.welcome } : {}),
      ...(encodedMls(raw.welcome) && validGroupProof(raw.welcomeProof) ? { welcomeProof:raw.welcomeProof } : {}),
      ...(draft && encodedMls(draft.packet) && [draft.init, draft.leaf, draft.signature].every(key => encodedMls(key, 256))
        ? { draft:{ packet:draft.packet, init:draft.init, leaf:draft.leaf, signature:draft.signature } } : {}),
    });
  }
  return rooms;
}
