import { describe,it,expect } from 'vitest';
import { encryptPairingPacket, decryptPairingPacket, verifyPairingRequest, pairingComplete, verifyPairingComplete } from './pairing';
import { createDeviceInvitation, verifyDeviceInvitation, type PairingChannel } from './links';
import { createDeviceRequest } from './enrollment';
import { WebCryptoIdentity } from '../identity/webcrypto';
import { webCryptoEnvironment } from '../core/ports';
const channel: PairingChannel = { origin:'https://app.example', id:'a'.repeat(64), token:'b'.repeat(64), key:'c'.repeat(64) };
describe('one-owner-QR enrollment', () => {
  it('encrypts request/approval metadata and rejects changed key, session, kind and ciphertext', async () => {
    const value = { label:'Private computer name' }, packet = await encryptPairingPacket(channel,'request',value);
    expect(packet).not.toContain('Private'); expect(await decryptPairingPacket(channel,'request',packet)).toEqual(value);
    await expect(decryptPairingPacket({...channel,key:'d'.repeat(64)},'request',packet)).rejects.toThrow();
    await expect(decryptPairingPacket({...channel,id:'d'.repeat(64)},'request',packet)).rejects.toThrow();
    await expect(decryptPairingPacket(channel,'approval',packet)).rejects.toThrow();
    await expect(decryptPairingPacket(channel,'request',packet.slice(0,-3)+'xxx')).rejects.toThrow();
  });
  it('binds a node-free invitation, exact request and possession proof, never grants admin rights', async () => {
    const signer = new WebCryptoIdentity(); await signer.create(); const env = webCryptoEnvironment(), device = await createDeviceRequest('Phone',env);
    try {
      const invite = await createDeviceInvitation(null,'Owner',signer,env,channel);
      expect((await verifyDeviceInvitation(invite,env)).authority).toBeNull();
      expect((await verifyDeviceInvitation(invite,env)).pairing).toEqual(channel);
      await expect(verifyPairingRequest({invitation:invite.record.id,request:device.request},invite)).resolves.toEqual(device.request);
      await expect(verifyPairingRequest({invitation:'wrong',request:device.request},invite)).rejects.toThrow();
      const complete = await pairingComplete(invite,device.request,device.signer);
      await expect(verifyPairingComplete(complete,invite,device.request)).resolves.toBeUndefined();
      await expect(verifyPairingComplete(await pairingComplete(invite,device.request,signer),invite,device.request)).rejects.toThrow();
      const changed = structuredClone(invite); (changed.record.body as Record<string,unknown>).pairing = {...channel,key:'f'.repeat(64)};
      await expect(verifyDeviceInvitation(changed,env)).rejects.toThrow();
    } finally { signer.dispose(); device.close(); }
  });
});
