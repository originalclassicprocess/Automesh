import type { IdentityProvider } from '$lib/identity/identity';
import { acceptGroupWelcome, applyGroupChange, createGroupChange, signMembership, validateJoinKey, verifyMembership } from './mls';
import { GROUP_CHANGE_HISTORY, MAX_GROUPS, MAX_GROUP_MEMBERS, parseGroupFrame,
  type GroupCommit, type GroupLeave, type GroupOffer, type GroupPlan, type MembershipFrame } from './protocol';
import { epochOf, groupAudience, groupPeers, type GroupRoom, type GroupRooms } from './storage';

type MembershipPort = {
  self: string;
  identity: IdentityProvider;
  contact(peer: string): boolean;
  allowed(peer: string): boolean;
  rooms(): GroupRooms;
  save(room: GroupRoom, forget?: boolean): Promise<void>;
  deliver(peer: string, frame: MembershipFrame): Promise<void>;
  changed(room: GroupRoom): void;
};

const matches = (a: { change: string; epoch: number }, b?: { change: string; epoch: number }) =>
  a.change === b?.change && a.epoch === b.epoch;
const sameMembers = (a: string[], b: string[]) => a.length === b.length && a.every((peer, i) => peer === b[i]);

// All mutations share the controller's serial queue with application messages.
export class GroupMembership {
  constructor(private readonly port: MembershipPort) {}

  private relay(room: GroupRoom, frame: MembershipFrame, skip?: string) {
    for (const peer of groupPeers(room, this.port.self)) if (peer !== skip) void this.port.deliver(peer, frame);
  }

  async invite(room: GroupRoom, target: string) {
    const { self, identity } = this.port;
    if (!room.mls || room.owner !== self || room.plan || room.leaving || room.members.includes(target) ||
      !this.port.contact(target) || !this.port.allowed(target) || room.members.length >= MAX_GROUP_MEMBERS)
      throw new Error('group_invite_unavailable');
    const offer = await signMembership({ type:'group-offer', group:room.id, epoch:epochOf(room), change:crypto.randomUUID(),
      owner:self, target, title:room.title, members:[...room.members, target] }, identity);
    await this.port.save({ ...room, offer });
    void this.port.deliver(target, offer);
  }

  async exclude(room: GroupRoom, target: string) {
    if (!room.mls || room.owner !== this.port.self || room.plan || room.leaving || target === room.owner || !room.members.includes(target))
      throw new Error('group_change_unavailable');
    await this.start(room, target, room.owner);
  }

  async leave(room: GroupRoom, successor?: string, forget = false) {
    const { self, identity } = this.port;
    if (room.departed || room.leaving || !room.members.includes(self)) throw new Error('group_change_unavailable');
    if (forget) room = { ...room, entries:[], actions:undefined };
    if (!room.mls) {
      if (room.owner === self && !forget) throw new Error('group_change_unavailable');
      await this.port.save({ ...room, departed:self, draft:undefined, plan:undefined, keys:{}, offer:undefined }, forget);
      return;
    }
    const leaving = await signMembership({ type:'group-leave', group:room.id, epoch:epochOf(room), by:self }, identity);
    if (room.owner === self) {
      if (room.plan) throw new Error('group_change_unavailable');
      if (room.members.length === 1) {
        await this.port.save({ ...room, departed:self, mls:undefined, welcome:undefined, welcomeProof:undefined, offer:undefined }, forget);
      } else {
        if (!successor || successor === self || !room.members.includes(successor) || !this.port.allowed(successor))
          throw new Error('group_successor_required');
        await this.start({ ...room, leaving }, self, successor, undefined, undefined, forget);
      }
    } else {
      await this.port.save({ ...room, leaving }, forget);
      this.relay(room, leaving);
    }
  }

  private async start(room: GroupRoom, target: string, nextOwner: string, key?: string, offer?: GroupOffer, forget = false) {
    const plan = await signMembership({ type:'group-plan', group:room.id, epoch:epochOf(room),
      change:offer?.change ?? crypto.randomUUID(), owner:room.owner, target, nextOwner, key,
      members:offer?.members ?? room.members.filter(peer => peer !== target) }, this.port.identity);
    this.checkReplayWindow(room, plan);
    if (key) {
      await this.commit(room, plan);
      return;
    }
    // Persist the authorized operation before trying the Commit. A restart can
    // finish it without depending on any of the recipients' availability.
    const next = { ...room, plan, offer:undefined };
    await this.port.save(next, forget);
    if (nextOwner === this.port.self) await this.resume(next);
    else void this.port.deliver(nextOwner, plan);
  }

