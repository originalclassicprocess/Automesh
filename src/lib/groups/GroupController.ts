import type { IdentityProvider } from '$lib/identity/identity';
import { acceptGroupWelcome, createGroupKey, decryptGroupPost, encryptGroupPost, establishGroup, groupPacketHash, validateJoinKey } from './mls';
import { GROUP_HISTORY, MAX_GROUPS, groupMembers, groupTitle, parseGroupFrame, type GroupFrame, type GroupTransport } from './protocol';
import { validPost, type GroupRoom, type GroupRooms } from './storage';

type GroupPort = {
  self: string;
  identity: IdentityProvider;
  active(): boolean;
  contact(peer: string): boolean;
  allowed(peer: string): boolean;
  rooms(): GroupRooms;
  save(rooms: GroupRooms): Promise<void>;
  welcomeFailed?(group: string): void;
  transport: GroupTransport;
};

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

  private relay(room: GroupRoom, packet: string, skip?: string) {
    for (const peer of room.members) if (peer !== this.port.self && peer !== skip)
      void this.deliver(peer, { type:'message', group:room.id, packet });
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
      void this.hello(accepted, room.owner);
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
      this.relay(next, entry.packet);
    });
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
          await this.deliver(peer, { type:'welcome', group:room.id, packet:room.welcome });
        }
      } else if (!room.mls && room.draft && peer === room.owner) {
        await this.deliver(peer, { type:'join', group:room.id, packet:room.draft.packet });
        return;
      }
      if (room.mls) await this.deliver(peer, { type:'sync', group:room.id, known:room.entries.map(entry => entry.hash) });
    } finally { this.hellos.delete(phase); }
  }

  peerOnline(peer: string) {
    for (const room of this.port.rooms()) if (room.members.includes(peer) && peer !== this.port.self) void this.hello(room, peer);
  }

  private async reply(room: GroupRoom, peer: string, known: string[]) {
    const key = room.id + ':' + peer;
    if (this.syncing.has(key)) return;
    this.syncing.add(key);
    const seen = new Set(known);
    try {
      for (const entry of room.entries) {
        if (!this.port.active() || !this.port.transport.ready(peer)) break;
        if (!seen.has(entry.hash)) await this.deliver(peer, { type:'message', group:room.id, packet:entry.packet });
      }
    } finally { this.syncing.delete(key); }
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
        if (room.owner !== this.port.self || !this.port.contact(peer)) return;
        if (room.keys[peer] && room.keys[peer] !== frame.packet || !await validateJoinKey(room, peer, frame.packet)) return;
        if (room.mls) {
          // A returning participant can still have its original join key after
          // the creator has cached a previous sync from that participant.
          void this.hello(room, peer, true);
          return;
        }
        const next = { ...room, keys:{ ...room.keys, [peer]:frame.packet } };
        if (room.members.every(member => member === this.port.self || next.keys[member])) {
          const established = { ...next, ...await establishGroup(next, this.port.identity), keys:{} };
          await this.save(established);
          for (const member of room.members) if (member !== this.port.self) void this.hello(established, member);
        } else await this.save(next);
        return;
      }
      if (frame.type === 'welcome') {
        if (room.mls || !room.draft || peer !== room.owner || !this.port.contact(peer)) return;
        let joined: GroupRoom;
        try {
          joined = { ...room, mls:await acceptGroupWelcome(room, frame.packet), draft:undefined };
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
        void this.reply(room, peer, frame.known);
        return;
      }
      if (frame.type === 'ack') { await this.acknowledge(room, peer, [frame.hash]); return; }
      const hash = await groupPacketHash(frame.packet);
      const known = room.entries.find(entry => entry.hash === hash);
      if (known) {
        if (known.from !== this.port.self) void this.deliver(known.from, { type:'ack', group:room.id, hash });
        return;
      }
      const { mls, entry } = await decryptGroupPost(room, frame.packet, hash);
      if (entry.from === this.port.self || room.entries.some(item => item.id === entry.id)) return;
      const next = { ...room, mls, entries:[...room.entries, entry].slice(-GROUP_HISTORY), activityAt:Date.now() };
      await this.save(next);
      void this.deliver(entry.from, { type:'ack', group:room.id, hash });
      this.relay(next, entry.packet, peer);
    }).catch(() => {
      // A replay, malformed MLS packet or closed account never changes the room.
    });
  }
}
