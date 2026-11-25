import { describe, expect, it, vi } from 'vitest';
import { accountIdFromPublicKey } from '$lib/addressing/account-id.js';
import { ensureConversation, emptySessionChats, setContactState } from '$lib/chat/session-chats';
import { WebCryptoIdentity } from '$lib/identity/webcrypto';
import { CourierController, type CourierDelivery } from '$lib/node/courier-controller';
import { COURIER_PROTOCOL, COURIER_TTL } from '$lib/node/courier-protocol.js';
import { generateCourierKey, signCourier, type CourierBundle } from '$lib/node/courier-crypto';
import { emptyCourierState, restoreCourierState, type CourierState } from '$lib/node/courier-state';
import { COURIER_PREKEY_PROTOCOL } from '$lib/node/courier-prekeys.js';
import { cipherDigest } from '$lib/node/offline-crypto';
import { GroupController } from './GroupController';
import { groupChronology, restoreGroups, type GroupRooms } from './storage';

async function account() {
  const identity = new WebCryptoIdentity();
  await identity.create();
  return { identity, address:await accountIdFromPublicKey(await identity.getPublicKeyBytes()) };
}

describe('closed group courier fallback', () => {
  it.each(['author', 'member'] as const)('recovers the full queue from the %s with no node on the receiving client', async carrier => {
    const [alice, relay, bob, node] = await Promise.all([account(), account(), account(), account()]);
    let now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const startedAt = now;
    const users = [alice, relay, bob];
    const indexOf = (address: string) => users.findIndex(user => user.address === address);
    const carrierIndex = carrier === 'author' ? 0 : 1;
    const uploader = users[carrierIndex];
    const source = { url:'https://queue.example', nodeId:'a'.repeat(32) };
    const rooms: GroupRooms[] = [[], [], []];
    const queue = new Map<string, CourierDelivery>();
    const receipts = new Map<string, string>();
    const bundles = new Map<string, CourierBundle>();
    const workers: CourierController[] = [];
    const groups: GroupController[] = [];
    const states = users.map((_user,index):CourierState => index === carrierIndex
      ? { ...emptyCourierState(), enabled:true, node:{ ...source, address:node.address } } : emptyCourierState());
    const personal = vi.fn();
    let partitioned = false, direct = true, persistBob = true;
    let allocated = 0;
    const messageCount = 10;

    try {
      for (const [index, user] of users.entries()) {
        const contacts = users.filter(peer => peer !== user);
        const chats = contacts.reduce((state, peer) =>
          setContactState(ensureConversation(state,peer.address),peer.address,'accepted'), emptySessionChats());
        const canDirect = (peer: string) => direct && (!partitioned || index !== 2 && peer !== bob.address);
        const group = new GroupController({
          self:user.address, identity:user.identity, active:() => true, contact:peer => contacts.some(contact => contact.address === peer),
          allowed:peer => contacts.some(contact => contact.address === peer),
          nodeEnabled:() => states[index].enabled, rooms:() => rooms[index],
          save:async value => {
            if (index === 2 && !persistBob) throw new Error('save failed');
            rooms[index] = restoreGroups(structuredClone(value));
          },
          transport:{ ready:canDirect, send:async (peer, frame) => {
            if (canDirect(peer)) await groups[indexOf(peer)].receive(user.address, frame);
          } },
        });
        groups.push(group);
        workers.push(new CourierController({
          ...user, state:() => states[index], update:value => { states[index] = value; }, chats:() => chats,
          groups:{ posts:() => group.nodePosts(), eligible:(ref,to) => group.canStoreOnNode(ref,to),
            status:(ref,to,status) => group.recordNodeStatus(ref,to,status), receive:(from,frame,source) => group.receiveNodePost(from,frame,source) },
          persist:async () => { states[index] = restoreCourierState(states[index]); return true; },
          receive:personal, delivery:personal, error:() => {},
          publish:async (peer,bundle) => { bundles.set(user.address+peer,bundle); },
          request:async (_url,_node,_identity,address,path,body:any) => {
            if (path === '/outbox/status') return { address:node.address, enabled:true };
            if (path === '/outbox/put') {
              expect(address).toBe(uploader.address);
              const job = body.job as CourierDelivery['job'];
              expect(job.body.to).toBe(bob.address);
              queue.set(job.body.id,{ from:node.address, job, hop:await signCourier('hop',
                { protocol:COURIER_PROTOCOL, courier:node.address, id:job.body.id, digest:await cipherDigest(job.body.packet) },node.identity) });
              return { status:'stored' };
            }
            if (path === '/outbox/receipts') return { receipts:[...receipts].filter(([id]) => body.ids.includes(id.replaceAll('-','')))
              .map(([,receipt]) => ({ receipt })) };
            if (path === '/prekeys/allocate') {
              expect(address).toBe(uploader.address);
              expect(body.owner).toBe(bob.address);
              const acceptUntil = startedAt + COURIER_TTL, retainUntil = acceptUntil + COURIER_TTL;
              const key = await generateCourierKey(address,acceptUntil,{ directory:source, issuedAt:startedAt, retainUntil });
              states[2] = { ...states[2], keys:[...states[2].keys,key] };
              allocated++;
              return { protocol:COURIER_PREKEY_PROTOCOL, reservation:body.reservation, allocatedAt:now, expiresAt:now + COURIER_TTL,
                key:await signCourier('prekey',{ protocol:COURIER_PREKEY_PROTOCOL, from:bob.address, to:address, node:source,
                  id:key.id, publicKey:key.publicKey, issuedAt:startedAt, acceptUntil, retainUntil, deliveryTtlMs:COURIER_TTL },bob.identity) };
            }
            if (path === '/prekeys/availability') return { protocol:COURIER_PREKEY_PROTOCOL, available:32 };
            if (path === '/receive/list') {
              expect(address).toBe(bob.address);
              expect(body.grant.body.from).toBe(uploader.address);
              const rows = [...queue.entries()].sort(([left],[right]) => left.localeCompare(right))
                .filter(([id]) => id.replaceAll('-','') > body.cursor);
              const page = rows.slice(0,8);
              return { protocol:'automesh-inbox-v1', deliveries:page.map(([,data]) => data),
                cursor:rows.length > page.length ? page.at(-1)![0].replaceAll('-','') : '' };
            }
            if (path === '/receive/ack') {
              const id = JSON.parse(body.receipt).body.id;
              expect(rooms[2][0].entries.length).toBeGreaterThan(receipts.size);
              receipts.set(id,body.receipt);
              queue.delete(id);
              return { acknowledged:true };
            }
            throw new Error('unexpected request ' + path);
          },
        }));
      }
      const group = await groups[0].create('Courier fallback', [relay.address,bob.address]);
      await vi.waitFor(() => { expect(rooms[1][0]?.id).toBe(group); expect(rooms[2][0]?.id).toBe(group); });
      await groups[1].accept(group);
      await groups[2].accept(group);
      await vi.waitFor(() => { for (const value of rooms) expect(value[0]?.mls).toBeTruthy(); });
      await workers[carrierIndex].publish(bob.address);
      await workers[2].publish(uploader.address);
      const recipientBundle = bundles.get(bob.address+uploader.address)!;
      const { groupRelay, ...olderBody } = recipientBundle.body;
      expect(groupRelay).toBe(true);
      await workers[carrierIndex].accept(bob.address, carrier === 'member'
        ? await signCourier('prekeys',olderBody,bob.identity) : recipientBundle);
      await workers[2].accept(uploader.address,bundles.get(uploader.address+bob.address)!);

      partitioned = true;
      direct = carrier === 'member';
      if (carrier === 'author') groups[0].peerOffline(relay.address);
      groups[0].peerOffline(bob.address);
      groups[1].peerOffline(bob.address);
      const messages = [];
      let firstId: string | undefined;
      for (let i = 0; i < messageCount; i++) {
        now++;
        const text = 'Private group text ' + i;
        const id = await groups[0].send(group,text,firstId);
        firstId ??= id;
        messages.push({id,text});
      }
      expect(rooms[2][0].entries).toHaveLength(0);
      if (carrier === 'member') await vi.waitFor(() => expect(rooms[1][0].entries).toHaveLength(messageCount));
      direct = false;
      now += 3000;

      if (carrier === 'member') {
        // Backfill a copy imported from the previously deployed format.
        rooms[1] = restoreGroups([{ ...rooms[1][0], entries:rooms[1][0].entries.map(entry => ({ ...entry, nodeSince:undefined })) }]);
        states[0].enabled = true;
        const fromAuthor = [...groups[0].nodePosts()].filter(post => post.peer === bob.address);
        const fromRelay = [...groups[1].nodePosts()].filter(post => post.peer === bob.address);
        expect(fromAuthor).toHaveLength(messageCount);
        expect(fromRelay).toHaveLength(messageCount);
        expect(new Set([...fromAuthor,...fromRelay].map(post => post.id)).size).toBe(2 * messageCount);
        states[0].enabled = false;
        await workers[1].poll();
        expect(queue.size).toBe(0); // Earlier apps can't accept a third-party packet via the node.
        const body = { ...recipientBundle.body, keys:recipientBundle.body.keys.slice(0,1), keySource:source };
        await workers[1].accept(bob.address,await signCourier('prekeys',body,bob.identity));
      }
      await workers[carrierIndex].poll();
      expect(queue.size).toBe(4);
      await workers[carrierIndex].poll();
      expect(queue.size).toBe(8);
      await workers[carrierIndex].poll();
      expect(queue.size).toBe(messageCount);
      expect(allocated).toBe(carrier === 'member' ? messageCount - 1 : 0);
      expect(JSON.stringify([...queue.values()])).not.toContain('Private group text');
      expect(rooms[carrierIndex][0].entries.every(entry => entry.nodeStatus?.[bob.address] === 'stored')).toBe(true);

      persistBob = false;
      await workers[2].poll();
      await workers[2].settled();
      expect(receipts.size).toBe(0);
      expect(queue.size).toBe(messageCount);

      persistBob = true;
      now += 6000;
      await workers[2].poll();
      await workers[2].settled();
      expect(receipts.size).toBe(messageCount - 8);
      now += 6000;
      await workers[2].poll();
      await workers[2].settled();
      expect(groupChronology(rooms[2][0].entries)).toMatchObject(messages.map(message =>
        ({ ...message, from:alice.address, unread:true, route:{ peer:uploader.address, node:node.address } })));
      expect(groupChronology(rooms[2][0].entries).slice(1).every(entry => entry.replyTo === firstId)).toBe(true);
      expect(receipts.size).toBe(messageCount);
      expect(await groups[2].receiveNodePost(alice.address,
        { type:'message', group, packet:rooms[0][0].entries[0].packet }, node.address)).toBe(true);
      expect(rooms[2][0].entries).toHaveLength(messageCount);
      expect(states[2].node).toBeNull();
      await workers[carrierIndex].poll();
      expect(rooms[carrierIndex][0].entries.every(entry => entry.nodeStatus?.[bob.address] === 'delivered')).toBe(true);
      expect(states[carrierIndex].pending).toHaveLength(0);
      expect([...groups[carrierIndex].nodePosts()].filter(post => post.peer === bob.address)).toEqual([]);
      expect(personal).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore();
      for (const worker of workers) worker.stop();
      await Promise.allSettled(workers.map(worker => worker.settled()));
      for (const user of [...users,node]) user.identity.dispose();
    }
  }, 20000);
});
