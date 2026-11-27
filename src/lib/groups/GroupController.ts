import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '$lib/message/encoding';
import { COURIER_TTL } from '$lib/node/courier-protocol.js';
import type { IdentityProvider } from '$lib/identity/identity';
import { acceptGroupWelcome, createGroupKey, decryptGroupPost, encryptGroupPost, establishGroup, groupPacketHash,
  signGroupProfile, signGroupReceipt, signGroupWelcome, validateJoinKey, verifyGroupProfile, verifyGroupReceipt, verifyGroupWelcome } from './mls';
import { GroupMembership } from './GroupMembership';
import { GroupAttachments, type GroupFilePayload, type GroupFileStore, type StagedGroupFile } from './attachments';
import { editGroupMentions, parseGroupMentions, type GroupMention } from './mentions';
import { groupActionToken, groupCanAddress, groupCanEdit, groupRecords, latestGroupAction, parseGroupAction,
  retainGroupActions, trimGroupHistory, type GroupActionRequest } from './actions';
import { normalizeFileOffer, safeFileName, sameFileOffer, sha256Hex, MAX_FILE_BYTES, type FileOffer } from '$lib/chat/file-transfer';
import { GROUP_KEY_HISTORY, GROUP_RECEIPT_BATCH, MAX_GROUPS, MAX_GROUP_MEMBERS, groupMembers, groupTitle, isMembershipFrame, parseGroupFrame,
  GROUP_PREFIX, isGroupFileFrame, validNickname, type GroupFrame, type GroupProfile, type GroupReceipt, type GroupTransport } from './protocol';
import { epochOf, groupAudience, groupChronology, groupEntryUnread, groupPeers, validPost, type GroupEntry, type GroupNodeStatus, type GroupRoom, type GroupRooms } from './storage';

type GroupMessageFrame = Extract<GroupFrame, { type:'message' }>;
export type GroupNodeReference = { group: string; hash: string; file?: true };
export type GroupNodePost = GroupNodeReference & { id: string; peer: string; content: string; relay: boolean; offer?: FileOffer };
const encoder = new TextEncoder();
const availableSince = (entry: GroupEntry) => entry.nodeSince ?? entry.sentAt;
const replayOrder = (a: GroupEntry, b: GroupEntry) =>
  (a.epoch ?? 1) - (b.epoch ?? 1) || (a.sentAt ?? 0) - (b.sentAt ?? 0);
const newerProfile = (profile: GroupProfile, previous?: GroupProfile) => !previous ||
  profile.revision > previous.revision || profile.revision === previous.revision && profile.nickname > previous.nickname;

type GroupPort = {
  self: string;
  identity: IdentityProvider;
  active(): boolean;
  contact(peer: string): boolean;
  allowed(peer: string): boolean;
  nickname?(): string;
  readsEnabled?(): boolean;
  nodeEnabled?(): boolean;
  rooms(): GroupRooms;
  save(rooms: GroupRooms, file?: StagedGroupFile): Promise<void>;
  trackTransfer?(group: string, hash: string): () => void;
  files?: GroupFileStore;
  welcomeFailed?(group: string): void;
  transport: GroupTransport;
};

function receiptBits(room: GroupRoom, entry: GroupEntry, receipt: GroupReceipt): number {
  const index = groupAudience(room, entry).indexOf(receipt.by);
  if (index < 0) return 0;
  const bit = 1 << index;
  return receipt.state === 'read' ? bit | (bit << MAX_GROUP_MEMBERS) : bit;
}

function withReceipt(entry: GroupEntry, receipt: GroupReceipt): GroupEntry {
  return { ...entry, receipts:[...(entry.receipts ?? []).filter(item => item.by !== receipt.by), receipt] };
}

export class GroupController {
  private tail: Promise<unknown> = Promise.resolve();
  private syncing = new Set<string>();
  private requestedSync = new Map<string, { epoch: number; known: string[]; seen?: number[]; actionKnown?: string }>();
  private peersWithActions = new Set<string>();
  private hellos = new Set<string>();
  private welcomed = new Set<string>();
  private peerEpochs = new Map<string, number>();
  private readonly membership: GroupMembership;
  private readonly attachments?: GroupAttachments;
  constructor(private readonly port: GroupPort) {
    if (port.files) this.attachments = new GroupAttachments({ ...port, room:id => this.room(id), files:port.files });
    this.membership = new GroupMembership({
      ...port, save:room => this.save(room), deliver:(peer, frame) => this.deliver(peer, frame),
      changed:room => {
        for (const peer of groupPeers(room, this.port.self)) void this.hello(room, peer);
      },
    });
  }

  private run<T>(action: () => Promise<T>): Promise<T> {
    const result = this.tail.then(() => {
      if (!this.port.active()) throw new Error('group_inactive');
      return action();
    });
    this.tail = result.catch(() => {});
    return result;
  }

  private room(id: string) { return this.port.rooms().find(room => room.id === id); }
  private async save(room: GroupRoom, file?: StagedGroupFile) {
    if (!this.port.active()) throw new Error('group_inactive');
    const rooms = this.port.rooms();
    const updated = rooms.some(item => item.id === room.id)
      ? rooms.map(item => item.id === room.id ? room : item) : [...rooms, room];
    await this.port.save([...updated.filter(item => !item.departed), ...updated.filter(item => item.departed).slice(-MAX_GROUPS * 7)], file);
  }

