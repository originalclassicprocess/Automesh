import { describe, expect, it } from 'vitest';
import { WebCryptoIdentity } from '$lib/identity/webcrypto';
import { accountIdFromPublicKey } from '$lib/addressing/account-id.js';
import { CourierController } from '$lib/node/courier-controller';
import { emptyCourierState, restoreCourierState } from '$lib/node/courier-state';
import { generateCourierKey, signCourier, type CourierJob } from '$lib/node/courier-crypto';
import { COURIER_PROTOCOL } from '$lib/node/courier-protocol.js';
import { cipherDigest } from '$lib/node/offline-crypto';
import { emptySessionChats, ensureConversation, recordSentMessage, receiveMessage, restoreChats, saveChats, setContactState, setDeliveryStatus } from './session-chats';
import { messagePins } from './message-pins';
async function account() {
  const identity = new WebCryptoIdentity(); await identity.create();
  return { identity, address: await accountIdFromPublicKey(await identity.getPublicKeyBytes()) };
}
describe('encrypted offline pin delivery', () => {
  it('queues at a blind node, survives restart, reaches both views, and consumes one key only once', async () => {
    const [a, b, n] = await Promise.all([account(), account(), account()]);
    let stateA = emptyCourierState(), stateB = emptyCourierState();
    let chatsA = setContactState(ensureConversation(emptySessionChats(), b.address), b.address, 'accepted');
    let chatsB = setContactState(ensureConversation(emptySessionChats(), a.address), a.address, 'accepted');
    const targetId = crypto.randomUUID(), controlId = crypto.randomUUID();
    chatsA = receiveMessage(chatsA, { id: targetId, text: 'original', from: b.address, timestamp: Date.now(), direction: 'incoming' });
    chatsB = recordSentMessage(chatsB, a.address, { id: targetId, text: 'original', from: b.address, timestamp: Date.now(), direction: 'outgoing' });
    chatsA = recordSentMessage(chatsA, b.address, { id: controlId, from: a.address, text: '', timestamp: Date.now(), direction: 'outgoing', delivery: 'queued', details: { pin: { targetId, revision: 1 } } });
    const jobs: CourierJob[] = [], receipts: { receipt: string }[] = [];
    const sender = new CourierController({ address: a.address, identity: a.identity, state: () => stateA, update: value => stateA = value,
      chats: () => chatsA, persist: async () => true, receive: () => {}, publish: async () => {}, error: () => {},
      delivery: (peer, id, status) => chatsA = setDeliveryStatus(chatsA, peer, id, status),
      request: async (_url, _id, _signer, _address, path, body: any) => {
        if (path === '/outbox/status') return { address: n.address, enabled: true, relay: 'wss://relay.example/signal' };
        if (path === '/outbox/put') { jobs.push(body.job); return { status: 'stored' }; }
        return { receipts };
      } });
    const recipient = new CourierController({ address: b.address, identity: b.identity, state: () => stateB, update: value => stateB = value,
      chats: () => chatsB, persist: async () => true, publish: async () => {}, error: () => {}, delivery: () => {},
      receive: message => chatsB = receiveMessage(chatsB, { ...message, direction: 'incoming' }) });
    try {
      const expiresAt = Date.now() + 60000, key = await generateCourierKey(a.address, expiresAt); stateB.keys = [key];
      await sender.configure({ url: 'https://localhost:3003', nodeId: 'a'.repeat(32), address: n.address }, true);
      await sender.accept(b.address, await signCourier('prekeys', { protocol: COURIER_PROTOCOL, from: b.address, to: a.address, expiresAt, keys: [{ id: key.id, publicKey: key.publicKey }] }, b.identity));
      await sender.poll(); expect(jobs).toHaveLength(1);
      expect(JSON.stringify(jobs)).not.toContain(targetId); expect(Object.keys(stateA.used)).toEqual([key.id]);
      stateA = restoreCourierState(stateA); chatsA = restoreChats(saveChats(chatsA));
      const hop = await signCourier('hop', { protocol: COURIER_PROTOCOL, courier: n.address, id: controlId, digest: await cipherDigest(jobs[0].body.packet) }, n.identity);
      const delivery = { from: n.address, job: jobs[0], hop };
      await recipient.receive(delivery, (_id, receipt) => receipts.push({ receipt }));
      const local = messagePins(chatsA.byPeer[b.address].messages, a.address, b.address);
      const remote = messagePins(chatsB.byPeer[a.address].messages, b.address, a.address);
      expect(remote.map(({ actor, targetId }) => ({ actor, targetId }))).toEqual(local.map(({ actor, targetId }) => ({ actor, targetId })));
      expect(stateB.keys).toHaveLength(0); stateB = restoreCourierState(stateB); chatsB = restoreChats(saveChats(chatsB));
      await recipient.receive(delivery, () => {}); expect(chatsB.byPeer[a.address].messages.filter(message => message.details?.pin)).toHaveLength(1);
      await sender.poll(); expect(Object.keys(stateA.used)).toEqual([key.id]); expect(jobs).toHaveLength(1);
      expect(chatsA.byPeer[b.address].messages.find(message => message.id === controlId)?.delivery).toBe('delivered');
    } finally { sender.stop(); recipient.stop(); await Promise.all([sender.settled(), recipient.settled()]); }
  });
});
