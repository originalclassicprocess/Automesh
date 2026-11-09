import { expect, it } from 'vitest';
import { WebCryptoIdentity } from '../identity/webcrypto';
import { accountIdFromPublicKey } from '../addressing/account-id.js';
import type { CoreRecordStore, SealedCoreRecord } from '../core/durable-state';
import { canonicalJson } from '../core/canonical';
import { base64 } from '../node/offline-crypto';
import { encryptedDeviceJournal } from './journal';
import { newDevicePrekey, sealDeviceMail } from './node-mail-crypto';
import { createDeviceNodeMail } from './node-mail';
import { DEVICE_MAIL_TTL } from '../../../nodes/packages/protocol/src/devices.js';

it('reclaims only node-confirmed receipt slots before receiving message 257', async () => {
  const signer = new WebCryptoIdentity(), sender = new WebCryptoIdentity();
  const seed = crypto.getRandomValues(new Uint8Array(32)), other = crypto.getRandomValues(new Uint8Array(32));
  await signer.fromSeed(seed); await sender.fromSeed(other); seed.fill(0); other.fill(0);
  const owner = await accountIdFromPublicKey(await signer.getPublicKeyBytes()), from = await accountIdFromPublicKey(await sender.getPublicKeyBytes());
  const authority = { nodeId: '1'.repeat(32), publicKey: 'fixture', url: 'https://node.example' };
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const saved = new Map<string, SealedCoreRecord>();
  const records: CoreRecordStore = { async read(scope) { return saved.get(scope); }, async compareAndSwap(scope, revision, next) {
    if ((saved.get(scope)?.revision ?? null) !== revision) return false; saved.set(scope, structuredClone(next)); return true;
  } };
  const guard = () => {}, expiresAt = Date.now() + DEVICE_MAIL_TTL - 1000, prekey = await newDevicePrekey(expiresAt);
  const id = 'a'.repeat(32), eventId = crypto.randomUUID();
  const packet = JSON.stringify({ kind: 'message', event: { from, id: eventId } });
  const mail = await sealDeviceMail({ nodeId: authority.nodeId, from, fromOwner: from, toOwner: owner, toDevice: owner,
    id, eventId, keyId: prekey.id, expiresAt }, prekey.publicKey,
    JSON.stringify({ protocol: 'automesh-device-mail-content-v2', packet, senderPolicy: {} }), sender);
  const journal = encryptedDeviceJournal<any>({ scope: owner, purpose: 'offline-mail', key, records, guard,
    initial: () => ({ schema: 2, keys: [prekey], bundles: [], pending: [], receipts: [] }), validate: () => {} });
  await journal.change(state => { state.receipts = Array.from({ length: 256 }, (_, index) => ({ id: index.toString(16).padStart(32, '0'),
    expiresAt, signed: {}, confirmed: true })); });
  let delivered = 0, acknowledgements = 0;
  const client = createDeviceNodeMail({ owner, device: owner, identity: signer, key, records, guard, authority: () => authority, policy: () => undefined,
    async request(_authority, path) {
      if (path === '/devices/list') return { envelopes: [{ id, sender: from, expiresAt,
        ciphertext: base64(new TextEncoder().encode(canonicalJson(mail))) }] };
      if (path === '/devices/ack') { acknowledgements++; return { acknowledged: 1 }; }
      return { published: true };
    }, async receive(physical, value) {
      expect(physical).toBe(from); expect(value).toBe(packet); delivered++;
      await client.sendEncrypted(from, JSON.stringify({ kind: 'ack', id: eventId }));
    } });
  try {
    await client.poll(); const state = await client.inspect();
    expect(delivered).toBe(1); expect(acknowledgements).toBe(1); expect(state.receipts).toHaveLength(256);
    expect(state.receipts.some(receipt => receipt.id === '0'.repeat(32))).toBe(false);
    expect(state.receipts.find(receipt => receipt.id === id)?.confirmed).toBe(true);
    expect(state.keys.some(value => value.id === prekey.id)).toBe(false);
    await client.poll(); expect(delivered).toBe(1); expect(acknowledgements).toBe(2);
  } finally { await client.stop(); journal.close(); signer.dispose(); sender.dispose(); }
});
