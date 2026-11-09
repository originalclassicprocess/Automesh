import { beforeAll, describe, expect, it } from 'vitest';
import { createCore } from './index';
import { WebCryptoIdentity } from '../identity/webcrypto';
import { accountIdFromPublicKey } from '../addressing/account-id.js';
import { buildPayload, buildSignInput } from '../message/envelope';
import type { TransportMessage } from '../message/types';
const NOW = 1_800_000_000_000;
let alice: WebCryptoIdentity, publicKey: Uint8Array, from: string, to: string;
beforeAll(async () => {
  alice = new WebCryptoIdentity(); const seed = new Uint8Array(32); seed[31] = 1;
  await alice.fromSeed(seed); publicKey = await alice.getPublicKeyBytes(); from = await accountIdFromPublicKey(publicKey);
  const bob = new WebCryptoIdentity(); seed[31] = 2; await bob.fromSeed(seed);
  to = await accountIdFromPublicKey(await bob.getPublicKeyBytes()); bob.dispose(); seed.fill(0);
});
const core = () => createCore({ environment: { subtle: crypto.subtle, now: () => NOW, newId: () => crypto.randomUUID() } });
async function envelope(): Promise<TransportMessage> {
  const frame = new Uint8Array([1, 2, 3]);
  return { from, to, timestamp: NOW, messageId: 'legacy-id', ttl: 7, payload: buildPayload(publicKey, frame),
    signature: await alice.sign(buildSignInput(frame, NOW, 'legacy-id', from, to)) };
}
describe('legacy signed envelope authentication', () => {
  it('keeps the existing protocol and returns copies, not decrypted plaintext', async () => {
    const msg = await envelope(), verified = await core().verifyEnvelope(msg, to);
    expect(verified.from).toBe(from); expect(verified.to).toBe(to);
    expect(verified.encryptedFrame).toEqual(new Uint8Array([1, 2, 3])); expect(verified.publicKey).toEqual(publicKey);
    msg.payload.fill(0); expect(verified.encryptedFrame).toEqual(new Uint8Array([1, 2, 3]));
  });
  it('rejects forged author, wrong recipient, changed ID/time/ciphertext and malformed keys/signatures', async () => {
    const original = await envelope();
    for (const change of [{ from: to }, { to: from }, { messageId: 'changed' }, { timestamp: NOW + 1 },
      { timestamp: 1.5 }, { timestamp: NOW + 300_001 }, { signature: new Uint8Array(64) },
      { signature: new Uint8Array(63) }, { payload: buildPayload(new Uint8Array(32), new Uint8Array([1])) },
      { payload: buildPayload(publicKey, new Uint8Array([3, 2, 1])) }])
      await expect(core().verifyEnvelope({ ...original, ...change }, to)).rejects.toThrow();
    await expect(core().verifyEnvelope(original, from)).rejects.toThrow('invalid_signed_envelope');
  });
  it('snapshots incoming bytes/metadata before awaiting verification and bounds allocation', async () => {
    const msg = await envelope(), pending = core().verifyEnvelope(msg, to);
    msg.from = to; msg.messageId = 'changed'; msg.signature.fill(0); msg.payload.fill(0);
    const result = await pending; expect(result.from).toBe(from); expect(result.messageId).toBe('legacy-id');
    expect(result.timestamp).toBe(NOW); expect(result.encryptedFrame).toEqual(new Uint8Array([1, 2, 3]));
    const original = await envelope();
    await expect(core().verifyEnvelope({ ...original, payload: new Uint8Array(256 * 1024 + 1) }, to)).rejects.toThrow('invalid_signed_envelope');
    await expect(core().verifyEnvelope(original, to, 68)).rejects.toThrow('invalid_signed_envelope');
  });
});
