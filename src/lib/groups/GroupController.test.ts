import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { encodeAccountId } from '$lib/addressing/bech32m.js';
import { accountIdFromPublicKey } from '$lib/addressing/account-id.js';
import { WebCryptoIdentity } from '$lib/identity/webcrypto';
import { GroupController } from './GroupController';
import { groupPins } from './actions';
import { decryptGroupPost, groupPacketHash } from './mls';
import { type GroupFrame, groupMembers, parseGroupFrame } from './protocol';
import { epochOf, groupChronology, groupEntryUnread, groupPostMentions, groupVisible, restoreGroups, type GroupRoom, type GroupRooms } from './storage';
import { FILE_CHUNK_BYTES, sha256Hex } from '$lib/chat/file-transfer';
import { GroupAttachments, groupFileStorageId } from './attachments';

describe('experimental closed MLS groups', () => {
  it('rejects an eleventh member and duplicates at the protocol boundary', () => {
    const members = Array.from({ length:11 }, (_, i) => encodeAccountId(new Uint8Array(20).fill(i)));
    const group = crypto.randomUUID();
    expect(groupMembers(members.slice(0, 10))).toBe(true);
    expect(parseGroupFrame({ type:'invite', group, title:'Test', members })).toBeNull();
    expect(parseGroupFrame({ type:'invite', group, title:'Test', members:[members[0], members[0]] })).toBeNull();
  });

  it('serves a retained attachment to its current eligible audience after an epoch change', async () => {
    const [self, eligible, removed, newcomer] = [1, 2, 3, 4].map(i => encodeAccountId(new Uint8Array(20).fill(i)));
    const id = crypto.randomUUID();
    const hash = 'b'.repeat(64), bytes = new Uint8Array([3, 2, 1]);
    const room: GroupRoom = { id:crypto.randomUUID(), title:'Attachments', owner:self, members:[self, eligible, newcomer],
      mls:'state', keys:{}, epoch:3, entries:[{ id, from:self, text:'file', hash, packet:'encrypted',
        audience:[self, eligible, removed], epoch:1, file:{ id, name:'file.bin', mime:'application/octet-stream', size:bytes.length, sha256:await sha256Hex(bytes) } }] };
    const send = vi.fn(async () => {}), read = vi.fn(async () => bytes.slice());
    const attachments = new GroupAttachments({ self, room:() => room, active:() => true, allowed:() => true,
      transport:{ ready:() => true, send }, files:{ read, write:async () => {} } });
    const request = { type:'file-request' as const, group:room.id, hash, request:crypto.randomUUID(), epoch:3 };
    attachments.receive(removed, request);
    attachments.receive(newcomer, request);
    attachments.receive(eligible, { ...request, epoch:2 });
    expect(read).not.toHaveBeenCalled();
    attachments.receive(eligible, request);
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(send).toHaveBeenCalledWith(eligible, { ...request, type:'file-part', index:0, data:'AwIB' });
    attachments.close();
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
    let delayedRecipient: string | undefined, delayedPacket: string | undefined;
    let heldPacket: string | undefined, hold: (() => Promise<void>) | undefined;
    let corruptAttachment = false;
    const traces: { from:string; to:string; frame:GroupFrame }[] = [];
    const peers = new Map<string, GroupController>();
    const saved = new Map<string, GroupRooms>();
    const files = new Map<string, Uint8Array>();
    const [a, b, c, d, e] = ids.map(device => device.id);
    const nicknames = new Map([[c, 'Первый ник']]);
    // Before admission the invitees need only the creator as a contact.
    // After the creator leaves every surviving route runs through B.
    const ready = (from: string, to: string) => !offline.has(from) && !offline.has(to) &&
      (!offline.has(a) || from === b || to === b);
    for (const { id, identity } of ids) peers.set(id, new GroupController({
      self:id, identity, active:() => !offline.has(id), contact:peer => id === a || peer === a,
      nickname:() => nicknames.get(id) ?? '',
      readsEnabled:() => !privateReads.has(id),
      allowed:() => true, rooms:() => saved.get(id) ?? [],
      save:async (rooms, file) => {
        saved.set(id, restoreGroups(JSON.parse(JSON.stringify(rooms))));
        if (file) files.set(id + groupFileStorageId(file.group, file.hash), file.bytes.slice());
      },
      files:{
        read:async (group, hash) => files.get(id + groupFileStorageId(group, hash))?.slice() ?? null,
        write:async (group, hash, bytes) => { files.set(id + groupFileStorageId(group, hash), bytes.slice()); },
      },
      transport:{
        ready:peer => ready(id, peer),
        send:async (to, frame) => {
          if (!ready(id, to)) throw new Error('unreachable');
          traces.push({ from:id, to, frame });
          if (id === b && to === d && frame.type === 'message' && frame.packet === heldPacket) await hold?.();
          if (frame.type === 'message' && to === delayedRecipient && (!delayedPacket || frame.packet === delayedPacket)) return;
          if ((frame.type === 'welcome' || frame.type === 'welcome-proof') && waitingForWelcome.has(to)) return;
          if (corruptAttachment && frame.type === 'file-part' && frame.index === 0)
            frame = { ...frame, data:(frame.data.startsWith('A') ? 'B' : 'A') + frame.data.slice(1) };
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

    // C and E have no connection to one another while the owner is offline.
    await vi.waitFor(() => expect(saved.get(e)?.[0]?.profiles?.[c]?.nickname).toBe('Первый ник'));
    const oldProfile = saved.get(e)![0].profiles![c];
    nicknames.set(c, 'Новый ник');
    peers.get(c)!.peerOnline(b);
    await vi.waitFor(() => expect(saved.get(e)?.[0]?.profiles?.[c]?.nickname).toBe('Новый ник'));
    const newProfile = saved.get(e)![0].profiles![c];
    expect(newProfile.revision).toBeGreaterThan(oldProfile.revision);
    await peers.get(e)!.receive(b, { type:'sync', group:room, epoch:1, known:[], seen:[], hasWelcome:true,
      profiles:[oldProfile, { ...newProfile, nickname:'Подмена', revision:newProfile.revision + 1 }] });
    expect(saved.get(e)?.[0]?.profiles?.[c]).toEqual(newProfile);
    nicknames.set(c, '');
    peers.get(c)!.peerOnline(b);
    await vi.waitFor(() => expect(saved.get(e)?.[0]?.profiles?.[c]?.nickname).toBe(''));

    offline.add(e);
    await peers.get(c)!.send(room, 'A message without the creator online');
    await vi.waitFor(() => expect(saved.get(d)?.[0]?.entries).toHaveLength(1));
    const entry = saved.get(d)![0].entries[0];
    expect(entry).toMatchObject({ from:c, text:'A message without the creator online' });
    expect(saved.get(e)?.[0]?.entries).toHaveLength(0);
    expect(JSON.stringify(traces)).not.toContain(entry.text);

    privateReads.add(d);
    expect(groupEntryUnread(entry, d)).toBe(true);
    await peers.get(d)!.markRead(room, [entry.hash]);
    expect(groupEntryUnread(saved.get(d)![0].entries[0], d)).toBe(false);
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

    delayedRecipient = d;
    const olderTime = Date.now() + 60_000, newerTime = olderTime + 60_000;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(olderTime);
    try { await peers.get(c)!.send(room, 'Earlier sent, later delivered'); }
    finally { clock.mockRestore(); }
    const older = saved.get(c)![0].entries.at(-1)!;
    delayedPacket = older.packet;
    const nextClock = vi.spyOn(Date, 'now').mockReturnValue(newerTime);
    try { await peers.get(b)!.send(room, 'Later sent, already read'); }
    finally { nextClock.mockRestore(); }
    await vi.waitFor(() => expect(saved.get(d)![0].entries.at(-1)?.sentAt).toBe(newerTime));
    const newer = saved.get(d)![0].entries.at(-1)!;
    await peers.get(d)!.markRead(room, [newer.hash]);
    expect(saved.get(d)![0].entries.filter(post => groupEntryUnread(post, d))).toHaveLength(0);

    const receptionTime = newerTime + 60_000;
    const receiveClock = vi.spyOn(Date, 'now').mockReturnValue(receptionTime);
    try { await peers.get(d)!.receive(b, { type:'message', group:room, packet:older.packet }); }
    finally { receiveClock.mockRestore(); }
    const caughtUp = saved.get(d)![0];
    expect(caughtUp.activityAt).toBe(receptionTime);
    const ordered = groupChronology(caughtUp.entries);
    expect(ordered.slice(-2).map(post => post.sentAt)).toEqual([olderTime, newerTime]);
    expect(ordered.filter(post => groupEntryUnread(post, d)).map(post => post.id)).toEqual([older.id]);
    expect(ordered.at(-1)?.id).toBe(newer.id);
    await peers.get(d)!.receive(b, { type:'message', group:room, packet:older.packet });
    expect(saved.get(d)![0].activityAt).toBe(receptionTime);
    expect(saved.get(d)![0].entries).toHaveLength(caughtUp.entries.length);

    const [legacy] = restoreGroups([{ ...caughtUp, entries:[{ ...newer, sentAt:undefined, unread:undefined }] }]);
    expect(legacy.entries[0].sentAt).toBeUndefined();
    expect(groupEntryUnread(legacy.entries[0], d)).toBe(false);

    await expect(peers.get(d)!.send(room, 'Invalid reply', crypto.randomUUID())).rejects.toThrow('group_reply_unavailable');
    const skewed = vi.spyOn(Date, 'now').mockReturnValue(entry.sentAt! - 60_000);
    let replyId: string;
    try { replyId = await peers.get(d)!.send(room, 'A reply to the original', entry.id); }
    finally { skewed.mockRestore(); }
    await vi.waitFor(() => {
      const posts = saved.get(c)![0].entries;
      expect(posts.find(message => message.id === replyId))
        .toMatchObject({ from:d, replyTo:entry.id, sentAt:entry.sentAt! - 60_000 });
      const ordered = groupChronology(posts);
      expect(ordered.findIndex(message => message.id === entry.id))
        .toBeLessThan(ordered.findIndex(message => message.id === replyId));
    });
    expect(JSON.stringify(traces)).not.toContain('A reply to the original');

    // Two syncs can arrive while the first history replay is still writing to
    // the channel. The second must cover a post queued during that replay.
    for (const peer of [a, c, e]) offline.add(peer);
    delayedPacket = undefined;
    await peers.get(b)!.send(room, 'Missed while disconnected');
    heldPacket = saved.get(b)![0].entries.at(-1)!.packet;
    const gate = Promise.withResolvers<void>();
    let replaying = false;
    hold = () => { replaying = true; return gate.promise; };
    const sync = { type:'sync' as const, group:room, known:saved.get(d)![0].entries.map(post => post.hash) };
    await peers.get(b)!.receive(d, sync);
    try {
      await vi.waitFor(() => expect(replaying).toBe(true));
      const later = await peers.get(b)!.send(room, 'Queued during replay');
      await peers.get(b)!.receive(d, sync);
      expect(saved.get(d)![0].entries.some(post => post.id === later)).toBe(false);
      delayedRecipient = undefined;
      gate.resolve();
      await vi.waitFor(() => expect(saved.get(d)![0].entries.filter(post => post.id === later)).toHaveLength(1));
    } finally { gate.resolve(); }

    const content = new Uint8Array(FILE_CHUNK_BYTES * 2 + 7).map((_, index) => index % 251);
    const attachmentId = await peers.get(b)!.send(room, 'Document caption', entry.id,
      { name:'group-document.bin', mime:'application/octet-stream', bytes:content });
    await vi.waitFor(() => expect(saved.get(d)?.[0]?.entries.find(post => post.id === attachmentId)?.file?.size).toBe(content.length));
    const attachment = saved.get(d)![0].entries.find(post => post.id === attachmentId)!;
    expect(attachment).toMatchObject({ from:b, text:'Document caption', replyTo:entry.id, file:{ id:attachmentId, name:'group-document.bin' } });
    expect(await peers.get(d)!.readFile(room, attachment.hash)).toBeNull();
    const unrelated = encodeAccountId(new Uint8Array(20).fill(217)), request = crypto.randomUUID();
    await peers.get(b)!.receive(unrelated, { type:'file-request', group:room, hash:attachment.hash, request, epoch:1 });
    corruptAttachment = true;
    await expect(peers.get(d)!.obtainFile(room, attachment.hash)).rejects.toThrow('group_file_unavailable');
    expect(await peers.get(d)!.readFile(room, attachment.hash)).toBeNull();
    corruptAttachment = false;
    await peers.get(d)!.obtainFile(room, attachment.hash);
    expect(await peers.get(d)!.readFile(room, attachment.hash)).toEqual(content);
    expect(traces.filter(item => item.frame.type === 'file-part' && item.to === d)).toHaveLength(6);
    expect(traces.some(item => 'request' in item.frame && item.frame.request === request)).toBe(false);

    const mentionId = await peers.get(b)!.send(room, '  @Ник @Ник', undefined, undefined,
      [[2,6,d], [7,11,unrelated]]);
    await vi.waitFor(() => expect(saved.get(d)![0].entries.some(post => post.id === mentionId)).toBe(true));
    const mentioned = saved.get(d)![0].entries.find(post => post.id === mentionId)!;
    expect(mentioned).toMatchObject({ text:'@Ник @Ник', mentions:[[0,4,d]] });
    expect(groupPostMentions(mentioned, d)).toBe(true);
    expect(groupPostMentions(mentioned, e)).toBe(false);
    expect(groupEntryUnread(mentioned, d)).toBe(true);
    expect(restoreGroups(saved.get(d))[0].entries.find(post => post.id === mentionId)?.mentions).toEqual([[0,4,d]]);
    await peers.get(d)!.markRead(room, [mentioned.hash]);
    expect(groupEntryUnread(saved.get(d)![0].entries.find(post => post.id === mentionId)!, d)).toBe(false);
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
    const initialMessage = await at(b).send(group, 'Before the invitation');
    await wait(() => expect(room(a).entries).toHaveLength(1));
    await expect(at(a).actOnMessage(group, { kind:'edit', targetId:initialMessage, text:'By someone else', previousRevision:0 }))
      .rejects.toThrow('group_message_unavailable');
    await at(b).actOnMessage(group, { kind:'pin', targetId:initialMessage });
    await wait(() => expect(groupPins(room(a))).toMatchObject([{ actor:b, targetId:initialMessage }]));

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
    const earlier = room(b).entries[0];
    expect(earlier.audience).toEqual([a,b,c]);
    const priorPacket = { type:'message' as const, group, packet:earlier.packet };
    expect(await at(d).receiveNodePost(b, priorPacket, a)).toBe(false);
    expect(room(d).entries).toHaveLength(0);
    expect(groupPins(room(d))).toHaveLength(0);
    await expect(at(b).actOnMessage(group, { kind:'edit', targetId:initialMessage, text:'Old group only', previousRevision:0 }))
      .rejects.toThrow('group_message_unavailable');
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
    expect(groupPins(room(a))).toHaveLength(0);
    const afterRemoval = await at(a).send(group, 'After the removal');
    await wait(() => expect(room(d).entries.some(entry => entry.text === 'After the removal')).toBe(true));
    const newPost = room(a).entries.at(-1)!;
    await expect(decryptGroupPost({ ...revokedState, epoch:3 }, newPost.packet, await groupPacketHash(newPost.packet))).rejects.toThrow();
    await at(a).actOnMessage(group, { kind:'edit', targetId:afterRemoval, text:'Corrected after removal', previousRevision:0 });
    const edit = room(a).actions!.find(entry => entry.action?.targetId === afterRemoval)!;
    await expect(decryptGroupPost({ ...revokedState, epoch:3 }, edit.packet, edit.hash)).rejects.toThrow();

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
    expect(await at(b).receiveNodePost(a,{ type:'message', group, packet:newPost.packet },a)).toBe(false);
    expect(room(b).entries.some(entry => entry.id === newPost.id)).toBe(false);

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
