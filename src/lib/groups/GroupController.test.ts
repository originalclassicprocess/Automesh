import { describe, expect, it, onTestFinished, vi } from 'vitest';
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
});
