import { describe, expect, it } from 'vitest';
import { WebCryptoIdentity } from '$lib/identity/webcrypto';
import { accountIdFromPublicKey } from '$lib/addressing/account-id.js';
import { generatePrekey, keyId, openOffline, receiptFor, sealOffline, signObject, validateBundle, verifyObject,
  verifyReceipt, cipherDigest, base64, unbase64, type Signed, type MailBody } from './offline-crypto';
import { encodeChatContent } from '$lib/chat/message-details';

export async function account() {
  const identity = new WebCryptoIdentity(); const seed = crypto.getRandomValues(new Uint8Array(32)); await identity.fromSeed(seed);
  return { identity, seed, address: await accountIdFromPublicKey(await identity.getPublicKeyBytes()) };
}
describe('one-time offline HPKE', () => {
  it('authenticates metadata, message details, sender and signed receipt', async () => {
    const [alice, bob, evil] = await Promise.all([account(), account(), account()]);
    const node = { url: 'https://192.168.1.4:3003', nodeId: keyId() }; const expiresAt = Date.now() + 60000;
    const key = await generatePrekey(alice.address, node.nodeId, expiresAt);
    const bundle = await signObject({ version: 1 as const, from: bob.address, to: alice.address, node, expiresAt,
      keys: [{ id: key.id, publicKey: key.publicKey }] }, 'prekeys', bob.identity);
    validateBundle(bundle, bob.address, alice.address); await verifyObject(bundle, 'prekeys', bob.address);
    const id = crypto.randomUUID(); const content = encodeChatContent('hello', { contactCard: { accountId: alice.address, nickname: 'Alice' } });
    const ciphertext = await sealOffline(alice.identity, alice.address, bundle, key, id, Date.now(), content);
    const opened = await openOffline(ciphertext, key, bob.address, node.nodeId, id.replaceAll('-', ''), expiresAt);
    expect(opened.content).toBe(content);
    const receipt = await receiptFor(opened.packet, ciphertext, bob.identity);
    const expected = { version: 1 as const, from: bob.address, to: alice.address, id, nodeId: node.nodeId, digest: await cipherDigest(ciphertext) };
    await verifyReceipt(receipt, expected);
    await expect(verifyReceipt(await receiptFor(opened.packet, ciphertext, evil.identity), expected)).rejects.toThrow('invalid_offline_signature');
    await expect(openOffline(ciphertext, key, alice.address, node.nodeId, id.replaceAll('-', ''), expiresAt)).rejects.toThrow();
    await expect(openOffline(ciphertext, key, bob.address, keyId(), id.replaceAll('-', ''), expiresAt)).rejects.toThrow();
    const packet: Signed<MailBody> = JSON.parse(new TextDecoder().decode(unbase64(ciphertext)));
    packet.body.timestamp++;
    await expect(openOffline(base64(new TextEncoder().encode(JSON.stringify(packet))), key, bob.address, node.nodeId, id.replaceAll('-', ''), expiresAt)).rejects.toThrow('invalid_offline_signature');
    const otherKey = await generatePrekey(alice.address, node.nodeId, expiresAt);
    await expect(openOffline(ciphertext, { ...otherKey, id: key.id }, bob.address, node.nodeId, id.replaceAll('-', ''), expiresAt)).rejects.toThrow();
  });
  it('accepts signed public endpoints but rejects unsafe URLs, duplicate keys, expired bundles and another sender allocation', async () => {
    const [alice, bob] = await Promise.all([account(), account()]); const node = { url: 'https://localhost:3003', nodeId: keyId() };
    const expiresAt = Date.now() + 60000; const key = await generatePrekey(alice.address, node.nodeId, expiresAt);
    const bundle = await signObject({ version: 1 as const, from: bob.address, to: alice.address, node, expiresAt, keys: [key] }, 'prekeys', bob.identity);
    expect(() => validateBundle(bundle, bob.address, bob.address)).toThrow();
    expect(() => validateBundle({ ...bundle, body: { ...bundle.body, keys: [key, key] } }, bob.address, alice.address)).toThrow();
    const publicBundle = await signObject({ ...bundle.body, node: { ...node, url: 'https://node.automesh.space' } }, 'prekeys', bob.identity);
    expect(() => validateBundle(publicBundle, bob.address, alice.address)).not.toThrow();
    await verifyObject(publicBundle, 'prekeys', bob.address);
    await expect(verifyObject({ ...publicBundle, body: { ...publicBundle.body, node: { ...node, url: 'https://clone.example' } } }, 'prekeys', bob.address)).rejects.toThrow();
    expect(() => validateBundle({ ...bundle, body: { ...bundle.body, node: { ...node, url: 'http://node.example' } } }, bob.address, alice.address)).toThrow();
    expect(() => validateBundle(bundle, bob.address, alice.address, expiresAt)).toThrow();
  });
});
