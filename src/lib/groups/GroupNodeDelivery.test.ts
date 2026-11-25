import { describe, expect, it, vi } from 'vitest';
import { accountIdFromPublicKey } from '$lib/addressing/account-id.js';
import { ensureConversation, emptySessionChats, setContactState } from '$lib/chat/session-chats';
import { WebCryptoIdentity } from '$lib/identity/webcrypto';
import { CourierController, type CourierDelivery } from '$lib/node/courier-controller';
import { COURIER_PROTOCOL } from '$lib/node/courier-protocol.js';
import { signCourier, type CourierBundle } from '$lib/node/courier-crypto';
import { emptyCourierState, restoreCourierState, type CourierState } from '$lib/node/courier-state';
import { cipherDigest } from '$lib/node/offline-crypto';
import { GroupController } from './GroupController';
import { restoreGroups, type GroupRooms } from './storage';

async function account() {
  const identity = new WebCryptoIdentity();
  await identity.create();
  return { identity, address:await accountIdFromPublicKey(await identity.getPublicKeyBytes()) };
}

describe('closed group courier fallback', () => {
  it('uses a signed queue grant with no recipient node and confirms only a saved MLS post', async () => {
    const [alice, bob, node] = await Promise.all([account(), account(), account()]);
    let now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const users = [alice, bob];
    const rooms: GroupRooms[] = [[], []];
    const queue = new Map<string, CourierDelivery>();
    const receipts = new Map<string, string>();
    const bundles: CourierBundle[] = [];
    const workers: CourierController[] = [];
    const groups: GroupController[] = [];
    const states: CourierState[] = [
      { ...emptyCourierState(), enabled:true, node:{ url:'https://queue.example', nodeId:'a'.repeat(32), address:node.address } },
      emptyCourierState(),
    ];
    const personal = vi.fn();
    let direct = true, persistBob = true;
    try {
      for (const [index, user] of users.entries()) {
        const peer = users[1-index].address;
        const chats = setContactState(ensureConversation(emptySessionChats(), peer), peer, 'accepted');
        const group = new GroupController({
          self:user.address, identity:user.identity, active:() => true, contact:value => value === peer, allowed:value => value === peer,
          nodeEnabled:() => states[index].enabled, rooms:() => rooms[index],
          save:async value => {
            if (index === 1 && !persistBob) throw new Error('save failed');
            rooms[index] = restoreGroups(structuredClone(value));
          },
          transport:{ ready:() => direct, send:async (_peer, frame) => { if (direct) await groups[1-index].receive(user.address, frame); } },
        });
        groups.push(group);
        workers.push(new CourierController({
          ...user, state:() => states[index], update:value => { states[index] = value; }, chats:() => chats,
          groups:{ posts:() => group.nodePosts(), eligible:(ref,to) => group.canStoreOnNode(ref,to),
            status:(ref,to,status) => group.recordNodeStatus(ref,to,status), receive:(from,frame) => group.receiveNodePost(from,frame) },
          persist:async () => { states[index] = restoreCourierState(states[index]); return true; },
          receive:personal, delivery:personal, error:() => {},
          publish:async (_peer,bundle) => { bundles[index] = bundle; },
          request:async (_url,_node,_identity,address,path,body:any) => {
            if (path === '/outbox/status') return { address:node.address, enabled:true };
            if (path === '/outbox/put') {
              expect(address).toBe(alice.address);
              const job = body.job as CourierDelivery['job'];
              expect(job.body.to).toBe(bob.address);
              queue.set(job.body.id, { from:node.address, job, hop:await signCourier('hop',
                { protocol:COURIER_PROTOCOL, courier:node.address, id:job.body.id, digest:await cipherDigest(job.body.packet) }, node.identity) });
              return { status:'stored' };
            }
            if (path === '/outbox/receipts') return { receipts:[...receipts.values()].map(receipt => ({ receipt })) };
            if (path === '/receive/list') {
              expect(address).toBe(bob.address);
              expect(body.grant.body.from).toBe(alice.address);
              return { protocol:'automesh-inbox-v1', deliveries:[...queue.values()], cursor:'' };
            }
            if (path === '/receive/ack') {
              expect(rooms[1][0].entries).toHaveLength(1);
              const id = JSON.parse(body.receipt).body.id;
              receipts.set(id, body.receipt);
              queue.delete(id);
              return { acknowledged:true };
            }
            throw new Error('unexpected request ' + path);
          },
        }));
      }
      const group = await groups[0].create('Courier fallback', [bob.address]);
      await vi.waitFor(() => expect(rooms[1][0]?.id).toBe(group));
      await groups[1].accept(group);
      await vi.waitFor(() => expect(rooms[1][0]?.mls).toBeTruthy());
      for (const [index, worker] of workers.entries()) await worker.publish(users[1-index].address);
      for (const [index, worker] of workers.entries()) expect(bundles[index].body.groupPosts).toBe(true);
      await workers[0].accept(bob.address, bundles[1]);
      await workers[1].accept(alice.address, bundles[0]);

      direct = false;
      groups[0].peerOffline(bob.address);
      groups[1].peerOffline(alice.address);
      const text = 'Private group text for an offline member';
      const id = await groups[0].send(group, text);
      expect(rooms[1][0].entries).toHaveLength(0);
      now += 3000;
      await workers[0].poll();
      expect(queue.size).toBe(1);
      expect(JSON.stringify([...queue.values()])).not.toContain(text);
      expect(rooms[0][0].entries[0].nodeStatus?.[bob.address]).toBe('stored');

      persistBob = false;
      await workers[1].poll();
      await workers[1].settled();
      expect(receipts.size).toBe(0);
      expect(queue.size).toBe(1);

      persistBob = true;
      now += 6000;
      await workers[1].poll();
      await workers[1].settled();
      expect(rooms[1][0].entries).toMatchObject([{ id, text, unread:true }]);
      expect(receipts.size).toBe(1);
      expect(states[1].node).toBeNull();
      expect([...groups[1].nodePosts()]).toEqual([]);
      await workers[0].poll();
      expect(rooms[0][0].entries[0].nodeStatus?.[bob.address]).toBe('delivered');
      expect(states[0].pending).toHaveLength(0);
      expect([...groups[0].nodePosts()]).toEqual([]);
      expect(personal).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore();
      for (const worker of workers) worker.stop();
      await Promise.allSettled(workers.map(worker => worker.settled()));
      for (const identity of [alice.identity,bob.identity,node.identity]) identity.dispose();
    }
  }, 20000);
});