  async resume(room: GroupRoom) {
    const { self } = this.port, plan = room.plan;
    if (!room.mls || room.departed) return;
    if (!plan) {
      const request = room.leaves?.find(leave => leave.epoch === epochOf(room) && leave.by !== self && room.members.includes(leave.by));
      if (request && room.owner === self && !room.leaving) await this.start(room, request.by, self);
      return;
    }
    if (plan.key || self !== plan.nextOwner) return;
    await this.commit(room, plan);
  }

  private checkReplayWindow(room: GroupRoom, plan: GroupPlan) {
    const first = room.changes?.length === GROUP_CHANGE_HISTORY ? room.changes[0].plan.epoch : undefined;
    if (first !== undefined && plan.members.some(peer => peer !== this.port.self &&
      room.members.includes(peer) && (room.memberEpochs?.[peer] ?? 1) <= first)) {
      throw new Error('group_change_history_pending');
    }
  }

  private async commit(room: GroupRoom, plan: GroupPlan) {
    this.checkReplayWindow(room, plan);
    const { mls, packet, welcome } = await createGroupChange(room, plan);
    const commit = await signMembership({ type:'group-commit', group:room.id, epoch:plan.epoch, change:plan.change, packet, welcome }, this.port.identity);
    if (!parseGroupFrame(commit)) throw new Error('group_commit_too_large');
    await this.complete(room, plan, commit, mls);
  }

  private async complete(room: GroupRoom, plan: GroupPlan, commit: GroupCommit, mls?: string) {
    const previous = room.mls ? room.members : room.members.filter(peer => peer !== plan.target);
    const removed = !plan.members.includes(this.port.self);
    const epoch = plan.epoch + 1;
    const leaving = !removed && room.leaving ? await signMembership({
      type:'group-leave', group:room.id, epoch, by:this.port.self,
    }, this.port.identity) : undefined;
    const next = { ...room, mls, epoch, owner:plan.nextOwner, members:plan.members, leaving,
      departed:removed ? this.port.self : undefined, offer:undefined, draft:undefined, keys:{}, plan:undefined,
      memberEpochs:Object.fromEntries(plan.members.map(peer => [
        peer, peer === this.port.self ? epoch : peer === plan.target ? plan.epoch : room.memberEpochs?.[peer] ?? 1,
      ])),
      welcome:removed || !room.welcomeProof ? undefined : room.welcome,
      welcomeProof:removed ? undefined : room.welcomeProof, leaves:undefined,
      entries:room.entries.map(entry => ({ ...entry, audience:groupAudience(room, entry) })),
      actions:room.actions?.filter(entry => entry.action?.kind !== 'pin' || plan.members.includes(entry.from)),
      changes:[...(room.changes ?? []), { plan, commit, previous }].slice(-GROUP_CHANGE_HISTORY) };
    await this.port.save(next);
    if (removed) return;
    for (const peer of new Set([...previous, ...next.members])) {
      if (peer !== this.port.self) void this.sendChange(peer, plan, commit);
    }
    if (leaving) this.relay(next, leaving);
    this.port.changed(next);
  }

  private async sendChange(peer: string, plan: GroupPlan, commit: GroupCommit) {
    await this.port.deliver(peer, plan);
    await this.port.deliver(peer, commit);
  }

  async sync(room: GroupRoom, peer: string, knownEpoch = 0) {
    if (room.departed) return;
    for (const { plan, commit, previous } of room.changes ?? []) {
      if (plan.epoch >= knownEpoch && (previous.includes(peer) || plan.target === peer))
        await this.sendChange(peer, plan, commit);
    }
    if (room.owner === this.port.self && room.offer?.target === peer && !room.plan) await this.port.deliver(peer, room.offer);
    if (!room.mls && room.offer && room.draft && peer === room.owner) {
      const { group, epoch, change } = room.offer;
      await this.port.deliver(peer, { type:'group-join', group, epoch, change, packet:room.draft.packet });
    }
    if (room.plan?.nextOwner === peer) {
      if (room.owner === this.port.self) await this.port.deliver(peer, room.plan);
      else await this.acknowledgePlan(room, room.plan);
    }
    if (room.members.includes(peer)) {
      if (room.leaving && room.owner !== this.port.self) await this.port.deliver(peer, room.leaving);
      for (const leave of room.leaves ?? []) await this.port.deliver(peer, leave);
    }
  }