  private async deliver(peer: string, value: GroupFrame) {
    let entry: GroupEntry | undefined;
    if (value.type === 'message') {
      const room = this.room(value.group);
      if (!room?.mls || room.leaving || (room.plan && !room.plan.key) || !room.members.includes(peer) ||
        this.peerEpochs.get(room.id + ':' + peer) !== epochOf(room)) return;
      const control = room.actions?.find(item => item.packet === value.packet);
      if (control && (!room.members.includes(control.from) || !groupAudience(room, control).includes(peer) ||
          epochOf(room) - (control.epoch ?? 1) >= GROUP_KEY_HISTORY || !this.peersWithActions.has(room.id + ':' + peer))) return;
      entry = room.entries.find(item => item.from === this.port.self && item.packet === value.packet);
    }
    if (!this.port.active() || !this.port.allowed(peer) || !this.port.transport.ready(peer)) return;
    const stop = entry && this.port.trackTransfer?.(value.group, entry.hash);
    try { await this.port.transport.send(peer, value); }
    catch { /* The next sync can retry the packet. */ }
    finally { stop?.(); }
  }

  private relay(room: GroupRoom, frame: GroupFrame, skip?: string) {
    for (const peer of room.members) if (peer !== this.port.self && peer !== skip)
      void this.deliver(peer, frame);
  }

  async create(title: string, selected: string[]): Promise<string> {
    return this.run(async () => {
      const members = [this.port.self, ...selected];
      if (!groupTitle(title) || !selected.length || !groupMembers(members) || selected.some(peer => !this.port.contact(peer)) ||
        this.port.rooms().filter(room => !room.departed).length >= MAX_GROUPS) throw new Error('group_invalid_selection');
      const room: GroupRoom = { id:crypto.randomUUID(), title, members, owner:this.port.self, keys:{}, entries:[], activityAt:Date.now() };
      await this.save(room);
      for (const peer of selected) void this.hello(room, peer);
      return room.id;
    });
  }

  async accept(id: string) {
    return this.run(async () => {
      const room = this.room(id);
      if (!room || room.departed || room.owner === this.port.self || room.mls || !this.port.contact(room.owner)) throw new Error('group_invite_unavailable');
      const accepted = room.draft ? room : { ...room, draft:await createGroupKey(room, this.port.self, this.port.identity) };
      if (!room.draft) await this.save(accepted);
      for (const peer of room.members) if (peer !== this.port.self) void this.hello(accepted, peer);
    });
  }

  invite(id: string, peer: string) {
    return this.changeMembership(id, room => this.membership.invite(room, peer));
  }

  exclude(id: string, peer: string) {
    return this.changeMembership(id, room => this.membership.exclude(room, peer));
  }

  leave(id: string, successor?: string) {
    return this.changeMembership(id, room => this.membership.leave(room, successor));
  }

  private changeMembership(id: string, action: (room: GroupRoom) => Promise<void>) {
    return this.run(async () => {
      const room = this.room(id);
      if (!room || room.departed) throw new Error('group_change_unavailable');
      await action(await this.signedWelcome(room));
    });
  }

  resumeMembership() {
    return this.run(async () => {
      for (const room of this.port.rooms()) {
        if (room.plan || room.leaves?.length) {
          await this.membership.resume(room).catch(() => {});
        }
      }
    });
  }

  async send(id: string, text: string, replyTo?: string, attachment?: GroupFilePayload, mentions?: GroupMention[], forwarded = false) {
    return this.run(async () => {
      const room = this.room(id);
      if (attachment && (!this.attachments || attachment.bytes.length > MAX_FILE_BYTES)) throw new Error('group_file_unavailable');
      const postId = crypto.randomUUID();
      const file = attachment && { id:postId, name:safeFileName(attachment.name), mime:attachment.mime,
        size:attachment.bytes.length, sha256:await sha256Hex(attachment.bytes), details:attachment.details };
      const trimStart = text.length - text.trimStart().length;
      const trimmedText = text.trim();
      const moved = parseGroupMentions(trimmedText, mentions?.map(([start, end, peer]) =>
        [start - trimStart, end - trimStart, peer]))?.filter(([, , peer]) =>
        peer !== this.port.self && room?.members.includes(peer) && this.port.allowed(peer));
      const previous = new Map(groupChronology(room?.entries ?? []).filter(entry => room?.members.includes(entry.from))
        .map(entry => [entry.from, entry.id]));
      const after = [...previous.values()];
      const post = { id:postId, from:this.port.self, text:trimmedText || file?.name || '', sentAt:Date.now(), replyTo,
        ...(after.length ? { after } : {}),
        ...(forwarded ? { forwarded:true as const } : {}),
        ...(file ? { file } : {}), ...(moved?.length ? { mentions:moved } : {}) };
      if (!room?.mls || (room.plan && !room.plan.key) || room.leaving || !validPost(post)) throw new Error('group_message_unavailable');
      if (replyTo !== undefined && !room.entries.some(entry => entry.id === replyTo)) throw new Error('group_reply_unavailable');
      const profile = await this.ownProfile(room);
      const { mls, entry } = await encryptGroupPost(room, post, this.port.identity, profile);
      const saved = { ...entry, nodeSince:post.sentAt, ...(attachment ? { fileReady:true as const } : {}) };
      const next = { ...room, mls, entries:trimGroupHistory(room, [...room.entries, saved]), activityAt:post.sentAt,
        ...(profile ? { profiles:{ ...room.profiles, [profile.by]:profile } } : {}) };
      if (room.actions) next.actions = retainGroupActions(next, room.actions);
      await this.save(next, attachment && { group:id, hash:entry.hash, bytes:attachment.bytes });
      this.relay(next, { type:'message', group:id, packet:entry.packet });
      for (const peer of groupPeers(next, this.port.self)) {
        if (this.peerEpochs.get(id + ':' + peer) !== epochOf(next)) void this.hello(next, peer);
      }
      return entry.id;
    });
  }

