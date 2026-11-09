import { Aes256Gcm, CipherSuite, DhkemP256HkdfSha256, HkdfSha256 } from '@hpke/core';
import type { IdentityProvider } from '../identity/identity';
import { base64, unbase64 } from '../node/offline-crypto';
import { deviceSigningBytes, verifyDeviceTransport, DEVICE_DIRECTORY } from '../../../nodes/packages/protocol/src/devices.js';
import { isValidAccountId } from '../addressing/bech32m.js';
import { UUID_PATTERN } from '../core/objects';
export type DeviceSigned<T> = { body: T; publicKey: string; signature: string };
export type DevicePrekey = { id: string; publicKey: string; privateKey: string; expiresAt: number };
export type DevicePrekeys = { protocol: string; owner: string; device: string; nodeId: string; expiresAt: number; keys: Array<{ id: string; publicKey: string }> };
export type DeviceMail = { protocol: string; nodeId: string; id: string; eventId: string; from: string; fromOwner: string;
  toDevice: string; toOwner: string; keyId: string; expiresAt: number; enc: string; cipher: string };
const suite = new CipherSuite({ kem: new DhkemP256HkdfSha256(), kdf: new HkdfSha256(), aead: new Aes256Gcm() });
const hex = (value: Uint8Array) => [...value].map(b => b.toString(16).padStart(2, '0')).join('');
const raw = (value: string) => Uint8Array.from(value.match(/../g)!, p => parseInt(p, 16));
export async function signDevice<T>(purpose: string, body: T, signer: IdentityProvider): Promise<DeviceSigned<T>> {
  return { body, publicKey: hex(await signer.getPublicKeyBytes()), signature: hex(await signer.sign(deviceSigningBytes(purpose, body))) };
}
export async function newDevicePrekey(expiresAt: number): Promise<DevicePrekey> {
  const pair = await suite.kem.generateKeyPair();
  return { id: hex(crypto.getRandomValues(new Uint8Array(16))), publicKey: hex(new Uint8Array(await suite.kem.serializePublicKey(pair.publicKey))),
    privateKey: base64(await suite.kem.serializePrivateKey(pair.privateKey)), expiresAt };
}
const context = (b: Omit<DeviceMail, 'enc' | 'cipher'>) => deviceSigningBytes('encryption', b);
export async function sealDeviceMail(metadata: Omit<DeviceMail, 'enc' | 'cipher' | 'protocol'>, publicKey: string, text: string, signer: IdentityProvider) {
  const body = { protocol: DEVICE_DIRECTORY, ...metadata }, aad = context(body), plain = new TextEncoder().encode(text);
  if (plain.length > 32768) throw new Error('device_mail_size');
  try {
    const sender = await suite.createSenderContext({ recipientPublicKey: await suite.kem.deserializePublicKey(raw(publicKey)), info: aad });
    return await signDevice('mail', { ...body, enc: base64(sender.enc), cipher: base64(await sender.seal(plain, aad)) }, signer);
  } finally { plain.fill(0); }
}
export async function openDeviceMail(value: unknown, key: DevicePrekey, owner: string, device: string, nodeId: string) {
  const candidate = value as DeviceSigned<DeviceMail>;
  const signed = await verifyDeviceTransport(candidate, 'mail', candidate?.body?.from) as DeviceSigned<DeviceMail>, b = signed.body;
  if (b.protocol !== DEVICE_DIRECTORY || b.toOwner !== owner || b.toDevice !== device || b.nodeId !== nodeId || b.keyId !== key.id ||
    !isValidAccountId(b.fromOwner) || !/^[a-f0-9]{32}$/.test(b.id) || !UUID_PATTERN.test(b.eventId) ||
    !Number.isSafeInteger(b.expiresAt) || b.expiresAt > key.expiresAt || b.expiresAt <= Date.now() ||
    typeof b.enc !== 'string' || !/^[A-Za-z0-9_-]{87}$/.test(b.enc) || typeof b.cipher !== 'string' ||
    !/^[A-Za-z0-9_-]{22,48000}$/.test(b.cipher) || Object.keys(b).length !== 12) throw new Error('device_mail_binding');
  const { enc, cipher, ...metadata } = b, secret = unbase64(key.privateKey), aad = context(metadata);
  try {
    const receiver = await suite.createRecipientContext({ recipientKey: await suite.kem.deserializePrivateKey(secret), enc: unbase64(enc), info: aad });
    const plain = new Uint8Array(await receiver.open(unbase64(cipher), aad));
    try { if (plain.length > 32768) throw new Error('device_mail_size'); return { signed, packet: new TextDecoder('utf-8', { fatal: true }).decode(plain) }; }
    finally { plain.fill(0); }
  } finally { secret.fill(0); }
}
