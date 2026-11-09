import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createHomeNode } from './application.js';
import { testProtector } from './test-protection.fixture.js';
const secretProtector = testProtector();
import { WebCryptoIdentity } from '$lib/identity/webcrypto';
import { accountIdFromPublicKey } from '$lib/addressing/account-id.js';
import { OfflineController } from '../../src/lib/node/offline-controller';
import { emptyOfflineState, restoreOfflineState, type OfflineState } from '../../src/lib/node/offline-state';
import { signedNodeRequest } from '../../src/lib/node/client';
import { emptySessionChats, ensureConversation, receiveMessage, recordSentMessage, setContactState, setDeliveryStatus, type SessionChats } from '$lib/chat/session-chats';
import { deriveChatStoreKey, sealChatData, openSealedChatData, type LocalChatData } from '$lib/chat/local-store';
import type { Bundle, NodeAddress } from '../../src/lib/node/offline-crypto';

const nativeFetch = globalThis.fetch;
let directory = ''; let server: Awaited<ReturnType<typeof createHomeNode>> | undefined;
const workers: OfflineController[] = [];
async function account() {
  const identity = new WebCryptoIdentity(); const seed = crypto.getRandomValues(new Uint8Array(32)); await identity.fromSeed(seed);
  return { identity, seed, address: await accountIdFromPublicKey(await identity.getPublicKeyBytes()) };
}
async function start(port = 0) {
  if (!directory) directory = await mkdtemp(join(tmpdir(), 'automesh-offline-e2e-'));
  const hosts = ['127.0.0.1:0'];
  server = await createHomeNode({ directory, hosts, origins: ['http://localhost:5173'], adminToken: 'a'.repeat(64), testHttp: true, secretProtector });
  const listener = server.createPublicServer(); listener.listen(port, '127.0.0.1'); await once(listener, 'listening');
  const actualPort = (listener.address() as { port: number }).port; hosts.push(`127.0.0.1:${actualPort}`);
  return { node: { url: `https://127.0.0.1:${actualPort}`, nodeId: server.state.value.nodeId }, port: actualPort };
}
function client(who: Awaited<ReturnType<typeof account>>, peer: string, node: NodeAddress) {
  let state = emptyOfflineState(); let chats = setContactState(ensureConversation(emptySessionChats(), peer), peer, 'accepted');
  let disk: OfflineState = state; let failSave = false; let peerWorker: OfflineController;
  let bundle: Bundle | undefined;
  const worker = new OfflineController({ address: who.address, identity: who.identity, state: () => state, update: value => { state = value; },
    chats: () => chats, persist: async () => { if (failSave) return false; disk = structuredClone(state); return true; },
    receive: msg => { chats = receiveMessage(chats, { id: msg.id, text: msg.text, timestamp: msg.timestamp, from: msg.from,
      direction: 'incoming', ...(msg.details ? { details: msg.details } : {}) }); },
    delivery: (peer, id, status) => { chats = setDeliveryStatus(chats, peer, id, status); },
    publish: async (peer, value) => { bundle = value; await peerWorker.accept(who.address, value); }, error: () => {},
  }); workers.push(worker);
  return { worker, state: () => state, disk: () => disk, chats: () => chats, bundle: () => bundle,
    connect: (other: OfflineController) => { peerWorker = other; }, failSave: (value: boolean) => { failSave = value; },
    send: (text: string) => { const id = crypto.randomUUID(); chats = recordSentMessage(chats, peer, { id, text,
      from: who.address, timestamp: Date.now(), direction: 'outgoing', delivery: 'queued' }); return id; },
    reload: () => { state = restoreOfflineState(disk); },
    restore: (saved: OfflineState, savedChats: SessionChats) => { state = restoreOfflineState(saved); chats = savedChats; },
    configure: () => worker.configure(node, true) };
}
afterEach(async () => { for (const worker of workers.splice(0)) worker.stop(); await server?.close(); server = undefined;
  if (directory) await rm(directory, { recursive: true, force: true }); directory = ''; vi.unstubAllGlobals(); });