  actOnMessage(group: string, request: GroupActionRequest) {
    return this.run(async () => {
      const room = this.room(group), from = this.port.self;
      if (!room?.mls || room.departed || room.leaving || room.plan && !room.plan.key || !room.members.includes(from))
        throw new Error('group_message_unavailable');
      const target = room.entries.find(entry => entry.id === request.targetId && !entry.hidden);
      if (request.targetId !== null && (!target || !groupCanAddress(room, target))) throw new Error('group_message_unavailable');
      const previous = latestGroupAction(room, from, request);
      const revision = (previous?.revision ?? 0) + 1;
      let value: unknown;
      if (request.kind === 'edit') {
        if (!target || target.from !== from || !groupCanEdit(target))
          throw new Error('group_message_unavailable');
        if ((previous?.revision ?? 0) !== request.previousRevision) throw new Error('message_edit_changed');
        const before = previous?.kind === 'edit' ? previous : target;
        const text = request.text.trim();
        if (text === before.text) return;
        value = { ...request, revision, text, mentions:editGroupMentions(before.text, text, before.mentions ?? [])
          .filter(([, , peer]) => room.members.includes(peer) && this.port.allowed(peer)) };
      } else if (request.kind === 'reaction') {
        value = { ...request, revision, emoji:previous?.kind === 'reaction' && previous.emoji === request.emoji ? null : request.emoji };
      } else {
        if ((previous?.targetId ?? null) === request.targetId) return;
        value = { ...request, revision };
      }
      const action = parseGroupAction(value);
      if (!action) throw new Error(request.kind === 'edit' ? 'message_too_large' : 'group_message_unavailable');
      const now = Date.now();
      const { mls, entry } = await encryptGroupPost(room, { id:crypto.randomUUID(), from, text:'', sentAt:now, action }, this.port.identity);
      const next = { ...room, mls, actions:retainGroupActions(room, [...room.actions ?? [], { ...entry, nodeSince:now }]) };
      await this.save(next);
      this.relay(next, { type:'message', group, packet:entry.packet });
      for (const peer of groupPeers(next, from)) {
        if (!this.peersWithActions.has(group + ':' + peer)) void this.hello(next, peer);
      }
    });
  }

  readFile(group: string, hash: string) {
    return this.attachments?.read(group, hash) ?? Promise.resolve(null);
  }

  async obtainFile(group: string, hash: string) {
    if (!this.attachments) throw new Error('group_file_unavailable');
    await this.attachments.obtain(group, hash);
    await this.run(async () => {
      const room = this.room(group), entry = room?.entries.find(item => item.hash === hash);
      if (!room || !entry?.file || entry.fileReady && !entry.fileRequested) return;
      await this.save({ ...room, entries:room.entries.map(item =>
        item === entry ? { ...item, fileReady:true, fileRequested:undefined } : item) });
      if (entry.from !== this.port.self) void this.deliver(entry.from, { type:'file-ack', group, hashes:[hash] });
    });
  }

  hideMessages(group: string, ids: readonly string[]) {
    return this.run(async () => {
      const room = this.room(group);
      if (!room?.mls || room.departed || room.leaving) return;
      const selected = new Set(ids);
      await this.save({ ...room, entries:room.entries.map(entry => selected.has(entry.id) ? { ...entry, hidden:true } : entry) });
    });
  }

  fileRequested(group: string, hash: string) {
    return this.room(group)?.entries.find(entry => entry.hash === hash)?.fileRequested === true;
  }

  requestFile(group: string, hash: string, requested = true) {
    return this.run(async () => {
      const room = this.room(group);
      const entry = room?.entries.find(post => post.hash === hash);
      if (!room?.mls || room.departed || room.leaving || !entry?.file || entry.from === this.port.self ||
          !!entry.fileRequested === requested) return;
      const updated = { ...entry, fileRequested:requested ? true as const : undefined };
      await this.save({ ...room, entries:room.entries.map(post => post === entry ? updated : post) });
    });
  }

  close() { this.attachments?.close(); }

  canStoreOnNode(ref: GroupNodeReference, peer: string) {
    if (!this.port.active() || !this.port.nodeEnabled?.()) return false;
    const room = this.room(ref.group);
    const entry = room && groupRecords(room).find(post => post.hash === ref.hash);
    return !!room && !!entry && this.canQueueNodePost(room, entry, peer, Date.now(), ref.file);
  }

