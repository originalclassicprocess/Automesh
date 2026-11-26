import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '$lib/message/encoding';
import { COURIER_TTL } from '$lib/node/courier-protocol.js';
import type { IdentityProvider } from '$lib/identity/identity';
import { acceptGroupWelcome, createGroupKey, decryptGroupPost, encryptGroupPost, establishGroup, groupPacketHash,
  signGroupReceipt, signGroupWelcome, validateJoinKey, verifyGroupReceipt, verifyGroupWelcome } from './mls';
import { GroupMembership } from './GroupMembership';
import { GROUP_HISTORY, GROUP_KEY_HISTORY, GROUP_RECEIPT_BATCH, MAX_GROUPS, MAX_GROUP_MEMBERS, groupMembers, groupTitle, isMembershipFrame, parseGroupFrame,
  GROUP_PREFIX, type GroupFrame, type GroupReceipt, type GroupTransport } from './protocol';
import { epochOf, groupAudience, groupEntryUnread, groupPeers, validPost, type GroupEntry, type GroupNodeStatus, type GroupRoom, type GroupRooms } from './storage';

type GroupMessageFrame = Extract<GroupFrame, { type:'message' }>;
export type GroupNodeReference = { group: string; hash: string };
export type GroupNodePost = GroupNodeReference & { id: string; peer: string; content: string; relay: boolean };
const encoder = new TextEncoder();
const availableSince = (entry: GroupEntry) => entry.nodeSince ?? entry.sentAt;

