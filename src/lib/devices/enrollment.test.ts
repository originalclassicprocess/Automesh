import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { WebCryptoIdentity } from '$lib/identity/webcrypto';
import { accountIdFromPublicKey } from '$lib/addressing/account-id.js';
import { MemoryReplayStore, type CoreEnvironment } from '$lib/core/ports';
import { createDeviceRequest, verifyDeviceRequest, approveDeviceRequest, verifyDeviceCertificate,
  createDeviceProof, verifyDeviceProof } from './enrollment';

let now: number, environment: CoreEnvironment, owner: WebCryptoIdentity, attacker: WebCryptoIdentity, ownerId: string;
beforeEach(async () => {
  now = 1700000000000; environment = {subtle:crypto.subtle,now:()=>now,newId:()=>crypto.randomUUID()};
  owner = new WebCryptoIdentity(); attacker = new WebCryptoIdentity(); await owner.create(); await attacker.create();
  ownerId = await accountIdFromPublicKey(await owner.getPublicKeyBytes());
});
afterEach(() => { owner.dispose(); attacker.dispose(); });
async function fixture() {
  const device = await createDeviceRequest('Personal computer',environment);
  const certificate = await approveDeviceRequest(device.request,owner,{owner:ownerId,epoch:2,expiresAt:now+86400000,approved:true},environment,new MemoryReplayStore());
  const context = {owner:ownerId,device:device.request.record.author,epoch:2,isRevoked:async()=>false};
  return {device,certificate,context};
}
describe('isolated device enrollment prototype (not live v1)',() => {
  it('creates independent keys and public-only signed QR requests',async()=>{
    const a = await createDeviceRequest('Phone',environment), b = await createDeviceRequest('Computer',environment);
    try {
      expect(a.request.record.author).not.toBe(b.request.record.author); expect(a.request.record.author).not.toBe(ownerId);
      expect(await verifyDeviceRequest(JSON.parse(JSON.stringify(a.request)),environment)).toEqual(a.request);
      expect(JSON.stringify(a.request)).not.toMatch(/privateKey|mnemonic|seed|password/);
    } finally { a.close(); b.close(); }
  });
  it('authorizes the device with owner certificate and proof of its own key, never the owner secret',async()=>{
    const {device,certificate,context} = await fixture();
    try {
      const proof = await createDeviceProof(certificate,device.signer,ownerId,'a'.repeat(64),environment);
      await expect(verifyDeviceProof(proof,certificate,{...context,recipient:ownerId,challenge:'a'.repeat(64)},environment,new MemoryReplayStore())).resolves.toBeUndefined();
      expect(JSON.stringify(certificate)).not.toMatch(/privateKey|mnemonic|seed|password/);
      expect(certificate.record.body).toMatchObject({permission:'messages',canDelegate:false});
    } finally { device.close(); }
  });
  it('refuses silent approval and a different issuer signing as owner',async()=>{
    const device = await createDeviceRequest('Phone',environment);
    try {
      const options = {owner:ownerId,epoch:0,expiresAt:now+10000,approved:false};
      await expect(approveDeviceRequest(device.request,owner,options,environment,new MemoryReplayStore())).rejects.toThrow();
      await expect(approveDeviceRequest(device.request,attacker,{...options,approved:true},environment,new MemoryReplayStore())).rejects.toThrow();
    } finally { device.close(); }
  });
  it('rejects a tampered QR and approval replay',async()=>{
    const device = await createDeviceRequest('Phone',environment), replay = new MemoryReplayStore();
    try {
      const changed = structuredClone(device.request); (changed.record.body as Record<string,unknown>).label='Attacker';
      await expect(verifyDeviceRequest(changed,environment)).rejects.toThrow();
      const options={owner:ownerId,epoch:0,expiresAt:now+10000,approved:true};
      await approveDeviceRequest(device.request,owner,options,environment,replay);
      await expect(approveDeviceRequest(device.request,owner,options,environment,replay)).rejects.toThrow();
    } finally { device.close(); }
  });
  it('checks independently pinned owner/device/epoch and fails closed on unknown revocation',async()=>{
    const {device,certificate,context}=await fixture();
    try {
      for (const changed of [{epoch:3},{device:ownerId},{isRevoked:async()=>true},{isRevoked:async()=>undefined as never}])
        await expect(verifyDeviceCertificate(certificate,{...context,...changed},environment)).rejects.toThrow();
      await expect(verifyDeviceCertificate(certificate,{...context,isRevoked:async()=>{throw new Error('offline');}},environment)).rejects.toThrow('offline');
    } finally { device.close(); }
  });
  it('rejects expired requests and certificates',async()=>{
    const {device,certificate,context}=await fixture();
    try {
      now+=11*60000; await expect(verifyDeviceRequest(device.request,environment)).rejects.toThrow();
      now+=86400000; await expect(verifyDeviceCertificate(certificate,context,environment)).rejects.toThrow();
    } finally { device.close(); }
  });
  it('binds proof to the recipient and challenge and denies a copied certificate without the device private key',async()=>{
    const {device,certificate,context}=await fixture();
    try {
      const proof = await createDeviceProof(certificate,attacker,ownerId,'a'.repeat(64),environment);
      await expect(verifyDeviceProof(proof,certificate,{...context,recipient:ownerId,challenge:'a'.repeat(64)},environment,new MemoryReplayStore())).rejects.toThrow();
      const valid = await createDeviceProof(certificate,device.signer,ownerId,'a'.repeat(64),environment);
      await expect(verifyDeviceProof(valid,certificate,{...context,recipient:ownerId,challenge:'b'.repeat(64)},environment,new MemoryReplayStore())).rejects.toThrow();
      await expect(verifyDeviceProof(valid,certificate,{...context,recipient:context.device,challenge:'a'.repeat(64)},environment,new MemoryReplayStore())).rejects.toThrow();
    } finally { device.close(); }
  });
  it('rejects repeated challenge proof even with a valid certificate',async()=>{
    const {device,certificate,context}=await fixture();
    try {
      const proof=await createDeviceProof(certificate,device.signer,ownerId,'a'.repeat(64),environment), replay=new MemoryReplayStore();
      const receiver={...context,recipient:ownerId,challenge:'a'.repeat(64)};
      await verifyDeviceProof(proof,certificate,receiver,environment,replay);
      await expect(verifyDeviceProof(proof,certificate,receiver,environment,replay)).rejects.toThrow();
    } finally { device.close(); }
  });
  it('rechecks revocation after asynchronous signature validation',async()=>{
    const {device,certificate,context}=await fixture(); let checks=0;
    try {
      const proof=await createDeviceProof(certificate,device.signer,ownerId,'a'.repeat(64),environment);
      await expect(verifyDeviceProof(proof,certificate,{...context,recipient:ownerId,challenge:'a'.repeat(64),
        isRevoked:async()=>++checks>1},environment,new MemoryReplayStore())).rejects.toThrow();
    } finally { device.close(); }
  });
});