  private canQueueNodePost(room: GroupRoom, entry: GroupEntry, peer: string, now: number, file = false) {
    if (!room.mls || room.departed || room.leaving || room.plan && !room.plan.key) return false;
    if (entry.from === peer || peer === this.port.self || !room.members.includes(peer) || !this.port.contact(peer) || !this.port.allowed(peer)) return false;
    if (!room.members.includes(entry.from) || epochOf(room) - (entry.epoch ?? 1) >= GROUP_KEY_HISTORY) return false;
    const since = availableSince(entry);
    const audience = groupAudience(room, entry);
    if (since === undefined || now - since < 2000 || now - since >= COURIER_TTL ||
        !audience.includes(this.port.self) || !audience.includes(peer)) return false;
    // Each sender queues one encrypted copy per recipient. A recipient can
    // still serve verified bytes directly without duplicating node uploads.
    if (file) return entry.from === this.port.self && !!entry.file &&
      !entry.fileReceivedBy?.includes(peer) && entry.nodeFileStatus?.[peer] !== 'delivered' && entry.nodeFileStatus?.[peer] !== 'finished';
    return !entry.receivedBy?.includes(peer) && !entry.receipts?.some(receipt => receipt.by === peer) &&
      entry.nodeStatus?.[peer] !== 'delivered' && entry.nodeStatus?.[peer] !== 'finished';
  }

  canReleaseNodeCopy(ref: GroupNodeReference, peer: string) {
    const room = this.room(ref.group);
    if (!this.port.active() || !room) return false;
    if (room.departed || room.leaving || !room.members.includes(peer) || !this.port.allowed(peer)) return true;
    const entry = groupRecords(room).find(post => post.hash === ref.hash);
    if (ref.file) return !!entry && (!room.members.includes(entry.from) ||
      !groupAudience(room, entry).includes(peer) || entry.fileReceivedBy?.includes(peer) || epochOf(room) - (entry.epoch ?? 1) >= GROUP_KEY_HISTORY);
    return entry !== undefined && (!room.members.includes(entry.from) || entry.receivedBy?.includes(peer) === true ||
      entry.receipts?.some(receipt => receipt.by === peer) === true);
  }

  *nodePosts(file = false): Iterable<GroupNodePost> {
    if (!this.port.nodeEnabled?.() || !this.port.active()) return;
    const now = Date.now();
    for (const room of this.port.rooms()) for (const entry of file ? room.entries : groupRecords(room).sort(replayOrder)) {
      if (availableSince(entry) === undefined) continue;
      const ref = { group:room.id, hash:entry.hash };
      for (const peer of room.members) {
        if (!this.canQueueNodePost(room, entry, peer, now, file)) continue;
        const relay = entry.from !== this.port.self;
        // The node indexes jobs by ID, even when several senders use it.
        // Preserve existing author reservations and namespace relayed copies.
        const jobKey = relay ? [room.id, entry.hash, peer, this.port.self] : [room.id, entry.hash, peer];
        if (file) jobKey.push('file');
        const hex = bytesToHex(sha256(encoder.encode(JSON.stringify(jobKey))));
        const id = hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-5' + hex.slice(13, 16) + '-8' + hex.slice(17, 20) + '-' + hex.slice(20, 32);
        const frame: GroupMessageFrame = { type:'message', group:room.id, packet:entry.packet };
        yield { ...ref, id, peer, content:GROUP_PREFIX + JSON.stringify(frame), relay,
          ...(file ? { file:true, offer:entry.file } : {}) };
      }
    }
  }

  recordNodeStatus(ref: GroupNodeReference, peer: string, status: GroupNodeStatus) {
    return this.run(async () => {
      const room = this.room(ref.group);
      const entry = room && groupRecords(room).find(post => post.hash === ref.hash);
      const key = ref.file ? 'nodeFileStatus' : 'nodeStatus';
      if (!room || !entry || entry.from === peer || !groupAudience(room, entry).includes(peer) ||
          entry[key]?.[peer] === status || entry[key]?.[peer] === 'delivered') return;
      const updated = { ...entry, nodeSince:availableSince(entry) ?? Date.now(), [key]:{ ...entry[key], [peer]:status } };
      const field = entry.action ? 'actions' : 'entries';
      await this.save({ ...room, [field]:room[field]!.map(post => post === entry ? updated : post) });
    });
  }

  async receiveNodePost(peer: string, frame: GroupMessageFrame, node: string) {
    if (!this.port.active() || !this.port.contact(peer) || !this.port.allowed(peer)) return false;
    const acceptedAction = await this.receive(peer, frame, node);
    const room = this.room(frame.group);
    return !!room?.mls && room.members.includes(peer) && (!!acceptedAction || groupRecords(room).some(entry =>
      entry.packet === frame.packet && groupAudience(room, entry).includes(peer)));
  }

  nodeFileOffer(ref: GroupNodeReference, peer: string, offer: FileOffer): FileOffer | undefined {
    if (!this.port.active() || !this.port.contact(peer) || !this.port.allowed(peer)) return;
    const room = this.room(ref.group);
    if (!room?.mls || room.departed || room.leaving || (room.plan && !room.plan.key) || !room.members.includes(peer) ||
        !room.members.includes(this.port.self)) return;
    const entry = room.entries.find(value => value.hash === ref.hash);
    const normalized = normalizeFileOffer(offer);
    if (entry?.file && normalized && room.members.includes(entry.from) && epochOf(room) - (entry.epoch ?? 1) < GROUP_KEY_HISTORY &&
        groupAudience(room, entry).includes(peer) && groupAudience(room, entry).includes(this.port.self) &&
        sameFileOffer(normalizeFileOffer({ ...entry.file, id:offer.id })!, normalized)) return entry.file;
  }

