import { describe, it, expect, vi } from 'vitest';
import { WebCryptoIdentity } from '$lib/identity/webcrypto';
import { accountIdFromPublicKey } from '$lib/addressing/account-id.js';
import { createCourierJob, generateCourierKey, openCourier, signCourier, verifyCourier, validateCourierBundle } from './courier-crypto';
import { COURIER_PROTOCOL, courierRelayUrl } from './courier-protocol.js';
import { cipherDigest, base64, unbase64 } from './offline-crypto';
import { emptyCourierState, restoreCourierState } from './courier-state';
import { ATTACHMENT_PROTOCOL, FILE_POLICY_BYTES } from './attachment-protocol.js';
async function account() { const identity = new WebCryptoIdentity(); await identity.create();
  return { identity, address: await accountIdFromPublicKey(await identity.getPublicKeyBytes()) }; }
describe('personal courier cryptographic boundaries', () => {
  it('opens an existing envelope when WebCrypto refuses private-only EC PKCS8 imports', async () => {
    const [a,b,n]=await Promise.all([account(),account(),account()]),expiresAt=Date.now()+60000;
    const key=await generateCourierKey(a.address,expiresAt);
    const bundle=await signCourier('prekeys',{protocol:COURIER_PROTOCOL,from:b.address,to:a.address,expiresAt,keys:[{id:key.id,publicKey:key.publicKey}]},b.identity);
    const id=crypto.randomUUID(),job=await createCourierJob(a.identity,a.address,n.address,bundle,key,id,Date.now(),'portable private import');
    const hop=await signCourier('hop',{protocol:COURIER_PROTOCOL,courier:n.address,id,digest:await cipherDigest(job.body.packet)},n.identity);
    const native=crypto.subtle.importKey.bind(crypto.subtle),formats:string[]=[];
    const importing=vi.spyOn(crypto.subtle,'importKey').mockImplementation((...args:any[])=>{
      const [format,,algorithm]=args;
      if(algorithm?.name==='ECDH'){formats.push(format);if(format==='pkcs8')return Promise.reject(new DOMException('Private-only EC import is unsupported','DataError'));}
      return (native as any)(...args);
    });
    try{
      expect((await openCourier(job,hop,restoreCourierState({...emptyCourierState(),keys:[key]}).keys[0],b.address)).content).toBe('portable private import');
      expect(formats).toContain('jwk');expect(formats).not.toContain('pkcs8');
    }finally{importing.mockRestore();a.identity.dispose();b.identity.dispose();n.identity.dispose();}
  });
  it('accepts bounded future file capabilities without changing old text prekeys', async () => {
    const [a, b] = await Promise.all([account(), account()]); const expiresAt = Date.now() + 60000;
    const key = await generateCourierKey(a.address, expiresAt);
    const bundle = await signCourier('prekeys', { protocol: COURIER_PROTOCOL, from: b.address, to: a.address, expiresAt,
      attachmentProtocol: ATTACHMENT_PROTOCOL, maxFileBytes: FILE_POLICY_BYTES * 2, keys: [{ id: key.id, publicKey: key.publicKey }] }, b.identity);
    expect(validateCourierBundle(bundle, b.address, a.address)).toEqual(bundle); await verifyCourier(bundle, 'prekeys', b.address);
    const future = { ...bundle, body: { ...bundle.body, attachmentProtocol: 'automesh-attachment-v2' } };
    expect(validateCourierBundle(future, b.address, a.address)).toEqual(future);
    expect(() => validateCourierBundle({ ...bundle, body: { ...bundle.body, maxFileBytes: Number.MAX_SAFE_INTEGER } }, b.address, a.address)).toThrow();
  });
  it('binds author, recipient, allocated key and authorized courier independently', async () => {
    const [a, b, n, evil] = await Promise.all([account(), account(), account(), account()]); const expiresAt = Date.now() + 60000;
    const key = await generateCourierKey(a.address, expiresAt);
    const bundle = await signCourier('prekeys', { protocol: COURIER_PROTOCOL, from: b.address, to: a.address, expiresAt,
      keys: [{ id: key.id, publicKey: key.publicKey }] }, b.identity);
    validateCourierBundle(bundle, b.address, a.address); await verifyCourier(bundle, 'prekeys', b.address);
    const id = crypto.randomUUID(); const job = await createCourierJob(a.identity, a.address, n.address, bundle, key, id, Date.now(), 'hello');
    const hop = await signCourier('hop', { protocol: COURIER_PROTOCOL, courier: n.address, id, digest: await cipherDigest(job.body.packet) }, n.identity);
    expect((await openCourier(job, hop, key, b.address)).content).toBe('hello');
    await expect(openCourier({ ...job, body: { ...job.body, from: evil.address } }, hop, key, b.address)).rejects.toThrow();
    await expect(openCourier({ ...job, body: { ...job.body, courier: evil.address } }, hop, key, b.address)).rejects.toThrow();
    await expect(openCourier(job, { ...hop, body: { ...hop.body, digest: '0'.repeat(64) } }, key, b.address)).rejects.toThrow();
    await expect(openCourier(job, await signCourier('hop', hop.body, evil.identity), key, b.address)).rejects.toThrow();
    await expect(openCourier(job, hop, key, a.address)).rejects.toThrow();
    const changed = JSON.parse(new TextDecoder().decode(unbase64(job.body.packet))); changed.body.timestamp++;
    const tampered = await signCourier('job', { ...job.body, packet: base64(new TextEncoder().encode(JSON.stringify(changed))) }, a.identity);
    const newHop = await signCourier('hop', { ...hop.body, digest: await cipherDigest(tampered.body.packet) }, n.identity);
    await expect(openCourier(tampered, newHop, key, b.address)).rejects.toThrow('invalid_courier_signature');
    // A courier cannot manufacture an author's permission, even with its own valid hop.
    await expect(openCourier(await signCourier('job', job.body, n.identity), hop, key, b.address)).rejects.toThrow('invalid_courier_signature');
    await expect(openCourier(job, hop, { ...key, privateKey: (await generateCourierKey(a.address, expiresAt)).privateKey }, b.address)).rejects.toThrow();
    await expect(openCourier({ ...job, body: { ...job.body, expiresAt: Date.now() - 1 } }, hop, key, b.address)).rejects.toThrow();
  });
  it('does not accept public plaintext relays or damaged private state', () => {
    expect(courierRelayUrl('wss://relay.example/signal')).toBe('wss://relay.example/signal');
    for (const url of ['ws://relay.example/signal', 'wss://user:pass@relay.example/signal', 'wss://relay.example/signal?x=1', 'https://relay.example/signal'])
      expect(() => courierRelayUrl(url)).toThrow();
    expect(restoreCourierState(undefined)).toEqual(emptyCourierState());
    expect(() => restoreCourierState({ ...emptyCourierState(), keys: [{}] })).toThrow();
  });
  it('supports the existing 64 KiB message limit without oversized node records', async () => {
    const [a, b, n] = await Promise.all([account(), account(), account()]); const expiresAt = Date.now() + 60000;
    const key = await generateCourierKey(a.address, expiresAt);
    const bundle = await signCourier('prekeys', { protocol: COURIER_PROTOCOL, from: b.address, to: a.address, expiresAt,
      keys: [{ id: key.id, publicKey: key.publicKey }] }, b.identity);
    const text = 'x'.repeat(65536); const id = crypto.randomUUID();
    const job = await createCourierJob(a.identity, a.address, n.address, bundle, key, id, Date.now(), text);
    expect(new TextEncoder().encode(JSON.stringify(job)).length).toBeLessThan(128 * 1024);
    const hop = await signCourier('hop', { protocol: COURIER_PROTOCOL, courier: n.address, id, digest: await cipherDigest(job.body.packet) }, n.identity);
    expect((await openCourier(job, hop, key, b.address)).content).toBe(text);
    await expect(createCourierJob(a.identity, a.address, n.address, bundle, key, crypto.randomUUID(), Date.now(), `${text}x`)).rejects.toThrow('courier_message_too_large');
  });
});
