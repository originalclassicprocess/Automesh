import { describe, expect, it } from 'vitest';
import { createHash, webcrypto } from 'node:crypto';
import { NodeAuth } from './auth.js';
import { nodeProofBytes } from '../../src/lib/node/protocol.js';
import { accountIdFromPublicKey } from '../../src/lib/addressing/account-id.js';

const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
const publicBytes = new Uint8Array(await webcrypto.subtle.exportKey('raw', pair.publicKey));
const address = await accountIdFromPublicKey(publicBytes, webcrypto.subtle);
const body = Buffer.from('{}'), path = '/mailbox/status', digest = createHash('sha256').update(body).digest('hex');
async function proof(auth, signNode = auth.nodeId) {
  const { challenge } = auth.issue({ address, method: 'POST', path, digest });
  return { address, challenge, publicKey: Buffer.from(publicBytes).toString('hex'), signature: Buffer.from(await webcrypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, nodeProofBytes(signNode, address, challenge, 'POST', path, digest))).toString('hex') };
}
describe('node proof authentication', () => {
  it('rejects expired proofs and cross-node signatures', async () => {
    let now = 1000; const auth = new NodeAuth('a'.repeat(32), () => now); const value = await proof(auth);
    now += 30_000; await expect(auth.verify(value, 'POST', path, body)).rejects.toThrow('unauthorized');
    await expect(auth.verify(await proof(auth, 'b'.repeat(32)), 'POST', path, body)).rejects.toThrow('unauthorized');
  });
  it('consumes a nonce before concurrent verification, not after it', async () => {
    const auth = new NodeAuth('a'.repeat(32)); const value = await proof(auth);
    const results = await Promise.allSettled([auth.verify(value, 'POST', path, body), auth.verify(value, 'POST', path, body)]);
    expect(results.map(item => item.status).sort()).toEqual(['fulfilled', 'rejected']);
  });
  it('bounds challenge memory and expires old anonymous challenges', () => {
    let now = 1000; const auth = new NodeAuth('a'.repeat(32), () => now);
    for (let i = 0; i < 256; i++) auth.issue({ address, method: 'POST', path, digest, ignored: 'large unrelated data' });
    expect(() => auth.issue({ address, method: 'POST', path, digest })).toThrow('too_many_challenges');
    expect([...auth.challenges.values()][0].ignored).toBeUndefined();
    now += 30_000; expect(auth.issue({ address, method: 'POST', path, digest }).challenge).toHaveLength(64);
  });
  it('checks Account ID against the signing public key', async () => {
    const auth = new NodeAuth('a'.repeat(32)); const value = await proof(auth);
    const other = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
    value.publicKey = Buffer.from(await webcrypto.subtle.exportKey('raw', other.publicKey)).toString('hex');
    await expect(auth.verify(value, 'POST', path, body)).rejects.toThrow('unauthorized');
  });
});
