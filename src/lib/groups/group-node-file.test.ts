import { expect, it, vi } from 'vitest';
import { accountIdFromPublicKey } from '$lib/addressing/account-id.js';
import { emptySessionChats, ensureConversation, setContactState } from '$lib/chat/session-chats';
import { WebCryptoIdentity } from '$lib/identity/webcrypto';
import { ATTACHMENT_PROTOCOL, FILE_POLICY_BYTES } from '$lib/node/attachment-protocol.js';
import { CourierController, type CourierDelivery } from '$lib/node/courier-controller';
import { generateCourierKey, signCourier, verifyCourier, type CourierJob } from '$lib/node/courier-crypto';
import { COURIER_PROTOCOL } from '$lib/node/courier-protocol.js';
import { emptyCourierState, restoreCourierState, type CourierState } from '$lib/node/courier-state';
import { cipherDigest } from '$lib/node/offline-crypto';
import { GroupController } from './GroupController';
import { groupEdits, groupPins, groupReactions } from './actions';
import { groupDelivery } from './presentation';
import { restoreGroups, type GroupRooms } from './storage';

it.each([{ count:1, automatic:false }, { count:4, automatic:true }])(
'downloads $count verified group attachments from the offline sender’s node (automatic: $automatic)', async ({ count, automatic }) => {
  async function account() {
    const identity = new WebCryptoIdentity();
    await identity.create();
    return { identity, address:await accountIdFromPublicKey(await identity.getPublicKeyBytes()) };
  }
  const [sender, recipient, node] = await Promise.all([account(), account(), account()]);
  const accounts = [sender, recipient];
  const rooms: GroupRooms[] = [[], []];
  const files = accounts.map(() => new Map<string, Uint8Array>());
  let direct = true, authorOnline = true, autoReceive = false, now = Date.now(), senderNickname = 'Original name';
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
  const groups: GroupController[] = accounts.map(({ address, identity }, index) => new GroupController({
    self:address, identity, active:() => index !== 0 || authorOnline, allowed:() => true,
    nickname:() => index === 0 ? senderNickname : 'Recipient',
    contact:peer => peer === accounts[1 - index].address, rooms:() => rooms[index], nodeEnabled:() => index === 0,
    save:async (value, file) => {
      rooms[index] = structuredClone(value);
      if (file) files[index].set(file.hash, file.bytes.slice());
    },
    files:{
      read:async (_group, hash) => files[index].get(hash)?.slice() ?? null,
      write:async () => { throw Error('unexpected direct file write'); },
    },
    transport:{
      ready:() => direct,
      send:async (peer, frame) => {
        if (!direct || peer !== accounts[1 - index].address) throw Error('unreachable');
        await groups[1 - index].receive(address, frame);
      },
    },
  }));
  const workers: CourierController[] = [];
  try {
    const group = await groups[0].create('Files without the author', [recipient.address]);
    await vi.waitFor(() => expect(rooms[1][0]?.id).toBe(group));
    await groups[1].accept(group);
    await vi.waitFor(() => expect(rooms.every(([room]) => !!room.mls)).toBe(true));

    direct = false;
    senderNickname = 'Updated offline name';
    const payloads = new Map<string, Uint8Array>();
    for (let index = 0; index < count; index++) {
      const bytes = Uint8Array.from({ length:36_135 + index }, (_, offset) => (offset + index) % 251);
      const message = await groups[0].send(group, 'A group attachment', undefined,
        { name:`group-${index}.bin`, mime:'application/octet-stream', bytes });
      const { hash } = rooms[0][0].entries.find(entry => entry.id === message)!;
      payloads.set(hash, bytes);
    }
    const actionOriginal = automatic ? await groups[0].send(group, 'Text before offline edit') : undefined;
    if (actionOriginal) {
      await groups[0].actOnMessage(group, { kind:'edit', targetId:actionOriginal, text:'Text after offline edit', previousRevision:0 });
      await groups[0].actOnMessage(group, { kind:'reaction', targetId:actionOriginal, emoji:'👍' });
      await groups[0].actOnMessage(group, { kind:'pin', targetId:actionOriginal });
    }
    const additional = actionOriginal ? 4 : 0;
    const [hash] = payloads.keys();
    const messages = rooms[0][0].entries.map(entry => entry.id);
    expect(rooms[1][0].entries).toHaveLength(0);
    now += 3000;

    const expiresAt = now + 60_000;
    const keys = await Promise.all(Array.from({ length:count * 2 + additional }, () => generateCourierKey(sender.address, expiresAt)));
    const server = { url:'https://queue.example', nodeId:'a'.repeat(32), address:node.address };
    const receiverBundle = await signCourier('prekeys', { protocol:COURIER_PROTOCOL, from:recipient.address,
      to:sender.address, expiresAt, keys:keys.map(({id, publicKey}) => ({ id, publicKey })),
      groupPosts:true as const, groupFiles:true as const, attachmentProtocol:ATTACHMENT_PROTOCOL, maxFileBytes:FILE_POLICY_BYTES }, recipient.identity);
    const senderKey = await generateCourierKey(recipient.address, expiresAt);
    const grant = await signCourier('recipient-inbox', { protocol:'automesh-recipient-inbox-v1', from:sender.address,
      to:recipient.address, courier:node.address, nodeId:server.nodeId, issuedAt:now, expiresAt }, sender.identity);
    const senderBundle = await signCourier('prekeys', { protocol:COURIER_PROTOCOL, from:sender.address,
      to:recipient.address, expiresAt, keys:[{ id:senderKey.id, publicKey:senderKey.publicKey }],
      senderQueue:{ ...server, grant } }, sender.identity);
    const states: CourierState[] = [
      { ...emptyCourierState(), node:server, enabled:true, bundles:{[recipient.address]:receiverBundle} },
      { ...emptyCourierState(), keys, bundles:{[sender.address]:senderBundle} },
    ];
    const deliveries = new Map<string, CourierDelivery>();
    const cipherParts = new Map<string, { index:number; cipher:string }[]>();
    const acknowledgements = new Map<string, string>();
    const partial = new Map<string, Map<number, Uint8Array>>();
    const unexpectedPrivateOffer = vi.fn();

    function courier(index: number) {
      const groupController = groups[index], peer = accounts[1 - index].address;
      const chats = setContactState(ensureConversation(emptySessionChats(), peer), peer, 'accepted');
      const worker = new CourierController({ ...accounts[index], state:() => states[index], update:value => { states[index] = value; },
        chats:() => chats, persist:async () => true, receive:unexpectedPrivateOffer, delivery:() => {}, publish:async () => {}, error:() => {},
        groups:{
          posts:file => groupController.nodePosts(file), eligible:(ref, to) => groupController.canStoreOnNode(ref, to),
          release:(ref, to) => groupController.canReleaseNodeCopy(ref, to),
          status:(ref, to, status) => groupController.recordNodeStatus(ref, to, status),
          receive:(from, frame, via) => groupController.receiveNodePost(from, frame, via),
          files:{
            load:ref => groupController.readFile(ref.group, ref.hash),
            receive:(from, frame, via, offer) => groupController.receiveNodeFile(from, frame, via, offer),
            allowed:(ref, from, offer) => !!groupController.nodeFileOffer(ref, from, offer),
            accepted:ref => autoReceive || groupController.fileRequested(ref.group, ref.hash),
            complete:(ref, from, via, offer, contents) => groupController.completeNodeFile(ref, from, via, offer, contents),
          },
        },
        files:{
          load:async () => null, offer:unexpectedPrivateOffer, accepted:() => false,
          complete:async () => { throw Error('unexpected private file completion'); }, progress:() => {},
          savePart:async (_peer, id, part, contents) => {
            const parts = partial.get(id) ?? new Map();
            parts.set(part, contents.slice());
            partial.set(id, parts);
          },
          loadPart:async (_peer, id, part) => partial.get(id)?.get(part)?.slice() ?? null,
          cleanup:async (_peer, id) => { partial.delete(id); },
        },
        request:async (_url, _node, _identity, _address, path, value: any) => {
          if (path === '/outbox/status') return { address:node.address, fileQueue:{ protocol:ATTACHMENT_PROTOCOL, maxFileBytes:FILE_POLICY_BYTES } };
          if (path === '/outbox/receipts') return { receipts:[] };
          if (path === '/outbox/file/start') {
            cipherParts.set(value.job.body.attachment.id, []);
            return { received:[] };
          }
          if (path === '/outbox/file/part') {
            cipherParts.get(value.id)!.push({ index:value.index, cipher:value.cipher });
            return { stored:value.index };
          }
          if (path === '/outbox/put') {
            const job: CourierJob = value.job;
            const hop = await signCourier('hop', { protocol:COURIER_PROTOCOL, courier:node.address,
              id:job.body.id, digest:await cipherDigest(job.body.packet) }, node.identity);
            deliveries.set(job.body.id, { from:node.address, job, hop });
            return { status:'stored' };
          }
          if (path === '/receive/list') return { protocol:'automesh-inbox-v1', cursor:'',
            deliveries:[...deliveries.values()].reverse().filter(delivery => !acknowledgements.has(delivery.job.body.id)).slice(0, 8) };
          if (path === '/receive/file/parts') {
            expect(authorOnline).toBe(false);
            await verifyCourier(value.request, 'attachment-request', recipient.address);
            const { id, index:part } = value.request.body;
            return { id, parts:cipherParts.get(id)!.slice(part, part + 4) };
          }
          if (path === '/receive/ack') {
            const receipt = JSON.parse(value.receipt);
            await verifyCourier(receipt, 'receipt', recipient.address);
            if (deliveries.get(receipt.body.id)?.job.body.attachment) {
              const ref = states[0].groupJobs?.[receipt.body.id];
              if (!ref) throw Error('missing group attachment reservation');
              expect(payloads.has(ref.hash)).toBe(true);
              expect(files[1].get(ref.hash)).toEqual(payloads.get(ref.hash));
            }
            acknowledgements.set(receipt.body.id, value.receipt);
            return { acknowledged:true };
          }
          throw Error('unexpected request ' + path);
        },
      });
      workers.push(worker);
      return worker;
    }

    const senderWorker = courier(0);
    for (let poll = 0; poll < count; poll++) await senderWorker.poll();
    expect([...deliveries.values()].filter(delivery => delivery.job.body.attachment)).toHaveLength(count);
    expect(deliveries.size).toBe(count * 2 + additional);
    for (const parts of cipherParts.values()) expect(parts).toHaveLength(2);
    const fileEntries = rooms[0][0].entries.filter(entry => entry.file);
    expect(fileEntries.every(entry => entry.nodeFileStatus?.[recipient.address] === 'stored')).toBe(true);
    for (const entry of fileEntries)
      expect(groupDelivery(rooms[0][0], entry, sender.address).status).toMatchObject({ label:'Сохранено на ноде', tone:'success' });
    expect(restoreCourierState(states[0]).groupJobs).toEqual(states[0].groupJobs);
    authorOnline = false;
    workers[0].stop();

    const firstReceiver = courier(1);
    await firstReceiver.poll();
    await firstReceiver.settled();
    if (additional) {
      now += 5000;
      await firstReceiver.poll();
    }
    await firstReceiver.settled();
    expect(rooms[1][0].entries.map(entry => entry.id).sort()).toEqual(messages.sort());
    expect(rooms[1][0].profiles?.[sender.address]?.nickname).toBe(senderNickname);
    expect(acknowledgements.size).toBe(count + additional);
    expect(files[1].size).toBe(0);
    expect(states[1].incomingFiles).toHaveLength(count);
    const queued = states[1].incomingFiles.find(file => file.group?.hash === hash)!;
    expect(queued.group).toMatchObject({ group, hash, file:true });
    expect(groups[1].nodeFileOffer(queued.group!, sender.address, { ...queued.manifest.offer, sha256:'0'.repeat(64) })).toBeUndefined();
    expect(groups[1].nodeFileOffer(queued.group!, node.address, queued.manifest.offer)).toBeUndefined();
    if (!automatic) await groups[1].requestFile(group, hash);
    firstReceiver.stop();
    states[1] = restoreCourierState(states[1]);
    rooms[1] = restoreGroups(rooms[1]);
    if (actionOriginal) {
      const restored = rooms[1][0];
      expect(groupEdits(restored).get(actionOriginal)?.text).toBe('Text after offline edit');
      expect(groupReactions(restored).get(actionOriginal)).toEqual([{ emoji:'👍', actors:[sender.address] }]);
      expect(groupPins(restored)).toMatchObject([{ targetId:actionOriginal, actor:sender.address }]);
      expect(restored.entries.find(entry => entry.id === actionOriginal)?.text).toBe('Text before offline edit');
    }
    autoReceive = automatic;
    const receiver = courier(1);
    for (let poll = 0; poll < Math.ceil(count / 2); poll++) await receiver.poll();
    for (const [hash, bytes] of payloads) {
      expect(await groups[1].readFile(group, hash)).toEqual(bytes);
      expect(rooms[1][0].entries.find(entry => entry.hash === hash)).toMatchObject({ fileNode:node.address, fileReady:true });
      expect(groups[1].fileRequested(group, hash)).toBe(false);
    }
    expect(acknowledgements.size).toBe(count * 2 + additional);
    expect(states[1].incomingFiles).toHaveLength(0);
    expect(unexpectedPrivateOffer).not.toHaveBeenCalled();
  } finally {
    for (const worker of workers) worker.stop();
    await Promise.all(workers.map(worker => worker.settled()));
    groups.forEach(group => group.close());
    for (const { identity } of [...accounts, node]) identity.dispose();
    clock.mockRestore();
  }
});
