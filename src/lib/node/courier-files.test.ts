import { describe, expect, it } from 'vitest';
import { CourierController, type CourierReply } from './courier-controller';
import { emptyCourierState, restoreCourierState } from './courier-state';
import { generateCourierKey, signCourier, verifyCourier, type CourierJob } from './courier-crypto';
import { base64, cipherDigest, unbase64 } from './offline-crypto';
import { attachmentHash } from './attachment-crypto';
import { ATTACHMENT_PROTOCOL, FILE_POLICY_BYTES } from './attachment-protocol.js';
import { COURIER_PROTOCOL } from './courier-protocol.js';
import { WebCryptoIdentity } from '$lib/identity/webcrypto';
import { accountIdFromPublicKey } from '$lib/addressing/account-id.js';
import { emptySessionChats, ensureConversation, recordSentMessage, receiveFileMessage, restoreChats, saveChats, setContactState, setDeliveryStatus } from '$lib/chat/session-chats';
import { automaticFileOffers } from '$lib/chat/attachment-policy';
async function account() {
  const identity = new WebCryptoIdentity(); await identity.create();
  return { identity, address: await accountIdFromPublicKey(await identity.getPublicKeyBytes()) };
}
describe('files through an opaque node without a direct peer connection', () => {
  it.each([[false, false], [true, false], [false, true], [true, true]])('delivers a stored GIF while sender is locked, interrupted upload=%s, independent HTTPS=%s and receiver restart', async (interruptedUpload, http) => {
    const [a, b, n] = await Promise.all([account(), account(), account()]);
    const id = crypto.randomUUID(), original = new Uint8Array(32768 * 10 + 9).fill(71); original.set(new TextEncoder().encode('GIF89a'));
    const file = { id, name: 'offline.gif', mime: 'image/gif', size: original.length, sha256: await attachmentHash(original), details: { media: { kind: 'gif' as const } } };
    let sending = recordSentMessage(setContactState(ensureConversation(emptySessionChats(), b.address), b.address, 'accepted'), b.address,
      { id, text: '', from: a.address, timestamp: Date.now(), direction: 'outgoing', file, details: file.details, fileStatus: 'queued', delivery: 'queued' });
    let receiving = setContactState(ensureConversation(emptySessionChats(), a.address), a.address, 'accepted');
    const endpoint = { url: 'https://node.automesh.space', nodeId: 'a'.repeat(32), address: n.address };
    let sendState = { ...emptyCourierState(), node: endpoint, enabled: true }, receiveState = { ...emptyCourierState(), ...(http ? { node: endpoint } : {}) };
    const encrypted = new Map<number, Uint8Array>(), savedParts = new Map<number, Uint8Array>();
    let stored: CourierJob | null = null, receipt = '', completed: Uint8Array | null = null;
    let receiverCommitted = emptyCourierState();
    const request = async (_url: string, _node: string, _identity: unknown, _address: string, path: string, body: any): Promise<any> => {
      if (path === '/outbox/status') return { address: n.address, enabled: true, routes: { localInternet: 'connected' }, ...(http ? { inboxProtocol: 'automesh-inbox-v1' } : {}), fileQueue: { protocol: ATTACHMENT_PROTOCOL, maxFileBytes: FILE_POLICY_BYTES } };
      if (path === '/inbox/list') return { protocol: 'automesh-inbox-v1', cursor: '', deliveries: _address === b.address && stored && !receipt ? [{
        from: n.address, job: stored, hop: await signCourier('hop', { protocol: COURIER_PROTOCOL, courier: n.address, id, digest: await cipherDigest(stored.body.packet) }, n.identity)
      }] : [] };
      if (path === '/inbox/file/parts') {
        await verifyCourier(body.request, 'attachment-request', b.address);
        const index = body.request.body.index;
        return { id: body.request.body.id, parts: Array.from({ length: Math.min(4, encrypted.size - index) }, (_, i) => ({ index: index + i, cipher: base64(encrypted.get(index + i)!) })) };
      }
      if (path === '/inbox/ack') {
        expect(receiverCommitted.acks.find(ack => ack.id === id)?.receipt).toBe(body.receipt); receipt = body.receipt;
        return { acknowledged: true };
      }
      if (path === '/outbox/file/start') return { received: [...encrypted.keys()] };
      if (path === '/outbox/file/part') { encrypted.set(body.index, unbase64(body.cipher)); return { stored: body.index }; }
      if (path === '/outbox/put') { await verifyCourier(body.job, 'job', a.address); expect(encrypted.size).toBe(body.job.body.attachment.chunks); stored = structuredClone(body.job); return { status: 'stored' }; }
      if (path === '/outbox/receipts') return { receipts: receipt ? [{ receipt }] : [] };
      throw new Error('unexpected_request');
    };
    const sender = () => new CourierController({ ...a, state: () => sendState, update: s => { sendState = s as typeof sendState; }, chats: () => sending,
      persist: async () => true, receive: () => { throw new Error('unexpected_text'); }, delivery: (peer, mid, value) => { sending = setDeliveryStatus(sending, peer, mid, value); },
      publish: async () => {}, error: () => {}, request,
      files: { load: async () => original.slice(), offer: () => {}, accepted: () => false, progress: () => {}, complete: async () => {}, savePart: async () => {}, loadPart: async () => null, cleanup: async () => {} } });
    const receiver = () => new CourierController({ ...b, state: () => receiveState, update: s => { receiveState = s; }, chats: () => receiving,
      persist: async () => { receiverCommitted = restoreCourierState(receiveState); return true; }, receive: () => { throw new Error('unexpected_text'); },
      delivery: () => {}, publish: async () => {}, error: () => {}, ...(http ? { request } : {}),
      files: { load: async () => null, offer: (peer, offer, timestamp, courierVia) => {
        receiving = receiveFileMessage(receiving, { id: offer.id, from: peer, text: '', timestamp, direction: 'incoming', file: offer,
          details: offer.details, fileStatus: 'offered', courierVia });
      }, accepted: (peer, mid) => receiving.byPeer[peer]?.messages.some(m => m.id === mid && m.fileAccepted === true),
      progress: (peer, mid, bytes) => { const message = receiving.byPeer[peer].messages.find(m => m.id === mid)!; message.fileProgress = bytes; message.fileStatus = 'receiving'; },
      complete: async (peer, mid, bytes) => { completed = bytes.slice(); receiving.byPeer[peer].messages.find(m => m.id === mid)!.fileStatus = 'ready'; },
      savePart: async (_peer, _id, index, bytes) => { savedParts.set(index, bytes.slice()); }, loadPart: async (_peer, _id, index) => savedParts.get(index)?.slice() ?? null,
      cleanup: async () => { savedParts.clear(); } } });
    let source = sender(), target = receiver();
    try {
      const key = await generateCourierKey(a.address, Date.now() + 120000); receiveState.keys = [key];
      await source.accept(b.address, await signCourier('prekeys', { protocol: COURIER_PROTOCOL, from: b.address, to: a.address,
        expiresAt: key.expiresAt, attachmentProtocol: ATTACHMENT_PROTOCOL, maxFileBytes: FILE_POLICY_BYTES, keys: [{ id: key.id, publicKey: key.publicKey }] }, b.identity));
      await source.poll(); expect(stored).toBeNull(); expect(encrypted.size).toBe(8);
      const jobBefore = structuredClone(sendState.pending[0]);
      if (interruptedUpload) { source.stop(); sendState = restoreCourierState(sendState) as typeof sendState; source = sender(); }
      await source.poll(); expect(stored).toEqual(jobBefore); expect(sending.byPeer[b.address].messages[0].delivery).toBe('stored');
      source.stop(); // Sender remains locked throughout every receive/retry below.
      const job = stored as unknown as CourierJob;
      const hop = await signCourier('hop', { protocol: COURIER_PROTOCOL, courier: n.address, id, digest: await cipherDigest(job.body.packet) }, n.identity);
      const reply = Object.assign((_id: string, value: string) => {
        expect(receiverCommitted.acks.find(ack => ack.id === id)?.receipt).toBe(value); receipt = value;
      }, { chunk: async (value: any) => {
        await verifyCourier(value, 'attachment-request', b.address); expect(value.body.to).toBe(n.address);
        return encrypted.get(value.body.index)!.slice();
      } }) as CourierReply;
      if (http) await target.poll(); else await target.receive({ from: n.address, job, hop }, reply);
      const offers = automaticFileOffers(receiving, 0, 100 * 1024 * 1024, true);
      expect(offers.map(o => o.id)).toEqual([id]); // Both peers are offline; node offer still auto-accepts.
      receiving.byPeer[a.address].messages[0].fileAccepted = true;
      await target.poll(); expect(receipt).toBe(''); expect(savedParts.size).toBe(8); expect(completed).toBeNull();
      target.stop(); receiveState = restoreCourierState(receiverCommitted); receiving = restoreChats(saveChats(receiving)); target = receiver();
      if (!http) await target.receive({ from: n.address, job, hop }, reply); await target.poll();
      expect(completed).toEqual(original); expect(receipt).not.toBe(''); expect(receiveState.incomingFiles).toHaveLength(0);
      await verifyCourier(JSON.parse(receipt), 'receipt', b.address);
      expect(receiveState.keys).toHaveLength(0); expect(savedParts.size).toBe(0);
      expect(receiving.byPeer[a.address].messages).toHaveLength(1); expect(receiving.byPeer[a.address].messages[0].fileStatus).toBe('ready');
      source = sender(); await source.poll(); expect(sendState.pending).toHaveLength(0);
      expect(sending.byPeer[b.address].messages[0].delivery).toBe('delivered');
    } finally { source.stop(); target.stop(); await Promise.all([source.settled(), target.settled()]); }
  }, 15000);
});
