import { describe, expect, it, vi } from 'vitest';
import type {CommittedIncoming} from '$lib/chat/committed-incoming';
import {encodeChatContent} from '$lib/chat/message-details';
import { OfflineController } from './offline-controller';
import { emptyOfflineState } from './offline-state';
import { generatePrekey, keyId, sealOffline, signObject } from './offline-crypto';
import { WebCryptoIdentity } from '$lib/identity/webcrypto';
import { accountIdFromPublicKey } from '$lib/addressing/account-id.js';
import { emptySessionChats, ensureConversation, receiveMessage, recordSentMessage, setContactState } from '$lib/chat/session-chats';

async function account() { const identity = new WebCryptoIdentity(); await identity.create();
  return { identity, address: await accountIdFromPublicKey(await identity.getPublicKeyBytes()) }; }
describe('prekey exhaustion and durable reservation', () => {
  it('emits an authenticated mailbox event only after commit, never on duplicate delivery', async () => {
    const [alice, bob] = await Promise.all([account(), account()]);
    const node = { url: 'https://localhost:3003', nodeId: keyId() }, expiresAt = Date.now() + 60000;
    const key = await generatePrekey(alice.address, node.nodeId, expiresAt);
    const bundle = await signObject({ version: 1 as const, from: bob.address, to: alice.address, node, expiresAt, keys: [{ id: key.id, publicKey: key.publicKey }] }, 'prekeys', bob.identity);
    const id = crypto.randomUUID(), ciphertext = await sealOffline(alice.identity, alice.address, bundle, key, id, Date.now(), encodeChatContent('/ai hello'));
    let state = { ...emptyOfflineState(), enabled: true, node, keys: [key] };
    let chats = setContactState(ensureConversation(emptySessionChats(), alice.address), alice.address, 'accepted');
    let committed = false; const incoming: CommittedIncoming[] = [];
    const worker = new OfflineController({ ...bob, state: () => state, update: value => { state = value as typeof state; }, chats: () => chats,
      persist: async () => { committed = state.acks.some(ack => ack.id === id.replaceAll('-', '')) && chats.byPeer[alice.address].messages.some(m => m.id === id); return true; },
      receive: m => { chats = receiveMessage(chats, { ...m, direction: 'incoming' }); },
      committedIncoming: event => { if (committed) incoming.push(event); }, delivery: () => {}, publish: async () => {}, error: () => {},
      request: async (_url, _node, _identity, _address, path) => path === '/mailbox/list' ? { envelopes: [{ id: id.replaceAll('-', ''), sender: alice.address, ciphertext, expiresAt }] } : {} });
    try {
      await worker.poll(); await worker.poll();
      expect(incoming).toEqual([{ peer: alice.address, id, transport: 'mailbox' }]);
      expect(chats.byPeer[alice.address].messages).toHaveLength(1);
    } finally { worker.stop(); alice.identity.dispose(); bob.identity.dispose(); }
  });

  it('coalesces foreground wakes, retries a wake during failure and cannot restart after lock',async()=>{
    vi.useFakeTimers();let reject!:(error:Error)=>void;
    const worker=new OfflineController({address:'me',identity:{} as any,state:emptyOfflineState,update:()=>{},chats:emptySessionChats,
      persist:async()=>true,receive:()=>{},delivery:()=>{},publish:async()=>{},error:()=>{}});
    const poll=vi.spyOn(worker,'poll').mockImplementationOnce(()=>new Promise<void>((_resolve,fail)=>{reject=fail;})).mockResolvedValue();
    try{
      worker.start();worker.start();for(let i=0;i<20;i++)worker.wake();
      await vi.advanceTimersByTimeAsync(50);expect(poll).toHaveBeenCalledTimes(1);
      worker.wake();reject(Error('network_changed'));await vi.advanceTimersByTimeAsync(50);expect(poll).toHaveBeenCalledTimes(2);
      worker.stop();worker.wake();worker.start();await vi.advanceTimersByTimeAsync(30000);expect(poll).toHaveBeenCalledTimes(2);
    }finally{worker.stop();vi.useRealTimers();}
  });
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