  async receive(room: GroupRoom | undefined, peer: string, frame: MembershipFrame) {
    if (frame.type === 'group-offer') {
      await this.receiveOffer(room, peer, frame);
      return;
    }
    if (!room || room.departed) return;
    if (frame.epoch !== epochOf(room)) {
      // A missed Welcome may still be needed by someone removed in a later epoch.
      if (frame.type === 'group-join' && room.changes?.some(({ plan }) =>
        plan.target === peer && plan.key === frame.packet && matches(frame, plan))) void this.sync(room, peer, frame.epoch);
      return;
    }
    // Signed plans and commits can be relayed by a peer whose roster is already newer.
    if (frame.type !== 'group-plan' && frame.type !== 'group-commit' &&
      !room.members.includes(peer) && room.offer?.target !== peer) return;
    switch (frame.type) {
      case 'group-join':
        if (!room.mls || room.owner !== this.port.self || room.plan || !matches(frame, room.offer) ||
          room.offer?.target !== peer || !await validateJoinKey({ ...room, members:room.offer.members }, peer, frame.packet)) return;
        await this.start(room, peer, room.owner, frame.packet, room.offer);
        break;
      case 'group-plan':
        await this.receivePlan(room, frame);
        break;
      case 'group-ready':
        break; // Older clients may still send this acknowledgement.
      case 'group-commit': {
        const plan = room.plan;
        if (!plan || !matches(frame, plan) || !!frame.welcome !== !!plan.key || !await verifyMembership(frame, plan.nextOwner)) return;
        const mls = room.mls ? await applyGroupChange(room, plan, frame)
          : frame.welcome && await acceptGroupWelcome({ ...room, members:plan.members, epoch:plan.epoch + 1 }, frame.welcome);
        if (!!mls !== plan.members.includes(this.port.self)) return;
        await this.complete(room, plan, frame, mls);
        break;
      }
      case 'group-leave': {
        if (!room.mls || frame.by === room.owner || !room.members.includes(frame.by) ||
          room.leaves?.some(leave => leave.by === frame.by) || !await verifyMembership(frame, frame.by)) return;
        const next = { ...room, leaves:[...(room.leaves ?? []), frame] };
        await this.port.save(next);
        this.relay(room, frame, peer);
        await this.resume(next);
        break;
      }
    }
  }

  private async receiveOffer(room: GroupRoom | undefined, peer: string, offer: GroupOffer) {
    const { self } = this.port;
    if (offer.target !== self || offer.owner !== peer || !this.port.contact(peer) ||
      room?.mls || room?.plan || room?.departed && offer.epoch < epochOf(room) ||
      room && !room.departed && (!room.offer || room.offer.owner !== peer || offer.epoch < epochOf(room)) ||
      matches(offer, room?.offer) || !await verifyMembership(offer, offer.owner)) return;
    if ((!room || room.departed) && this.port.rooms().filter(item => !item.departed).length >= MAX_GROUPS) return;
    await this.port.save({ id:offer.group, title:offer.title, owner:offer.owner, members:offer.members, offer,
      epoch:offer.epoch, keys:{}, entries:room?.entries ?? [], activityAt:Date.now() });
  }

  private async receivePlan(room: GroupRoom, plan: GroupPlan) {
    if (room.plan) {
      if (matches(plan, room.plan)) await this.resume(room);
      return;
    }
    if (plan.owner !== room.owner || !await verifyMembership(plan, room.owner)) return;
    if (!room.mls) {
      if (!room.offer || !room.draft || plan.target !== this.port.self || !matches(plan, room.offer) ||
        plan.key !== room.draft.packet || plan.nextOwner !== room.owner || !sameMembers(plan.members, room.offer.members)) return;
    } else if (plan.key) {
      if (room.members.includes(plan.target) || plan.nextOwner !== room.owner ||
        !sameMembers(plan.members, [...room.members, plan.target]) ||
        !await validateJoinKey({ ...room, members:plan.members }, plan.target, plan.key)) return;
    } else if (!room.members.includes(plan.target) || !sameMembers(plan.members, room.members.filter(id => id !== plan.target)) ||
      (plan.target === room.owner ? !plan.members.includes(plan.nextOwner) : plan.nextOwner !== room.owner)) return;
    if (plan.nextOwner === this.port.self) this.checkReplayWindow(room, plan);
    const next = { ...room, plan, offer:plan.key ? room.offer : undefined };
    await this.port.save(next);
    if (plan.nextOwner === this.port.self) await this.resume(next);
    else await this.acknowledgePlan(next, plan);
  }

  private async acknowledgePlan(room: GroupRoom, plan: GroupPlan) {
    if (plan.key || !room.mls || !plan.members.includes(this.port.self)) return;
    // A 0.5.24 coordinator can still finish its already-announced plan.
    // This device holds old-epoch traffic until it has the corresponding Commit.
    const ready = await signMembership({ type:'group-ready', group:room.id, epoch:plan.epoch,
      change:plan.change, by:this.port.self }, this.port.identity);
    await this.port.deliver(plan.nextOwner, ready);
  }
}
