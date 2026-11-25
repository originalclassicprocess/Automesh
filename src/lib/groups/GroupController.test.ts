import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { encodeAccountId } from '$lib/addressing/bech32m.js';
import { accountIdFromPublicKey } from '$lib/addressing/account-id.js';
import { WebCryptoIdentity } from '$lib/identity/webcrypto';
import { GroupController } from './GroupController';
import { decryptGroupPost, groupPacketHash } from './mls';
import { type GroupFrame, groupMembers, parseGroupFrame } from './protocol';
import { epochOf, groupVisible, restoreGroups, type GroupRooms } from './storage';

describe('experimental closed MLS groups', () => {
  it('rejects an eleventh member and duplicates at the protocol boundary', () => {
    const members = Array.from({ length:11 }, (_, i) => encodeAccountId(new Uint8Array(20).fill(i)));
    const group = crypto.randomUUID();
    expect(groupMembers(members.slice(0, 10))).toBe(true);
    expect(parseGroupFrame({ type:'invite', group, title:'Test', members })).toBeNull();
    expect(parseGroupFrame({ type:'invite', group, title:'Test', members:[members[0], members[0]] })).toBeNull();
  });

  it('repairs missed welcomes and exchanges messages and signed read receipts in a five-member group without its owner', async () => {
    const importKey = crypto.subtle.importKey.bind(crypto.subtle);
    const appleImport = vi.spyOn(crypto.subtle, 'importKey').mockImplementation((...args) => {
      const [format, data, algorithm] = args;
      if (format === 'pkcs8' && typeof algorithm !== 'string' && algorithm.name === 'ECDH' &&
        'byteLength' in data && data.byteLength < 130) return Promise.reject(new DOMException('Missing SEC1 public key', 'DataError'));
      return importKey(...args);
    });
    onTestFinished(() => appleImport.mockRestore());
    const ids = await Promise.all([1, 2, 3, 4, 5].map(async value => {
      const identity = new WebCryptoIdentity();
      const { publicKey } = await identity.fromSeed(new Uint8Array(32).fill(value));
      return { identity, id:await accountIdFromPublicKey(publicKey) };
    }));
    const offline = new Set<string>();
    const waitingForWelcome = new Set<string>();
    const privateReads = new Set<string>();
    const traces: { from:string; to:string; frame:GroupFrame }[] = [];
    const peers = new Map<string, GroupController>();
    const saved = new Map<string, GroupRooms>();
    const [a, b, c, d, e] = ids.map(device => device.id);
    // Before admission the invitees need only the creator as a contact.
    // After the creator leaves every surviving route runs through B.
    const ready = (from: string, to: string) => !offline.has(from) && !offline.has(to) &&
      (!offline.has(a) || from === b || to === b);
    for (const { id, identity } of ids) peers.set(id, new GroupController({
      self:id, identity, active:() => !offline.has(id), contact:peer => id === a || peer === a,
      readsEnabled:() => !privateReads.has(id),
      allowed:() => true, rooms:() => saved.get(id) ?? [],
      save:async rooms => { saved.set(id, restoreGroups(JSON.parse(JSON.stringify(rooms)))); },
      transport:{
        ready:peer => ready(id, peer),
        send:async (to, frame) => {
          if (!ready(id, to)) throw new Error('unreachable');
          traces.push({ from:id, to, frame });
          if ((frame.type === 'welcome' || frame.type === 'welcome-proof') && waitingForWelcome.has(to)) return;
          await peers.get(to)?.receive(id, frame);
        },
      },
    }));
    waitingForWelcome.add(c);
    waitingForWelcome.add(e);
    const members = [a, b, c, d, e];
    const room = await peers.get(a)!.create('Private group', members.slice(1));
    await vi.waitFor(() => { for (const peer of members) expect(saved.get(peer)?.[0]?.id).toBe(room); });
    for (const peer of members.slice(1)) await peers.get(peer)!.accept(room);
    await vi.waitFor(() => expect(saved.get(b)?.[0]?.welcomeProof).toBeTruthy());
    expect(saved.get(c)?.[0]?.draft).toBeTruthy();
    expect(saved.get(c)?.[0]?.mls).toBeUndefined();

    // The creator in 0.5.22 kept the Welcome but never signed it for relay.
    // Participants in that release discarded the Welcome after admission.
    saved.set(a, restoreGroups([{ ...saved.get(a)![0], welcomeProof:undefined }]));
    saved.set(b, restoreGroups([{ ...saved.get(b)![0], welcome:undefined, welcomeProof:undefined }]));
    await peers.get(a)!.receive(b, { type:'sync', group:room, known:[], seen:[], hasWelcome:false });
    await vi.waitFor(() => expect(saved.get(b)?.[0]?.welcomeProof).toBeTruthy());

    offline.add(a);
    waitingForWelcome.clear();
    peers.get(c)!.peerOnline(b);
    peers.get(e)!.peerOnline(b);
    await vi.waitFor(() => {
      for (const peer of members) {
        expect(saved.get(peer)?.[0]?.mls).toBeTruthy();
        expect(saved.get(peer)?.[0]?.members).toEqual(members);
      }
    }, { timeout:5000 });

    offline.add(e);
    await peers.get(c)!.send(room, 'A message without the creator online');
    await vi.waitFor(() => expect(saved.get(d)?.[0]?.entries).toHaveLength(1));
    const entry = saved.get(d)![0].entries[0];
    expect(entry).toMatchObject({ from:c, text:'A message without the creator online' });
    expect(saved.get(e)?.[0]?.entries).toHaveLength(0);
    expect(JSON.stringify(traces)).not.toContain(entry.text);
    privateReads.add(d);
    await peers.get(d)!.markRead(room, [entry.hash]);
    expect(saved.get(d)?.[0]?.entries[0].receipts?.find(receipt => receipt.by === d)?.state).toBe('received');
    const received = saved.get(d)![0].entries[0].receipts!.find(receipt => receipt.by === d)!;
    await peers.get(b)!.receive(d, { type:'receipts', group:room, receipts:[{ ...received, state:'read' }] });
    expect(saved.get(b)?.[0]?.entries[0].receipts?.some(receipt => receipt.by === d && receipt.state === 'read')).toBe(false);
    await peers.get(b)!.markRead(room, [entry.hash]);

    offline.delete(e);
    peers.get(e)!.peerOnline(b);
    await vi.waitFor(() => expect(saved.get(e)?.[0]?.entries[0].receipts?.some(receipt => receipt.by === b && receipt.state === 'read')).toBe(true));
    await peers.get(e)!.markRead(room, [entry.hash]);
    await vi.waitFor(() => {
      for (const peer of members.slice(1)) {
        const proofs = saved.get(peer)![0].entries[0].receipts!;
        expect(proofs.map(proof => proof.by).sort()).toEqual([b, d, e].sort());
        expect(proofs.filter(proof => proof.state === 'read').map(proof => proof.by).sort()).toEqual([b, e].sort());
      }
    });
    await peers.get(e)!.receive(b, { type:'message', group:room, packet:entry.packet });
    expect(saved.get(e)?.[0]?.entries).toHaveLength(1);

    offline.delete(a);
    peers.get(a)!.peerOnline(b);
    await vi.waitFor(() => {
      for (const peer of members) {
        const proofs = saved.get(peer)![0].entries[0]?.receipts ?? [];
        expect(proofs.map(proof => proof.by).sort()).toEqual([a, b, d, e].sort());
        expect(proofs.filter(proof => proof.state === 'read').map(proof => proof.by).sort()).toEqual([b, e].sort());
      }
    });
  }, 20000);

  it('adds and removes members through MLS, recovers a missed commit, and hands over administration', async () => {
    const importKey = crypto.subtle.importKey.bind(crypto.subtle);
    const appleImport = vi.spyOn(crypto.subtle, 'importKey').mockImplementation((...args) => {
      const [format, data, algorithm] = args;
      if (format === 'pkcs8' && typeof algorithm !== 'string' && algorithm.name === 'ECDH' &&
        'byteLength' in data && data.byteLength < 130) return Promise.reject(new DOMException('Missing SEC1 public key', 'DataError'));
      return importKey(...args);
    });
    onTestFinished(() => appleImport.mockRestore());
    const devices = await Promise.all([11, 12, 13, 14, 15].map(async value => {
      const identity = new WebCryptoIdentity();
      const { publicKey } = await identity.fromSeed(new Uint8Array(32).fill(value));
      return { identity, id:await accountIdFromPublicKey(publicKey) };
    }));
    const [a, b, c, d, e] = devices.map(device => device.id);
    const saved = new Map<string, GroupRooms>();
    const peers = new Map<string, GroupController>();
    const offline = new Set<string>();
    const missedCommit = new Set<string>();
    const missedInitialWelcome = new Set<string>();
    let failCommit = false, commitInterrupted = false;
    const traces: { from:string; to:string; frame:GroupFrame }[] = [];
    const ready = (from: string, to: string) => !offline.has(from) && !offline.has(to);
    const room = (id: string) => saved.get(id)![0];
    function controller(id: string) {
      const identity = devices.find(device => device.id === id)!.identity;
      return new GroupController({
        self:id, identity, active:() => !offline.has(id),
        contact:() => true, allowed:() => true, readsEnabled:() => true,
        rooms:() => saved.get(id) ?? [],
        save:async rooms => {
          if (id === a && failCommit && epochOf(rooms[0]) === 3) {
            commitInterrupted = true;
            throw new Error('Interrupted before saving the commit');
          }
          saved.set(id, restoreGroups(JSON.parse(JSON.stringify(rooms))));
        },
        transport:{ ready:peer => ready(id, peer), send:async (to, frame) => {
          if (!ready(id, to)) throw new Error('unreachable');
          traces.push({ from:id, to, frame });
          if (frame.type === 'group-commit' && missedCommit.has(to)) return;
          if ((frame.type === 'welcome' || frame.type === 'welcome-proof') && missedInitialWelcome.has(to)) return;
          await peers.get(to)!.receive(id, frame);
        } },
      });
    }
    for (const { id } of devices) peers.set(id, controller(id));
    const at = (peer: string) => peers.get(peer)!;
    const group = await at(a).create('Private group', [b, c]);
    const wait = (assertion: () => void) => vi.waitFor(assertion, { timeout:10000 });
    const roster = (members: string[], epoch: number) => wait(() => {
      for (const peer of members) {
        expect(room(peer).mls).toBeTruthy();
        expect(room(peer).members).toEqual(members);
        expect(epochOf(room(peer))).toBe(epoch);
      }
    });
    await wait(() => { expect(room(b).id).toBe(group); expect(room(c).id).toBe(group); });
    await at(b).accept(group);
    missedInitialWelcome.add(c);
    await at(c).accept(group);
    await wait(() => { expect(room(a).mls).toBeTruthy(); expect(room(b).mls).toBeTruthy(); });
    expect(room(c).mls).toBeUndefined();
    await at(b).send(group, 'Before the invitation');
    await wait(() => expect(room(a).entries).toHaveLength(1));

    await at(a).invite(group, d);
    await wait(() => expect(room(d).offer?.target).toBe(d));
    expect(room(a).members).toEqual([a,b,c]);
    missedCommit.add(d);
    offline.add(c);
    await at(d).accept(group);
    await wait(() => {
      for (const peer of [a,b]) expect(room(peer).members).toEqual([a,b,c,d]);
    });
    expect(room(d).mls).toBeUndefined();
    offline.add(a);
    missedCommit.delete(d);
    // A current member can relay the signed transition and the new member's encrypted Welcome.
    at(b).peerOnline(d);
    await wait(() => expect(room(d).mls).toBeTruthy());
    offline.delete(c);
    missedInitialWelcome.delete(c);
    at(b).peerOnline(c);
    await roster([a,b,c,d], 2);
    expect(room(d).entries).toHaveLength(0);
    expect(room(b).entries[0].audience).toEqual([a,b,c]);
    await at(d).send(group, 'Joined while the owner is offline');
    await wait(() => expect(room(c).entries.at(-1)?.from).toBe(d));

    offline.delete(a);
    offline.add(b);
    offline.add(c);
    const revokedState = room(b);
    failCommit = true;
    await expect(at(a).exclude(group, b)).rejects.toThrow('Interrupted before saving the commit');
    expect(commitInterrupted).toBe(true);
    expect(room(a).plan?.target).toBe(b);
    expect(room(d).plan).toBeUndefined();

    // A plan saved by an older version resumes even while C stays offline.
    failCommit = false;
    peers.set(a, controller(a));
    await at(a).resumeMembership();
    await wait(() => {
      expect(room(a).members).toEqual([a,c,d]);
      expect(epochOf(room(d))).toBe(3);
    });
    expect(epochOf(room(c))).toBe(2);
    expect(room(a).entries[0].audience).toEqual([a,b,c]);
    await at(a).send(group, 'After the removal');
    await wait(() => expect(room(d).entries.some(entry => entry.text === 'After the removal')).toBe(true));
    const newPost = room(a).entries.at(-1)!;
    await expect(decryptGroupPost({ ...revokedState, epoch:3 }, newPost.packet, await groupPacketHash(newPost.packet))).rejects.toThrow();

    offline.delete(c);
    missedCommit.add(c);
    at(c).peerOnline(d);
    await wait(() => expect(room(c).plan?.target).toBe(b));
    expect(traces.some(({ to, frame }) => to === c && frame.type === 'message' && frame.packet === newPost.packet)).toBe(false);
    missedCommit.delete(c);
    at(c).peerOnline(d);
    await roster([a,c,d], 3);
    await wait(() => expect(room(c).entries.some(entry => entry.text === 'After the removal')).toBe(true));
    const firstPlan = traces.find(({ frame }) => frame.type === 'group-plan' && frame.epoch === 2)!.frame;
    await at(c).receive(d, firstPlan);
    expect(epochOf(room(c))).toBe(3);
    expect(room(c).plan).toBeUndefined();

    offline.delete(b);
    at(b).peerOnline(c);
    await wait(() => expect(room(b).departed).toBe(b));
    expect(room(b).mls).toBeUndefined();
    expect(groupVisible(room(b))).toBe(false);

    offline.add(a);
    await at(d).leave(group);
    expect(groupVisible(room(d))).toBe(false);
    expect(room(d).leaving?.by).toBe(d);
    await wait(() => expect(room(c).leaves?.some(leave => leave.by === d)).toBe(true));
    offline.add(c);
    offline.delete(a);
    at(d).peerOnline(a);
    await wait(() => {
      expect(epochOf(room(a))).toBe(4);
      expect(room(a).members).toEqual([a,c]);
    });
    expect(epochOf(room(c))).toBe(3);
    await wait(() => expect(room(d).departed).toBe(d));
    offline.delete(c);
    at(c).peerOnline(a);
    await roster([a,c], 4);

    await at(a).invite(group, b);
    await wait(() => expect(room(b).offer?.target).toBe(b));
    await at(b).accept(group);
    await roster([a,c,b], 5);
    expect(room(b).entries.some(entry => entry.text === 'After the removal')).toBe(false);
    offline.add(b);
    await at(a).leave(group, c);
    await wait(() => expect(epochOf(room(c))).toBe(6));
    expect(epochOf(room(b))).toBe(5);
    offline.delete(b);
    at(b).peerOnline(c);
    await roster([c,b], 6);
    expect(room(c).owner).toBe(c);
    expect(room(b).owner).toBe(c);
    await wait(() => expect(room(a).departed).toBe(a));
    offline.add(a);
    await at(c).send(group, 'The remaining members can still talk');
    await wait(() => expect(room(b).entries.some(entry => entry.text === 'The remaining members can still talk')).toBe(true));

    // B misses two changes and reconnects after the visible roster has
    // returned to the same members. It still needs both signed Commits.
    offline.add(b);
    at(c).peerOffline(b);
    await at(c).invite(group, e);
    await wait(() => expect(room(e).offer?.target).toBe(e));
    await at(e).accept(group);
    await wait(() => {
      expect(epochOf(room(c))).toBe(7);
      expect(epochOf(room(e))).toBe(7);
    });
    await at(e).leave(group);
    await wait(() => {
      expect(epochOf(room(c))).toBe(8);
      expect(room(e).departed).toBe(e);
    });
    expect(epochOf(room(b))).toBe(6);
    const reconnect = traces.length;
    offline.delete(b);
    at(b).peerOnline(c);
    await roster([c,b], 8);
    const replayed = traces.slice(reconnect).flatMap(({ from, to, frame }) =>
      from === c && to === b && frame.type === 'group-commit' ? [frame.epoch] : []);
    expect([...new Set(replayed)]).toEqual([6,7]);
    await at(b).send(group, 'Caught up on both membership changes');
    await wait(() => expect(room(c).entries.some(entry => entry.text === 'Caught up on both membership changes')).toBe(true));
  }, 40000);

});