describe('offline delivery with a real authenticated persistent node', () => {
  it('delivers after sender disconnect, node/client restart; erases key and verifies receipt without receiver online', async () => {
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => nativeFetch(url.replace(/^https:/, 'http:'), init));
    const [alice, bob] = await Promise.all([account(), account()]); let { node, port } = await start();
    const request = (who: typeof alice, path: string, data = {}) => signedNodeRequest(node.url, node.nodeId, who.identity, who.address, path, data, new AbortController().signal);
    // Pair separate mailboxes to the same physical PC with separate local invitations.
    await request(alice, '/node/join', { code: '' }).then(() => { throw new Error('unexpected_join'); }, () => {});
    const control = server!.control; control.listen(0, '127.0.0.1'); await once(control, 'listening');
    const admin = `http://127.0.0.1:${(control.address() as { port: number }).port}`;
    const code = async () => (await (await nativeFetch(`${admin}/pair-code`, { method: 'POST', headers: { Authorization: `Bearer ${'a'.repeat(64)}` } })).json()).pairCode;
    await request(alice, '/node/join', { code: await code() }); await request(bob, '/node/join', { code: await code() });
    const a = client(alice, bob.address, node), b = client(bob, alice.address, node); a.connect(b.worker); b.connect(a.worker);
    await a.configure(); await b.configure(); await a.worker.publish(bob.address); await b.worker.publish(alice.address);
    const originalBundle = b.bundle()!;
    const id = a.send('Получите завтра');
    await a.worker.poll(); expect(a.state().pending).toHaveLength(1); const used = Object.keys(a.state().used)[0];
    await a.worker.accept(bob.address, originalBundle); expect(a.state().used[used]).toBeDefined(); // replay cannot reset allocation
    await a.worker.poll(); expect(a.chats().byPeer[bob.address].messages[0].delivery).toBe('stored');
    expect((await request(alice, '/mailbox/list') as { envelopes: unknown[] }).envelopes).toEqual([]); // mailbox isolation
    // Sender no longer runs; node restarts on the same endpoint.
    a.worker.stop(); await server!.close(); ({ node } = await start(port));
    b.reload(); const before = b.state().keys.length; await b.worker.poll();
    expect(b.chats().byPeer[alice.address].messages).toHaveLength(1);
    expect(b.chats().byPeer[alice.address].messages[0]).toMatchObject({ id, text: 'Получите завтра' });
    expect(b.disk().keys).toHaveLength(before - 1); expect(b.state().keys.some(key => key.id === used)).toBe(false);
    await b.worker.poll(); expect(b.chats().byPeer[alice.address].messages).toHaveLength(1);
    // Private prekeys and replay tombstones survive only in authenticated encrypted account storage.
    const key = await deriveChatStoreKey(bob.seed, bob.address);
    const data: LocalChatData = { selfNickname: '', readReceiptsEnabled: true, autoLockMinutes: 5,
      peerReadPreferences: {}, aliases: {}, declaredNames: {}, peerPublicKeys: {}, chats: { order: [], byPeer: {} }, offlineState: b.disk() };
    const record = await sealChatData(key, bob.address, data); const reopened = await openSealedChatData(key, bob.address, record);
    expect(reopened.offlineState?.keys.some(item => item.id === used)).toBe(false);
    expect(reopened.offlineState?.acks[0].id).toBe(id.replaceAll('-', ''));
    // Receiver can now be shut down; sender fetches recipient-signed receipt independently.
    b.worker.stop();
    const retry = client(alice, bob.address, node); // restore sender's committed ciphertext, not a new encryption
    const saved = a.disk();
    retry.restore(saved, a.chats());
    await retry.worker.poll(); expect(retry.chats().byPeer[bob.address].messages[0].delivery).toBe('delivered'); expect(retry.state().pending).toEqual([]);
  });
  it('never uploads an uncommitted reservation and stops mutation after lock', async () => {
    const [alice, bob] = await Promise.all([account(), account()]);
    let state = emptyOfflineState(); let chats = setContactState(ensureConversation(emptySessionChats(), bob.address), bob.address, 'accepted');
    const node = { url: 'https://localhost:3003', nodeId: 'a'.repeat(32) }; let commits = true; const calls: string[] = [];
    const worker = new OfflineController({ address: alice.address, identity: alice.identity, state: () => state, update: value => { state = value; },
      chats: () => chats, persist: async () => commits, receive: () => {}, delivery: () => {}, publish: async () => {}, error: () => {},
      request: async (_url, _id, _identity, _address, path) => { calls.push(path); return path === '/mailbox/list' ? { envelopes: [] } : {}; } }); workers.push(worker);
    await worker.configure(node, true); commits = false;
    await expect(worker.poll()).rejects.toThrow('offline_not_saved'); expect(calls).not.toContain('/mailbox/put');
    worker.stop(); const previous = state; await expect(worker.configure(node, false)).rejects.toThrow('offline_session_closed'); expect(state).toBe(previous);
  });
});