  async receiveNodeFile(peer: string, frame: GroupMessageFrame, node: string, offer: FileOffer): Promise<GroupNodeReference | undefined> {
    if (!await this.receiveNodePost(peer, frame, node)) return;
    const ref: GroupNodeReference = { group:frame.group, hash:await groupPacketHash(frame.packet), file:true };
    if (this.nodeFileOffer(ref, peer, offer)) return ref;
  }

  completeNodeFile(ref: GroupNodeReference, peer: string, node: string, offer: FileOffer, bytes: Uint8Array) {
    return this.run(async () => {
      if (!this.nodeFileOffer(ref, peer, offer) || bytes.length !== offer.size || await sha256Hex(bytes) !== offer.sha256 ||
          !this.nodeFileOffer(ref, peer, offer)) throw new Error('group_file_unavailable');
      const room = this.room(ref.group)!;
      await this.save({ ...room, entries:room.entries.map(entry => entry.hash === ref.hash ? { ...entry, fileReady:true, fileNode:node, fileRequested:undefined } : entry) },
        { group:ref.group, hash:ref.hash, bytes });
    });
  }

  async markRead(id: string, hashes: string[]) {
    return this.run(async () => {
      const room = this.room(id);
      if (!room?.mls || room.leaving) return;
      const visible = new Set(hashes);
      const unread = room.entries.filter(entry => groupEntryUnread(entry, this.port.self) && visible.has(entry.hash));
      if (!unread.length) return;
      const readIds = new Set(unread.map(entry => entry.hash));
      const signed = this.port.readsEnabled?.()
        ? await Promise.all(unread.map(entry => this.signReceipt(room, entry, 'read').catch(() => undefined)))
        : [];
      const receipts = this.port.readsEnabled?.() ? signed.filter(receipt => receipt !== undefined) : [];
      const byHash = new Map(receipts.map(receipt => [receipt.hash, receipt]));
      const entries = room.entries.map(entry => {
        if (!readIds.has(entry.hash)) return entry;
        const read = { ...entry, unread:undefined };
        const receipt = byHash.get(entry.hash);
        return receipt ? withReceipt(read, receipt) : read;
      });
      await this.save({ ...room, entries });
      if (this.port.readsEnabled?.()) this.relayReceipts(room, receipts);
    });
  }

  private signReceipt(room: GroupRoom, entry: GroupEntry, state: GroupReceipt['state']) {
    return signGroupReceipt(room.id, { hash:entry.hash, by:this.port.self, state }, this.port.identity);
  }

  private relayReceipts(room: GroupRoom, receipts: GroupReceipt[], skip?: string) {
    for (let offset = 0; offset < receipts.length; offset += GROUP_RECEIPT_BATCH) {
      this.relay(room, { type:'receipts', group:room.id, receipts:receipts.slice(offset, offset + GROUP_RECEIPT_BATCH) }, skip);
    }
  }

  private async ownReceived(room: GroupRoom, entry: GroupEntry): Promise<GroupEntry> {
    if (!groupAudience(room, entry).includes(this.port.self) || entry.from === this.port.self || entry.receipts?.some(receipt => receipt.by === this.port.self)) return entry;
    try { return withReceipt(entry, await this.signReceipt(room, entry, 'received')); }
    catch { return entry; } // Receipt signing must not prevent saving a message.
  }

  private async signedWelcome(room: GroupRoom): Promise<GroupRoom> {
    if (room.owner !== this.port.self || epochOf(room) !== 1 || !room.welcome || room.welcomeProof) return room;
    const next = { ...room, welcomeProof:await signGroupWelcome(room, room.welcome, this.port.identity) };
    await this.save(next);
    return next;
  }

  private async sendWelcome(room: GroupRoom, peer: string, legacy: boolean) {
    if (!room.welcome) return;
    if (room.welcomeProof) {
      await this.deliver(peer, { type:'welcome-proof', group:room.id, packet:room.welcome, proof:room.welcomeProof });
    }
    if (legacy && room.owner === this.port.self) await this.deliver(peer, { type:'welcome', group:room.id, packet:room.welcome });
  }

  private async hello(room: GroupRoom, peer: string, repeatWelcome = false) {
    const key = `${room.id}:${peer}`;
    if (room.departed) return;
    const phase = `${key}:${epochOf(room)}:${repeatWelcome ? 'repeat-welcome' : room.mls ? 'active' : room.draft ? 'accepted' : 'invited'}`;
    if (this.hellos.has(phase)) return;
    this.hellos.add(phase);
    try {
      const peerEpoch = this.peerEpochs.get(key);
      // An original invitee may still need the epoch-one Welcome before later commits.
      if (epochOf(room) > 1 && (peerEpoch ?? 0) <= 1 && room.welcomeProof &&
        room.changes?.find(change => change.plan.epoch === 1)?.previous.includes(peer)) {
        await this.sendWelcome(room, peer, false);
      }
      await this.membership.sync(room, peer, peerEpoch);
      if (!room.members.includes(peer) || room.offer && !room.mls) return;
      if (room.owner === this.port.self) {
        if (!room.mls) {
          await this.deliver(peer, { type:'invite', group:room.id, title:room.title, members:room.members });
          return;
        }
        if (epochOf(room) === 1 && room.welcome && (repeatWelcome || !this.welcomed.has(key))) {
          await this.sendWelcome(room, peer, true);
        }
      } else if (repeatWelcome && epochOf(room) === 1) {
        await this.sendWelcome(room, peer, false);
      } else if (!room.mls && room.draft) {
        await this.deliver(peer, { type:'join', group:room.id, packet:room.draft.packet });
        return;
      }
      await this.sendSync(room.id, peer, true);
    } finally { this.hellos.delete(phase); }
  }

