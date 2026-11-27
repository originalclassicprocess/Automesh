import { expect, it } from 'vitest';
import { encodeAccountId } from '$lib/addressing/bech32m';
import { groupActionToken, groupPins, retainGroupActions, trimGroupHistory, type GroupAction } from './actions';
import { GROUP_ACTION_HISTORY, GROUP_HISTORY, GROUP_PACKET_BYTES, GROUP_PREFIX, MAX_GROUP_MEMBERS, parseGroupFrame } from './protocol';
import type { GroupEntry, GroupRoom } from './storage';

it('keeps one pin per member and honors removals when packets arrive out of order', () => {
  const members = Array.from({ length:MAX_GROUP_MEMBERS }, (_, i) => encodeAccountId(new Uint8Array(20).fill(i)));
  const post = (from: string, n: number, action?: GroupAction): GroupEntry => ({
    id:crypto.randomUUID(), from, text:action ? '' : String(n), hash:n.toString(16).padStart(64, '0'),
    packet:'AAAA', audience:members, sentAt:n + 1, ...(action ? { action } : {}),
  });
  const entries = Array.from({ length:GROUP_HISTORY + 25 }, (_, i) => post(members[0], i));
  const room: GroupRoom = { id:crypto.randomUUID(), title:'Group', owner:members[0], members, keys:{}, entries };
  const pins = members.map((actor, i) => post(actor, i, { kind:'pin', revision:1, targetId:entries[i].id }));
  const replacement = post(members[0], 12, { kind:'pin', revision:2, targetId:entries[12].id });
  room.actions = retainGroupActions(room, [replacement, ...pins]);
  expect(groupPins(room)).toHaveLength(MAX_GROUP_MEMBERS);
  expect(groupPins(room).find(pin => pin.actor === members[0])?.targetId).toBe(entries[12].id);
  const retained = trimGroupHistory(room, entries);
  expect(retained).toHaveLength(GROUP_HISTORY);
  expect(groupPins(room).every(pin => retained.some(entry => entry.id === pin.targetId))).toBe(true);
  const removal = post(members[0], 13, { kind:'pin', revision:3, targetId:null });
  room.actions = retainGroupActions(room, [removal, ...room.actions]);
  expect(groupPins(room)).toHaveLength(MAX_GROUP_MEMBERS - 1);
  expect(groupPins(room).some(pin => pin.actor === members[0])).toBe(false);
});

it('fits a full group action inventory and a full message inventory in the existing sync frame limit', () => {
  const accounts = Array.from({ length:MAX_GROUP_MEMBERS }, (_, i) => encodeAccountId(new Uint8Array(20).fill(i)));
  const digests = Array.from({ length:GROUP_ACTION_HISTORY }, (_, i) => i.toString(16).padStart(24, '0') + 'a'.repeat(40));
  const frame = { type:'sync', group:crypto.randomUUID(), epoch:1, requestEpoch:true,
    hasWelcome:true, known:digests.slice(0,GROUP_HISTORY), seen:Array(GROUP_HISTORY).fill(2 ** (MAX_GROUP_MEMBERS * 2) - 1),
    actionKnown:digests.map(groupActionToken).join(''),
    profiles:accounts.map(by => ({ by, revision:Date.now(), nickname:'名'.repeat(32), publicKey:'A'.repeat(88), signature:'A'.repeat(88) })),
  };
  expect(new TextEncoder().encode(GROUP_PREFIX + JSON.stringify(frame)).length).toBeLessThanOrEqual(GROUP_PACKET_BYTES);
  expect(parseGroupFrame(frame)).toEqual(frame);
});
