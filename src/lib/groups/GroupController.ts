import type { IdentityProvider } from '$lib/identity/identity';
import { acceptGroupWelcome, createGroupKey, decryptGroupPost, encryptGroupPost, establishGroup, groupPacketHash,
  signGroupReceipt, signGroupWelcome, validateJoinKey, verifyGroupReceipt, verifyGroupWelcome } from './mls';
import { GROUP_HISTORY, GROUP_RECEIPT_BATCH, MAX_GROUPS, MAX_GROUP_MEMBERS, groupMembers, groupTitle, parseGroupFrame,
  type GroupFrame, type GroupReceipt, type GroupTransport } from './protocol';
import { validPost, type GroupEntry, type GroupRoom, type GroupRooms } from './storage';

type GroupPort = {
  self: string;
  identity: IdentityProvider;
  active(): boolean;
  contact(peer: string): boolean;
  allowed(peer: string): boolean;
  readsEnabled?(): boolean;
  rooms(): GroupRooms;
  save(rooms: GroupRooms): Promise<void>;
  welcomeFailed?(group: string): void;
  transport: GroupTransport;
};

function receiptBits(room: GroupRoom, receipt: GroupReceipt): number {
  const bit = 1 << room.members.indexOf(receipt.by);
  return receipt.state === 'read' ? bit | (bit << MAX_GROUP_MEMBERS) : bit;
}

function withReceipt(entry: GroupEntry, receipt: GroupReceipt): GroupEntry {
  return { ...entry, receipts:[...(entry.receipts ?? []).filter(item => item.by !== receipt.by), receipt] };
}

