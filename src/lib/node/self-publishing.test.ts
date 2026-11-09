import { expect, it, vi } from 'vitest';
import { CourierController } from './courier-controller';
import { OfflineController } from './offline-controller';
import { emptyCourierState } from './courier-state';
import { emptyOfflineState } from './offline-state';
import { WebCryptoIdentity } from '../identity/webcrypto';
import { accountIdFromPublicKey } from '../addressing/account-id.js';
import { emptySessionChats, setContactState } from '../chat/session-chats';

it.each(['courier', 'mailbox'])('%s skips self publication and does not stall the next contact', async kind => {
  const identity = new WebCryptoIdentity(), other = new WebCryptoIdentity(); await identity.create(); await other.create();
  const address = await accountIdFromPublicKey(await identity.getPublicKeyBytes()), peer = await accountIdFromPublicKey(await other.getPublicKeyBytes());
  const chats = setContactState(setContactState(emptySessionChats(), address, 'accepted'), peer, 'accepted');
  const publish = vi.fn(async () => {}), request = vi.fn(async () => ({})), base = { address, identity, chats: () => chats,
    persist: async () => true, receive: () => {}, delivery: () => {}, publish, request, error: () => {} };
  let courier = emptyCourierState(), mailbox = { ...emptyOfflineState(), enabled: true, node: { url: 'https://node.example', nodeId: '1'.repeat(32) } };
  const worker = kind === 'courier' ? new CourierController({ ...base, state: () => courier, update: value => courier = value })
    : new OfflineController({ ...base, state: () => mailbox, update: value => mailbox = value as typeof mailbox });
  try {
    await worker.publish(address); expect(publish).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled();
    expect(courier.keys).toHaveLength(0); expect(mailbox.keys).toHaveLength(0);
    await worker.publish(peer); expect(publish).toHaveBeenCalledOnce();
    expect((kind === 'courier' ? courier.keys : mailbox.keys).every(key => key.peer === peer)).toBe(true);
  } finally { worker.stop(); await worker.settled(); identity.dispose(); other.dispose(); }
});