type GroupPort = {
  self: string;
  identity: IdentityProvider;
  active(): boolean;
  contact(peer: string): boolean;
  allowed(peer: string): boolean;
  readsEnabled?(): boolean;
  nodeEnabled?(): boolean;
  rooms(): GroupRooms;
  save(rooms: GroupRooms): Promise<void>;
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
  private requestedSync = new Map<string, { epoch: number; known: string[]; seen?: number[] }>();
  private hellos = new Set<string>();
  private welcomed = new Set<string>();
  private peerEpochs = new Map<string, number>();
  private readonly membership: GroupMembership;
  constructor(private readonly port: GroupPort) {
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
  private async save(room: GroupRoom) {
    if (!this.port.active()) throw new Error('group_inactive');
    const rooms = this.port.rooms();
    const updated = rooms.some(item => item.id === room.id)
      ? rooms.map(item => item.id === room.id ? room : item) : [...rooms, room];
    await this.port.save([...updated.filter(item => !item.departed), ...updated.filter(item => item.departed).slice(-MAX_GROUPS * 7)]);
  }

  private async deliver(peer: string, value: GroupFrame) {
    if (value.type === 'message') {
      const room = this.room(value.group);
      if (!room?.mls || room.leaving || (room.plan && !room.plan.key) || !room.members.includes(peer) ||
        this.peerEpochs.get(room.id + ':' + peer) !== epochOf(room)) return;
    }
    if (this.port.active() && this.port.allowed(peer) && this.port.transport.ready(peer))
      await this.port.transport.send(peer, value).catch(() => {});
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

  async send(id: string, text: string, replyTo?: string) {
    return this.run(async () => {
      const room = this.room(id);
      const post = { id:crypto.randomUUID(), from:this.port.self, text:text.trim(), sentAt:Date.now(), replyTo };
      if (!room?.mls || (room.plan && !room.plan.key) || room.leaving || !validPost(post)) throw new Error('group_message_unavailable');
      if (replyTo !== undefined && !room.entries.some(entry => entry.id === replyTo)) throw new Error('group_reply_unavailable');
      const { mls, entry } = await encryptGroupPost(room, post, this.port.identity);
      const saved = { ...entry, nodeSince:post.sentAt };
      const next = { ...room, mls, entries:[...room.entries, saved].slice(-GROUP_HISTORY), activityAt:post.sentAt };
      await this.save(next);
      this.relay(next, { type:'message', group:id, packet:entry.packet });
      for (const peer of groupPeers(next, this.port.self)) {
        if (this.peerEpochs.get(id + ':' + peer) !== epochOf(next)) void this.hello(next, peer);
      }
      return entry.id;
    });
  }

  canStoreOnNode(ref: GroupNodeReference, peer: string) {
    if (!this.port.active() || !this.port.nodeEnabled?.()) return false;
    const room = this.room(ref.group);
    const entry = room?.entries.find(post => post.hash === ref.hash);
    return !!room && !!entry && this.canQueueNodePost(room, entry, peer, Date.now());
  }

  private canQueueNodePost(room: GroupRoom, entry: GroupEntry, peer: string, now: number) {
    if (!room.mls || room.departed || room.leaving || room.plan && !room.plan.key) return false;
    if (entry.from === peer || peer === this.port.self || !room.members.includes(peer) || !this.port.contact(peer) || !this.port.allowed(peer)) return false;
    if (!room.members.includes(entry.from) || epochOf(room) - (entry.epoch ?? 1) >= GROUP_KEY_HISTORY) return false;
    const since = availableSince(entry);
    const audience = groupAudience(room, entry);
    return since !== undefined && now - since >= 2000 && now - since < COURIER_TTL &&
      audience.includes(this.port.self) && audience.includes(peer) &&
      !entry.receivedBy?.includes(peer) && !entry.receipts?.some(receipt => receipt.by === peer) &&
      entry.nodeStatus?.[peer] !== 'delivered' && entry.nodeStatus?.[peer] !== 'finished';
  }

  canReleaseNodeCopy(ref: GroupNodeReference, peer: string) {
    const room = this.room(ref.group);
    if (!this.port.active() || !room) return false;
    if (room.departed || room.leaving || !room.members.includes(peer) || !this.port.allowed(peer)) return true;
    const entry = room.entries.find(post => post.hash === ref.hash);
    return entry !== undefined && (!room.members.includes(entry.from) || entry.receivedBy?.includes(peer) === true ||
      entry.receipts?.some(receipt => receipt.by === peer) === true);
  }

  *nodePosts(): Iterable<GroupNodePost> {
    if (!this.port.nodeEnabled?.() || !this.port.active()) return;
    const now = Date.now();
    for (const room of this.port.rooms()) for (const entry of room.entries) {
      if (availableSince(entry) === undefined) continue;
      const ref = { group:room.id, hash:entry.hash };
      for (const peer of room.members) {
        if (!this.canQueueNodePost(room, entry, peer, now)) continue;
        const relay = entry.from !== this.port.self;
        // The node indexes jobs by ID, even when several senders use it.
        // Preserve existing author reservations and namespace relayed copies.
        const jobKey = relay ? [room.id, entry.hash, peer, this.port.self] : [room.id, entry.hash, peer];
        const hex = bytesToHex(sha256(encoder.encode(JSON.stringify(jobKey))));
        const id = hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-5' + hex.slice(13, 16) + '-8' + hex.slice(17, 20) + '-' + hex.slice(20, 32);
        const frame: GroupMessageFrame = { type:'message', group:room.id, packet:entry.packet };
        yield { ...ref, id, peer, content:GROUP_PREFIX + JSON.stringify(frame), relay };
      }
    }
  }

  recordNodeStatus(ref: GroupNodeReference, peer: string, status: GroupNodeStatus) {
    return this.run(async () => {
      const room = this.room(ref.group);
      const entry = room?.entries.find(post => post.hash === ref.hash);
      if (!room || !entry || entry.from === peer || !groupAudience(room, entry).includes(peer) ||
          entry.nodeStatus?.[peer] === status || entry.nodeStatus?.[peer] === 'delivered') return;
      const updated = { ...entry, nodeSince:availableSince(entry) ?? Date.now(), nodeStatus:{ ...entry.nodeStatus, [peer]:status } };
      await this.save({ ...room, entries:room.entries.map(post => post === entry ? updated : post) });
    });
  }

  async receiveNodePost(peer: string, frame: GroupMessageFrame, node: string) {
    if (!this.port.active() || !this.port.contact(peer) || !this.port.allowed(peer)) return false;
    await this.receive(peer, frame, node);
    const room = this.room(frame.group);
    return !!room?.mls && room.members.includes(peer) && room.entries.some(entry =>
      entry.packet === frame.packet && groupAudience(room, entry).includes(peer));
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
    const room = this.room(group);
    if (!room?.mls || !room.members.includes(peer)) return;
    await this.deliver(peer, {
      type:'sync', group, known:room.entries.map(entry => entry.hash), hasWelcome:!!room.welcomeProof,
      epoch:epochOf(room), requestEpoch,
      seen:room.entries.map(entry => (entry.receipts ?? []).reduce((mask, receipt) => mask | receiptBits(room, entry, receipt), 0)),
    });
  }

  peerOffline(peer: string) {
    for (const room of this.port.rooms()) {
      const key = room.id + ':' + peer;
      this.peerEpochs.delete(key);
      this.requestedSync.delete(key);
    }
  }

  peerOnline(peer: string) {
    for (const room of this.port.rooms()) {
      if (groupPeers(room, this.port.self).includes(peer)) void this.hello(room, peer);
    }
  }

  private async reply(room: GroupRoom, peer: string, known: string[], seen?: number[]) {
    const key = room.id + ':' + peer;
    this.requestedSync.set(key, { epoch:epochOf(room), known, seen });
    if (this.syncing.has(key)) return;
    this.syncing.add(key);
    try {
      let request;
      while ((request = this.requestedSync.get(key))) {
        this.requestedSync.delete(key);
        const current = this.room(room.id);
        if (current && epochOf(current) === request.epoch)
          await this.sendMissing(current, peer, request.known, request.seen);
      }
    } finally { this.syncing.delete(key); }
  }

  private async sendMissing(room: GroupRoom, peer: string, known: string[], seen?: number[]) {
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
    for (const entry of shareable) {
      if (!ready()) return;
      if (!inventory.has(entry.hash)) await this.deliver(peer, { type:'message', group:room.id, packet:entry.packet });
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

  private async acknowledge(room: GroupRoom, peer: string, hashes: string[]) {
    const known = new Set(hashes);
    let changed = false;
    const entries = room.entries.map(entry => {
      if (entry.from !== this.port.self || !known.has(entry.hash) || !groupAudience(room, entry).includes(peer) || entry.receivedBy?.includes(peer)) return entry;
      changed = true;
      return { ...entry, receivedBy: [...(entry.receivedBy ?? []), peer] };
    });
    if (changed) await this.save({ ...room, entries });
  }

  receive(peer: string, value: unknown, node?: string): Promise<void> {
    const frame = parseGroupFrame(value);
    if (!frame || !this.port.allowed(peer) || peer === this.port.self) return Promise.resolve();
    return this.run(async () => {
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
        this.peerEpochs.set(room.id + ':' + peer, epoch);
        if (epoch !== epochOf(room)) {
          if (epoch < epochOf(room)) void this.membership.sync(room, peer, epoch);
          else if (frame.requestEpoch) void this.sendSync(room.id, peer);
          return;
        }
        this.welcomed.add(room.id + ':' + peer);
        await this.acknowledge(room, peer, frame.known);
        let current = this.room(room.id)!;
        if (epoch > (current.memberEpochs?.[peer] ?? 1)) {
          current = { ...current, memberEpochs:{ ...current.memberEpochs, [peer]:epoch } };
          await this.save(current);
        }
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
        void this.reply(current, peer, frame.known, frame.seen);
        return;
      }
      if (frame.type === 'ack') { await this.acknowledge(room, peer, [frame.hash]); return; }
      if (frame.type === 'receipts') { await this.receiveReceipts(room, peer, frame.receipts); return; }
      if (room.plan && !room.plan.key) return;
      const hash = await groupPacketHash(frame.packet);
      const known = room.entries.find(entry => entry.hash === hash);
      if (known) {
        if (known.from !== this.port.self) void this.deliver(known.from, { type:'ack', group:room.id, hash });
        return;
      }
      const { mls, entry } = await decryptGroupPost(room, frame.packet, hash);
      if (entry.from === this.port.self || (node && !groupAudience(room, entry).includes(peer)) ||
          room.entries.some(item => item.id === entry.id)) return;
      // An accepted carrier already has these ciphertext bytes. Never queue the
      // same packet back to it, or to the original author.
      const received = await this.ownReceived(room, { ...entry, unread:true, route:{ peer, ...(node ? { node } : {}) }, nodeSince:Date.now(), receivedBy:[peer] });
      const next = { ...room, mls, entries:[...room.entries, received].slice(-GROUP_HISTORY), activityAt:Date.now() };
      await this.save(next);
      void this.deliver(entry.from, { type:'ack', group:room.id, hash });
      this.relay(next, { type:'message', group:room.id, packet:entry.packet }, peer);
      this.relayReceipts(next, received.receipts ?? []);
    }).catch(() => {
      // A replay, malformed MLS packet or closed account never changes the room.
    });
  }
}
