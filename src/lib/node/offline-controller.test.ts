import { describe, expect, it, vi } from 'vitest';
import { OfflineController } from './offline-controller';
import { emptyOfflineState } from './offline-state';
import { generatePrekey, keyId, signObject } from './offline-crypto';
import { WebCryptoIdentity } from '$lib/identity/webcrypto';
import { accountIdFromPublicKey } from '$lib/addressing/account-id.js';
import { emptySessionChats, ensureConversation, recordSentMessage, setContactState } from '$lib/chat/session-chats';

async function account() { const identity = new WebCryptoIdentity(); await identity.create();
  return { identity, address: await accountIdFromPublicKey(await identity.getPublicKeyBytes()) }; }
describe('prekey exhaustion and durable reservation', () => {
  it('LAN-only mode does not poll a stored public mailbox', async () => {
    const a = await account(), request = vi.fn();
    let state = { ...emptyOfflineState(), enabled: true, node: { url: 'https://node.automesh.space', nodeId: keyId() } };
    const worker = new OfflineController({ ...a, lanOnly: () => true, state: () => state, update: value => { state = value as typeof state; },
      chats: emptySessionChats, persist: async () => true, receive: () => {}, delivery: () => {}, publish: async () => {}, error: () => {}, request });
    try { await expect(worker.poll()).rejects.toThrow('internet_disabled'); expect(request).not.toHaveBeenCalled(); } finally { worker.stop(); }
  });
  it('uses each key once across descriptor replays, retries exact bytes, never falls back, rejects forged delivery', async () => {
    const [alice, bob] = await Promise.all([account(), account()]); const node = { url: 'https://localhost:3003', nodeId: keyId() };
    let state = emptyOfflineState(); let chats = setContactState(ensureConversation(emptySessionChats(), bob.address), bob.address, 'accepted');
    const ids = Array.from({ length: 3 }, () => crypto.randomUUID());
    for (const id of ids) chats = recordSentMessage(chats, bob.address, { id, from: alice.address, text: 'hello', timestamp: Date.now(), direction: 'outgoing', delivery: 'queued' });
    const uploads: string[] = []; let forge = false; let delivered = false;
    const worker = new OfflineController({ address: alice.address, identity: alice.identity, state: () => state,
      update: value => { state = value; }, chats: () => chats, persist: async () => true, receive: () => {},
      delivery: (_, __, status) => { if (status === 'delivered') delivered = true; }, publish: async () => {}, error: () => {},
      request: async (_url, _id, _identity, _address, path, body) => {
        if (path === '/mailbox/list') return { envelopes: [] };
        if (path === '/mailbox/put') { uploads.push((body as { ciphertext: string }).ciphertext); return { status: 'stored' }; }
        if (path === '/mailbox/receipts') return { receipts: forge ? [{ receipt: '{}' }] : [] };
        return {};
      } });
    try {
      await worker.configure(node, true); const expiresAt = Date.now() + 60000;
      const keys = await Promise.all([generatePrekey(alice.address, node.nodeId, expiresAt), generatePrekey(alice.address, node.nodeId, expiresAt)]);
      const bundle = await signObject({ version: 1 as const, from: bob.address, to: alice.address, node, expiresAt,
        keys: keys.map(({ id, publicKey }) => ({ id, publicKey })) }, 'prekeys', bob.identity);
      await worker.accept(bob.address, bundle); await worker.poll(); expect(state.pending).toHaveLength(2);
      expect(Object.keys(state.used)).toHaveLength(2); expect(state.pending.some(mail => mail.messageId === ids[2])).toBe(false);
      await worker.poll(); const initial = [...uploads]; await worker.accept(bob.address, bundle); await worker.poll();
      expect(uploads).toEqual([...initial, ...initial]); expect(state.pending).toHaveLength(2);
      forge = true; await expect(worker.poll()).rejects.toThrow('invalid_receipt'); expect(delivered).toBe(false); expect(state.pending).toHaveLength(2);
    } finally { worker.stop(); }
  });
});