export class GroupController {
  private tail: Promise<unknown> = Promise.resolve();
  private syncing = new Set<string>();
  private hellos = new Set<string>();
  private welcomed = new Set<string>();
  constructor(private readonly port: GroupPort) {}

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
    await this.port.save(rooms.some(item => item.id === room.id)
      ? rooms.map(item => item.id === room.id ? room : item) : [...rooms, room]);
  }

  private async deliver(peer: string, value: GroupFrame) {
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
      if (!groupTitle(title) || !groupMembers(members) || selected.some(peer => !this.port.contact(peer)) ||
        this.port.rooms().length >= MAX_GROUPS) throw new Error('group_invalid_selection');
      const room: GroupRoom = { id:crypto.randomUUID(), title, members, owner:this.port.self, keys:{}, entries:[], activityAt:Date.now() };
      await this.save(room);
      for (const peer of selected) void this.hello(room, peer);
      return room.id;
    });
  }

  async accept(id: string) {
    return this.run(async () => {
      const room = this.room(id);
      if (!room || room.owner === this.port.self || room.mls || !this.port.contact(room.owner)) throw new Error('group_invite_unavailable');
      const accepted = room.draft ? room : { ...room, draft:await createGroupKey(room, this.port.self, this.port.identity) };
      if (!room.draft) await this.save(accepted);
      for (const peer of room.members) if (peer !== this.port.self) void this.hello(accepted, peer);
    });
  }

  async send(id: string, text: string) {
    return this.run(async () => {
      const room = this.room(id);
      const post = { id:crypto.randomUUID(), from:this.port.self, text:text.trim() };
      if (!room?.mls || !validPost(post)) throw new Error('group_message_unavailable');
      const { mls, entry } = await encryptGroupPost(room, post, this.port.identity);
      const next = { ...room, mls, entries:[...room.entries, entry].slice(-GROUP_HISTORY), activityAt:Date.now() };
      await this.save(next);
      this.relay(next, { type:'message', group:id, packet:entry.packet });
    });
  }

  async markRead(id: string, hashes: string[]) {
    return this.run(async () => {
      const room = this.room(id);
      if (!room?.mls || !this.port.readsEnabled?.()) return;
      const visible = new Set(hashes);
      const receipts: GroupReceipt[] = [];
      const entries = await Promise.all(room.entries.map(async entry => {
        if (entry.from === this.port.self || !visible.has(entry.hash) ||
          entry.receipts?.some(receipt => receipt.by === this.port.self && receipt.state === 'read')) return entry;
        const receipt = await this.signReceipt(room, entry, 'read');
        receipts.push(receipt);
        return withReceipt(entry, receipt);
      }));
      if (!receipts.length || !this.port.readsEnabled?.()) return;
      await this.save({ ...room, entries });
      this.relayReceipts(room, receipts);
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
    if (entry.from === this.port.self || entry.receipts?.some(receipt => receipt.by === this.port.self)) return entry;
    try { return withReceipt(entry, await this.signReceipt(room, entry, 'received')); }
    catch { return entry; } // Receipt signing must not prevent saving a message.
  }

  private async signedWelcome(room: GroupRoom): Promise<GroupRoom> {
    if (room.owner !== this.port.self || !room.welcome || room.welcomeProof) return room;
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
    const phase = `${key}:${repeatWelcome ? 'repeat-welcome' : room.mls ? 'active' : room.draft ? 'accepted' : 'invited'}`;
    if (this.hellos.has(phase)) return;
    this.hellos.add(phase);
    try {
      if (room.owner === this.port.self) {
        if (!room.mls) {
          await this.deliver(peer, { type:'invite', group:room.id, title:room.title, members:room.members });
          return;
        }
        if (room.welcome && (repeatWelcome || !this.welcomed.has(key))) {
          await this.sendWelcome(room, peer, true);
        }
      } else if (repeatWelcome) {
        await this.sendWelcome(room, peer, false);
      } else if (!room.mls && room.draft) {
        await this.deliver(peer, { type:'join', group:room.id, packet:room.draft.packet });
        return;
      }
      if (room.mls) await this.deliver(peer, {
        type:'sync', group:room.id, known:room.entries.map(entry => entry.hash), hasWelcome:!!room.welcomeProof,
        seen:room.entries.map(entry => (entry.receipts ?? []).reduce((mask, receipt) => mask | receiptBits(room, receipt), 0)),
      });
    } finally { this.hellos.delete(phase); }
  }

  peerOnline(peer: string) {
    for (const room of this.port.rooms()) if (room.members.includes(peer) && peer !== this.port.self) void this.hello(room, peer);
  }

  private async reply(room: GroupRoom, peer: string, known: string[], seen?: number[]) {
    const key = room.id + ':' + peer;
    if (this.syncing.has(key)) return;
    this.syncing.add(key);
    const inventory = new Map(known.map((hash, index) => [hash, seen?.[index] ?? 0]));
    try {
      for (const entry of room.entries) {
        if (!this.port.active() || !this.port.transport.ready(peer)) break;
        if (!inventory.has(entry.hash)) await this.deliver(peer, { type:'message', group:room.id, packet:entry.packet });
      }
      if (seen) {
        const missing = room.entries.flatMap(entry => (entry.receipts ?? []).filter(receipt => {
          const bits = receiptBits(room, receipt);
          return ((inventory.get(entry.hash) ?? 0) & bits) !== bits;
        }));
        for (let offset = 0; offset < missing.length && this.port.transport.ready(peer); offset += GROUP_RECEIPT_BATCH) {
          await this.deliver(peer, { type:'receipts', group:room.id, receipts:missing.slice(offset, offset + GROUP_RECEIPT_BATCH) });
        }
      }
    } finally { this.syncing.delete(key); }
  }

  private async receiveReceipts(room: GroupRoom, peer: string, receipts: GroupReceipt[]) {
    const entries = new Map(room.entries.map(entry => [entry.hash, entry]));
    const accepted: GroupReceipt[] = [];
    for (const receipt of receipts) {
      const entry = entries.get(receipt.hash);
      if (!entry || receipt.by === entry.from || !room.members.includes(receipt.by)) continue;
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
      if (entry.from !== this.port.self || !known.has(entry.hash) || entry.receivedBy?.includes(peer)) return entry;
      changed = true;
      return { ...entry, receivedBy: [...(entry.receivedBy ?? []), peer] };
    });
    if (changed) await this.save({ ...room, entries });
  }

  receive(peer: string, value: unknown): Promise<void> {
    const frame = parseGroupFrame(value);
    if (!frame || !this.port.allowed(peer) || peer === this.port.self) return Promise.resolve();
    return this.run(async () => {
      const room = this.room(frame.group);
      if (frame.type === 'invite') {
        if (!this.port.contact(peer) || !frame.members.includes(peer) || !frame.members.includes(this.port.self)) return;
        if (room) {
          if (room.owner === peer && !room.mls && room.draft) void this.hello(room, peer);
        } else if (this.port.rooms().length < MAX_GROUPS) {
          await this.save({ id:frame.group, title:frame.title, owner:peer, members:frame.members, keys:{}, entries:[], activityAt:Date.now() });
        }
        return;
      }
      if (!room?.members.includes(peer)) return;
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
      if (!room.mls) return;
      if (frame.type === 'sync') {
        this.welcomed.add(`${room.id}:${peer}`);
        await this.acknowledge(room, peer, frame.known);
        let current = this.room(room.id)!;
        if (frame.seen) {
          if (!frame.hasWelcome) {
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
      const hash = await groupPacketHash(frame.packet);
      const known = room.entries.find(entry => entry.hash === hash);
      if (known) {
        if (known.from !== this.port.self) void this.deliver(known.from, { type:'ack', group:room.id, hash });
        return;
      }
      const { mls, entry } = await decryptGroupPost(room, frame.packet, hash);
      if (entry.from === this.port.self || room.entries.some(item => item.id === entry.id)) return;
      const received = await this.ownReceived(room, entry);
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
