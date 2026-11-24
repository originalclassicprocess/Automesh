import { describe, expect, it, vi } from 'vitest';
import { encodeAccountId } from '$lib/addressing/bech32m.js';
import { accountIdFromPublicKey } from '$lib/addressing/account-id.js';
import { WebCryptoIdentity } from '$lib/identity/webcrypto';
import { GroupController } from './GroupController';
import { type GroupFrame, groupMembers, parseGroupFrame } from './protocol';
import { restoreGroups, type GroupRooms } from './storage';

describe('experimental closed MLS groups', () => {
  it('rejects an eleventh member and duplicates at the protocol boundary', () => {
    const members = Array.from({ length:11 }, (_, i) => encodeAccountId(new Uint8Array(20).fill(i)));
    const group = crypto.randomUUID();
    expect(groupMembers(members.slice(0, 10))).toBe(true);
    expect(parseGroupFrame({ type:'invite', group, title:'Test', members })).toBeNull();
    expect(parseGroupFrame({ type:'invite', group, title:'Test', members:[members[0], members[0]] })).toBeNull();
  });

  it('establishes MLS on three peers and restores a missed encrypted message from the other participant', async () => {
    const ids = await Promise.all([1, 2, 3].map(async value => {
      const identity = new WebCryptoIdentity();
      const { publicKey } = await identity.fromSeed(new Uint8Array(32).fill(value));
      return { identity, id:await accountIdFromPublicKey(publicKey) };
    }));
    const offline = new Set<string>();
    const waitingForWelcome = new Set<string>();
    const traces: { from:string; to:string; frame:GroupFrame }[] = [];
    const peers = new Map<string, GroupController>();
    const saved = new Map<string, GroupRooms>();
    for (const { id, identity } of ids) peers.set(id, new GroupController({
      self:id, identity, active:() => !offline.has(id), contact:peer => ids.some(entry => entry.id === peer),
      allowed:() => true, rooms:() => saved.get(id) ?? [],
      save:async rooms => { saved.set(id, restoreGroups(JSON.parse(JSON.stringify(rooms)))); },
      transport:{
        ready:peer => !offline.has(peer),
        send:async (to, frame) => {
          if (offline.has(to)) throw new Error('unreachable');
          traces.push({ from:id, to, frame });
          if (frame.type === 'welcome' && waitingForWelcome.has(to)) return;
          await peers.get(to)?.receive(id, frame);
        },
      },
    }));
    const [a, b, c] = ids.map(device => device.id);
    waitingForWelcome.add(c);
    const room = await peers.get(a)!.create('Private group', [b, c]);
    await vi.waitFor(() => expect(saved.get(c)?.[0]?.id).toBe(room), { timeout:5000 });
    await peers.get(b)!.accept(room);
    await peers.get(c)!.accept(room);
    const pending = saved.get(c)!;
    expect(pending[0].draft).toBeTruthy();
    await vi.waitFor(() => expect(saved.get(b)?.[0]?.mls).toBeTruthy());
    expect(saved.get(c)?.[0]?.mls).toBeUndefined();
    waitingForWelcome.delete(c);
    peers.get(c)!.peerOnline(a);
    await vi.waitFor(() => {
      for (const id of [a, b, c]) expect(saved.get(id)?.[0]?.mls).toBeTruthy();
    }, { timeout:10000 });
    // A restored browser snapshot can contain the original pending join.
    // The creator already saw a sync from C and must send the Welcome again.
    await peers.get(a)!.receive(c, { type:'sync', group:room, known:[] });
    saved.set(c, pending);
    peers.get(c)!.peerOnline(a);
    await vi.waitFor(() => expect(saved.get(c)?.[0]?.mls).toBeTruthy());
    offline.add(c);
    await peers.get(a)!.send(room, 'The author will be offline.');
    await vi.waitFor(() => expect(saved.get(b)?.[0]?.entries).toHaveLength(1));
    await vi.waitFor(() => expect(saved.get(a)?.[0]?.entries[0].receivedBy).toEqual([b]));
    expect(saved.get(c)?.[0]?.entries).toHaveLength(0);
    offline.add(a);
    offline.delete(c);
    peers.get(c)!.peerOnline(b);
    await vi.waitFor(() => expect(saved.get(c)?.[0]?.entries).toHaveLength(1));
    const entry = saved.get(c)![0].entries[0];
    expect(entry).toMatchObject({ from:a, text:'The author will be offline.' });
    expect(traces.find(trace => trace.from === b && trace.to === c && trace.frame.type === 'message')?.frame)
      .toMatchObject({ packet:entry.packet });
    expect(JSON.stringify(traces)).not.toContain(entry.text);
    await peers.get(c)!.receive(b, { type:'message', group:room, packet:entry.packet });
    expect(saved.get(c)?.[0]?.entries).toHaveLength(1);
  }, 20000);
});