  private async sendSync(group: string, peer: string, requestEpoch = false) {
    let room = this.room(group);
    if (!room?.mls || !room.members.includes(peer) || !this.port.transport.ready(peer)) return;
    if (this.canShareProfiles(room)) {
      const nickname = this.port.nickname?.();
      if (validNickname(nickname) && room.profiles?.[this.port.self]?.nickname !== nickname)
        await this.run(() => this.saveOwnProfile(group)).catch(() => {});
      room = this.room(group);
    }
    if (!room?.mls || !room.members.includes(peer)) return;
    const profiles = this.canShareProfiles(room) ? room.members.flatMap(member => {
      const profile = room?.profiles?.[member];
      return profile && this.port.allowed(member) ? [profile] : [];
    }) : [];
    await this.deliver(peer, {
      type:'sync', group, known:room.entries.map(entry => entry.hash), hasWelcome:!!room.welcomeProof,
      epoch:epochOf(room), requestEpoch,
      seen:room.entries.map(entry => (entry.receipts ?? []).reduce((mask, receipt) => mask | receiptBits(room, entry, receipt), 0)),
      actionKnown:(room.actions ?? []).map(entry => groupActionToken(entry.hash)).join(''),
      ...(profiles.length ? { profiles } : {}),
    });
    const hashes = room.entries.filter(entry => entry.from === peer && entry.fileReady && !entry.fileNode).map(entry => entry.hash);
    if (hashes.length) await this.deliver(peer, { type:'file-ack', group, hashes });
  }

  private canShareProfiles(room: GroupRoom) {
    return !room.departed && !room.leaving && !room.plan && room.members.includes(this.port.self);
  }

  private async ownProfile(room: GroupRoom) {
    const nickname = this.port.nickname?.(), by = this.port.self;
    if (!this.canShareProfiles(room) || !validNickname(nickname)) return;
    const previous = room.profiles?.[by];
    if (previous?.nickname === nickname) return previous;
    const revision = Math.max(Date.now(), (previous?.revision ?? 0) + 1);
    return signGroupProfile(room.id, { by, nickname, revision }, this.port.identity);
  }

  private async saveOwnProfile(group: string) {
    const room = this.room(group);
    if (!room?.mls) return;
    const profile = await this.ownProfile(room);
    if (profile && profile !== room.profiles?.[profile.by]) await this.save({ ...room, profiles:{ ...room.profiles, [profile.by]:profile } });
  }

  private async receiveProfiles(room: GroupRoom, via: string, profiles: GroupProfile[]) {
    if (!this.canShareProfiles(room)) return room;
    const next = { ...room.profiles };
    let changed = false;
    for (const profile of profiles) {
      if (profile.by === this.port.self || !room.members.includes(profile.by) || !this.port.allowed(profile.by)) continue;
      const previous = next[profile.by];
      if (!newerProfile(profile, previous)) continue;
      if (!await verifyGroupProfile(room.id, profile)) continue;
      next[profile.by] = profile;
      changed = true;
    }
    if (!changed) return room;
    const updated = { ...room, profiles:next };
    await this.save(updated);
    for (const peer of room.members) {
      if (peer !== via && peer !== this.port.self && this.peerEpochs.get(room.id + ':' + peer) === epochOf(room))
        void this.sendSync(room.id, peer);
    }
    return updated;
  }

  peerOffline(peer: string) {
    this.attachments?.peerOffline(peer);
    for (const room of this.port.rooms()) {
      const key = room.id + ':' + peer;
      this.peerEpochs.delete(key);
      this.peersWithActions.delete(key);
      this.requestedSync.delete(key);
    }
  }

  peerOnline(peer: string) {
    for (const room of this.port.rooms()) {
      if (groupPeers(room, this.port.self).includes(peer)) void this.hello(room, peer);
    }
  }

  private async reply(room: GroupRoom, peer: string, known: string[], seen?: number[], actionKnown?: string) {
    const key = room.id + ':' + peer;
    this.requestedSync.set(key, { epoch:epochOf(room), known, seen, actionKnown });
    if (this.syncing.has(key)) return;
    this.syncing.add(key);
    try {
      let request;
      while ((request = this.requestedSync.get(key))) {
        this.requestedSync.delete(key);
        const current = this.room(room.id);
        if (current && epochOf(current) === request.epoch)
          await this.sendMissing(current, peer, request.known, request.seen, request.actionKnown);
      }
    } finally { this.syncing.delete(key); }
  }

  private async sendMissing(room: GroupRoom, peer: string, known: string[], seen?: number[], actionKnown?: string) {
    const epoch = epochOf(room);
    const ready = () => {
      const current = this.room(room.id);
      return this.port.active() && this.port.transport.ready(peer) && !!current && !current.departed &&
        !current.leaving && current.members.includes(peer) &&
        epochOf(current) === epoch && this.peerEpochs.get(room.id + ':' + peer) === epoch;
    };
    if (!ready()) return;
    const shareable = room.entries.filter(entry => groupAudience(room, entry).includes(peer));
    const inventory = new Map(known.map((hash, index) => [hash, seen?.[index] ?? 0]));
    const tokens = new Set(actionKnown?.match(/.{16}/g));
    const messages = shareable.filter(entry => !inventory.has(entry.hash));
    if (actionKnown !== undefined) {
      messages.push(...(room.actions ?? []).filter(entry => !tokens.has(groupActionToken(entry.hash)) &&
        groupAudience(room, entry).includes(peer)));
      messages.sort(replayOrder);
    }
    for (const entry of messages) {
      if (!ready()) return;
      if (entry.action && !this.room(room.id)?.actions?.some(current => current.hash === entry.hash)) continue;
      await this.deliver(peer, { type:'message', group:room.id, packet:entry.packet });
    }
    if (!seen) return;
    const missing = shareable.flatMap(entry => (entry.receipts ?? []).filter(receipt => {
      const bits = receiptBits(room, entry, receipt);
      return ((inventory.get(entry.hash) ?? 0) & bits) !== bits;
    }));
    for (let offset = 0; offset < missing.length && ready(); offset += GROUP_RECEIPT_BATCH)
      await this.deliver(peer, { type:'receipts', group:room.id, receipts:missing.slice(offset, offset + GROUP_RECEIPT_BATCH) });
  }

  private async receiveReceipts(room: GroupRoom, peer: string, receipts: GroupReceipt[]) {
    const entries = new Map(room.entries.map(entry => [entry.hash, entry]));
    const accepted: GroupReceipt[] = [];
    for (const receipt of receipts) {
      const entry = entries.get(receipt.hash);
      if (!entry || receipt.by === entry.from || !groupAudience(room, entry).includes(receipt.by)) continue;
      const existing = entry.receipts?.find(item => item.by === receipt.by);
      if (existing && (existing.state === 'read' || existing.state === receipt.state)) continue;
      if (!await verifyGroupReceipt(room.id, receipt)) continue;
      entries.set(entry.hash, withReceipt(entry, receipt));
      accepted.push(receipt);
    }
    if (!accepted.length) return;
    await this.save({ ...room, entries:[...entries.values()] });
    this.relayReceipts(room, accepted, peer);
  }

  private async acknowledge(room: GroupRoom, peer: string, hashes: string[], actionKnown?: string) {
    const known = new Set(hashes);
    const tokens = new Set(actionKnown?.match(/.{16}/g));
    let changed = false;
    const acknowledgeEntry = (entry: GroupEntry) => {
      if (!known.has(entry.hash) && !(entry.action && tokens.has(groupActionToken(entry.hash))) ||
          !entry.action && entry.from !== this.port.self || entry.from === peer ||
          !groupAudience(room, entry).includes(peer) || entry.receivedBy?.includes(peer)) return entry;
      changed = true;
      return { ...entry, receivedBy: [...(entry.receivedBy ?? []), peer] };
    };
    const entries = room.entries.map(acknowledgeEntry), actions = room.actions?.map(acknowledgeEntry);
    if (changed) await this.save({ ...room, entries, actions });
  }

  receive(peer: string, value: unknown, node?: string): Promise<void | true> {
    const frame = parseGroupFrame(value);
    if (!frame || !this.port.allowed(peer) || peer === this.port.self) return Promise.resolve();
    if (isGroupFileFrame(frame)) {
      if (!node) this.attachments?.receive(peer, frame);
      return Promise.resolve();
    }
    return this.run<void | true>(async () => {
      const room = this.room(frame.group);
      if (isMembershipFrame(frame)) {
        await this.membership.receive(room, peer, frame);
        return;
      }
      if (frame.type === 'invite') {
        if (frame.members.length < 2 || !this.port.contact(peer) || !frame.members.includes(peer) || !frame.members.includes(this.port.self)) return;
        if (room) {
          if (!room.departed && !room.offer && room.owner === peer && !room.mls && room.draft) void this.hello(room, peer);
        } else if (this.port.rooms().filter(room => !room.departed).length < MAX_GROUPS) {
          await this.save({ id:frame.group, title:frame.title, owner:peer, members:frame.members, keys:{}, entries:[], activityAt:Date.now() });
        }
        return;
      }
      if (!room || room.departed || room.offer && !room.mls) return;
      if (!room.members.includes(peer)) {
        if (frame.type === 'sync') void this.membership.sync(room, peer, frame.epoch ?? 1);
        return;
      }
      if (frame.type === 'join') {
        const ownsGroup = room.owner === this.port.self;
        if (ownsGroup ? !this.port.contact(peer) : !room.mls || !room.welcomeProof) return;
        if (room.keys[peer] && room.keys[peer] !== frame.packet || !await validateJoinKey(room, peer, frame.packet)) return;
        if (room.mls) {
          const ready = await this.signedWelcome(room);
          void this.hello(ready, peer, true);
          return;
        }
        const next = { ...room, keys:{ ...room.keys, [peer]:frame.packet } };
        if (room.members.every(member => member === this.port.self || next.keys[member])) {
          const established = await this.signedWelcome({ ...next, ...await establishGroup(next, this.port.identity), keys:{} });
          for (const member of room.members) if (member !== this.port.self) void this.hello(established, member);
        } else await this.save(next);
        return;
      }
      if (frame.type === 'welcome' || frame.type === 'welcome-proof') {
        if (!this.port.contact(room.owner) || room.welcomeProof || room.welcome && room.welcome !== frame.packet) return;
        const proof = frame.type === 'welcome-proof' ? frame.proof : undefined;
        if (proof) {
          if (!await verifyGroupWelcome(room, frame.packet, proof)) return;
        } else if (peer !== room.owner || room.mls) return;
        if (room.mls) {
          if (proof) await this.save({ ...room, welcome:frame.packet, welcomeProof:proof });
          return;
        }
        if (!room.draft) return;
        let joined: GroupRoom;
        try {
          joined = { ...room, mls:await acceptGroupWelcome(room, frame.packet), draft:undefined, welcome:frame.packet, welcomeProof:proof };
          await this.save(joined);
        } catch {
          if (this.port.active()) this.port.welcomeFailed?.(room.id);
          return;
        }
        for (const member of room.members) if (member !== this.port.self) void this.hello(joined, member);
        return;
      }
      if (!room.mls || (room.leaving && frame.type !== 'sync')) return;
      if (frame.type === 'sync') {
        const epoch = frame.epoch ?? 1;
        const peerKey = room.id + ':' + peer;
        this.peerEpochs.set(peerKey, epoch);
        if (frame.actionKnown === undefined) this.peersWithActions.delete(peerKey);
        else this.peersWithActions.add(peerKey);
        if (epoch !== epochOf(room)) {
          if (epoch < epochOf(room)) void this.membership.sync(room, peer, epoch);
          else if (frame.requestEpoch) void this.sendSync(room.id, peer);
          return;
        }
        this.welcomed.add(room.id + ':' + peer);
        await this.acknowledge(room, peer, frame.known, frame.actionKnown);
        let current = this.room(room.id)!;
        if (epoch > (current.memberEpochs?.[peer] ?? 1)) {
          current = { ...current, memberEpochs:{ ...current.memberEpochs, [peer]:epoch } };
          await this.save(current);
        }
        if (frame.profiles) current = await this.receiveProfiles(current, peer, frame.profiles);
        if (frame.requestEpoch) void this.sendSync(current.id, peer);
        if (frame.seen) {
          if (!frame.hasWelcome && epoch === 1) {
            current = await this.signedWelcome(current);
            if (current.welcomeProof) void this.sendWelcome(current, peer, false);
          }
          const previous = current.entries;
          const entries = await Promise.all(previous.map(entry => this.ownReceived(current, entry)));
          const added = entries.flatMap((entry, index) => entry === previous[index]
            ? [] : (entry.receipts ?? []).filter(receipt => receipt.by === this.port.self));
          if (added.length) {
            current = { ...current, entries };
            await this.save(current);
            this.relayReceipts(current, added, peer);
          }
        }
        void this.reply(current, peer, frame.known, frame.seen, frame.actionKnown);
        return;
      }
      if (frame.type === 'ack') { await this.acknowledge(room, peer, [frame.hash]); return; }
      if (frame.type === 'file-ack') {
        const hashes = new Set(frame.hashes);
        const entries = room.entries.map(entry => entry.from === this.port.self && entry.file && hashes.has(entry.hash) &&
          groupAudience(room, entry).includes(peer) && !entry.fileReceivedBy?.includes(peer)
          ? { ...entry, fileReceivedBy:[...entry.fileReceivedBy ?? [], peer] } : entry);
        if (entries.some((entry,index) => entry !== room.entries[index])) await this.save({ ...room, entries });
        return;
      }
      if (frame.type === 'receipts') { await this.receiveReceipts(room, peer, frame.receipts); return; }
      if (room.plan && !room.plan.key) return;
      const hash = await groupPacketHash(frame.packet);
      const records = groupRecords(room);
      const known = records.find(entry => entry.hash === hash);
      if (known) {
        if (known.action) void this.deliver(peer, { type:'ack', group:room.id, hash });
        else if (known.from !== this.port.self) void this.deliver(known.from, { type:'ack', group:room.id, hash });
        return;
      }
      const { mls, entry, profile } = await decryptGroupPost(room, frame.packet, hash);
      if (entry.from === this.port.self || (node && !groupAudience(room, entry).includes(peer)) ||
          records.some(item => item.id === entry.id)) return;
      if (entry.action) {
        const accepted = { ...entry, nodeSince:Date.now(), receivedBy:[peer] };
        const next = { ...room, mls, actions:retainGroupActions(room, [...room.actions ?? [], accepted]) };
        await this.save(next);
        void this.deliver(peer, { type:'ack', group:room.id, hash });
        if (next.actions.includes(accepted)) this.relay(next, { type:'message', group:room.id, packet:entry.packet }, peer);
        return true;
      }
      // An accepted carrier already has these ciphertext bytes. Never queue the
      // same packet back to it, or to the original author.
      const received = await this.ownReceived(room, { ...entry, unread:true, route:{ peer, ...(node ? { node } : {}) }, nodeSince:Date.now(), receivedBy:[peer] });
      const next = { ...room, mls, entries:trimGroupHistory(room, [...room.entries, received]), activityAt:Date.now(),
        ...(profile && newerProfile(profile, room.profiles?.[profile.by]) ? { profiles:{ ...room.profiles, [profile.by]:profile } } : {}) };
      if (room.actions) next.actions = retainGroupActions(next, room.actions);
      await this.save(next);
      void this.deliver(entry.from, { type:'ack', group:room.id, hash });
      this.relay(next, { type:'message', group:room.id, packet:entry.packet }, peer);
      this.relayReceipts(next, received.receipts ?? []);
    }).catch(() => {
      // A replay, malformed MLS packet or closed account never changes the room.
    });
  }
}
