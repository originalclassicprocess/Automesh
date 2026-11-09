import { Aes256Gcm, CipherSuite, DhkemP256HkdfSha256, HkdfSha256 } from '@hpke/core';
import type { IdentityProvider } from '$lib/identity/identity';
import { accountIdFromPublicKey } from '$lib/addressing/account-id.js';
import { base64, unbase64, signObject, verifyObject, type Signed } from '$lib/node/offline-crypto';
import { bytesToHex, hexToBytes } from '$lib/message/encoding';
import { importPublicKey, verify } from '$lib/message/envelope';
import { concat } from './meshtastic-wire';
export const MAX_RADIO_TEXT_BYTES = 320, RADIO_CONTACT_LIFETIME = 24 * 60 * 60000;
const MAGIC = new Uint8Array([0x4d, 0x41, 0x52, 0x45, 1]), HEADER = 46;
const suite = new CipherSuite({ kem: new DhkemP256HkdfSha256(), kdf: new HkdfSha256(), aead: new Aes256Gcm() });
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
type ContactBody = { type: 'automesh-radio-contact'; version: 1; account: string; network: string; node: number; keyId: string; encryptionKey: string; created: number; expires: number };
export type RadioContact = Signed<ContactBody>;
// Secret material: serialize ONLY inside the profile's encrypted chat store.
export type SavedRadioKey = { contact: RadioContact; privateKey: string };
const CONTACT_PREFIX = 'mesh-radio-contact1:';
const hex16 = /^[a-f0-9]{32}$/, hex32 = /^[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const idBytes = (id: string) => { if (!uuid.test(id)) throw Error('radio_invalid_message_id'); return hexToBytes(id.replaceAll('-', '')); };
export function packetId(packet: Uint8Array): string {
  const h = bytesToHex(packet.slice(6, 22)); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export const digest = async (bytes: Uint8Array) => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer));
export const encodeRadioContact = (contact: RadioContact) => CONTACT_PREFIX + base64(encoder.encode(JSON.stringify(contact)));
export async function parseRadioContact(text: string, network: string, now = Date.now()): Promise<RadioContact> {
  if (text.length > 2400 || !text.startsWith(CONTACT_PREFIX)) throw Error('radio_invalid_contact');
  let value: RadioContact;
  try { value = JSON.parse(decoder.decode(unbase64(text.slice(CONTACT_PREFIX.length)))) as RadioContact; }
  catch { throw Error('radio_invalid_contact'); }
  const b = value?.body;
  if (!value || Object.keys(value).sort().join(',') !== 'body,publicKey,signature' || !b || Object.keys(b).sort().join(',') !== 'account,created,encryptionKey,expires,keyId,network,node,type,version' ||
    b.type !== 'automesh-radio-contact' || b.version !== 1 || !hex32.test(b.network) || !hex16.test(b.keyId) ||
    !Number.isInteger(b.node) || b.node <= 0 || b.node >= 0xffffffff || !Number.isSafeInteger(b.created) || !Number.isSafeInteger(b.expires) ||
    b.created < 0 || b.expires <= b.created || b.expires - b.created > RADIO_CONTACT_LIFETIME ||
    typeof b.encryptionKey !== 'string' || !/^04[0-9a-f]{128}$/.test(b.encryptionKey)) throw Error('radio_invalid_contact');
  await verifyObject(value, 'radio-contact', b.account);
  if (b.network !== network) throw Error('radio_contact_network_mismatch');
  if (b.created > now + 300000) throw Error('radio_contact_from_future');
  if (b.expires <= now) throw Error('radio_contact_expired');
  await suite.kem.deserializePublicKey(hexToBytes(b.encryptionKey)); return value;
}
function signedBytes(network: string, from: string, to: string, packet: Uint8Array): Uint8Array {
  return concat(encoder.encode(JSON.stringify(['Automesh radio experiment v1', network, from, to])), packet);
}
function packetKind(packet: Uint8Array): number {
  if (packet.length < 118 || packet.length > 512 || MAGIC.some((value, i) => packet[i] !== value) || ![1, 2].includes(packet[5])) throw Error('radio_invalid_envelope');
  return packet[5];
}
export class RadioCrypto {
  private keys: CryptoKeyPair | null;
  private closed = false;
  private constructor(readonly contact: RadioContact, private readonly signer: IdentityProvider, keys: CryptoKeyPair) { this.keys = keys; }
  static async create(signer: IdentityProvider, network: string, node: number, now = Date.now()): Promise<RadioCrypto> {
    if (!hex32.test(network) || !Number.isInteger(node) || node <= 0 || node >= 0xffffffff) throw Error('radio_invalid_route');
    const keys = await suite.kem.generateKeyPair(), publicKey = await signer.getPublicKeyBytes();
    const body: ContactBody = { type: 'automesh-radio-contact', version: 1, account: await accountIdFromPublicKey(publicKey), network, node,
      keyId: bytesToHex(crypto.getRandomValues(new Uint8Array(16))), encryptionKey: bytesToHex(new Uint8Array(await suite.kem.serializePublicKey(keys.publicKey))), created: now, expires: now + RADIO_CONTACT_LIFETIME };
    return new RadioCrypto(await signObject(body, 'radio-contact', signer), signer, keys);
  }
  dispose() { this.closed = true; this.keys = null; }
  async save(): Promise<SavedRadioKey> {
    this.active(Date.now());
    const raw = new Uint8Array(await suite.kem.serializePrivateKey(this.keys!.privateKey));
    try { return { contact: this.contact, privateKey: bytesToHex(raw) }; }
    finally { raw.fill(0); }
  }
  static async restore(signer: IdentityProvider, saved: SavedRadioKey): Promise<RadioCrypto> {
    const contact = await parseRadioContact(encodeRadioContact(saved.contact), saved.contact.body.network);
    if (contact.body.account !== await accountIdFromPublicKey(await signer.getPublicKeyBytes()) || !hex32.test(saved.privateKey)) throw Error('radio_wrong_saved_key');
    const raw = hexToBytes(saved.privateKey);
    try {
      const privateKey = await suite.kem.deserializePrivateKey(raw), publicKey = await suite.kem.deserializePublicKey(hexToBytes(contact.body.encryptionKey));
      // Verify key pairing rather than trusting imported backup metadata.
      const challenge = crypto.getRandomValues(new Uint8Array(16));
      const sender = await suite.createSenderContext({ recipientPublicKey: publicKey });
      const receiver = await suite.createRecipientContext({ recipientKey: privateKey, enc: sender.enc });
      const opened = new Uint8Array(await receiver.open(await sender.seal(challenge)));
      if (bytesToHex(opened) !== bytesToHex(challenge)) throw Error('radio_wrong_saved_key');
      return new RadioCrypto(contact, signer, { privateKey, publicKey });
    } finally { raw.fill(0); }
  }
  private active(now: number) { if (this.closed || !this.keys || this.contact.body.expires <= now) throw Error('radio_session_closed_or_expired'); }
  private checkPeer(peer: RadioContact, now: number) {
    this.active(now); if (peer.body.network !== this.contact.body.network || peer.body.account === this.contact.body.account || peer.body.node === this.contact.body.node || peer.body.expires <= now) throw Error('radio_wrong_or_expired_peer');
  }
  async seal(peer: RadioContact, text: string, id: string = crypto.randomUUID(), now = Date.now()): Promise<Uint8Array> {
    this.checkPeer(peer, now); const plain = encoder.encode(text);
    if (!text.trim() || plain.length > MAX_RADIO_TEXT_BYTES) throw Error('radio_text_too_large_or_empty');
    const header = new Uint8Array(HEADER); header.set(MAGIC); header[5] = 1; header.set(idBytes(id), 6);
    new DataView(header.buffer).setBigUint64(22, BigInt(now)); header.set(hexToBytes(peer.body.keyId), 30);
    const aad = signedBytes(peer.body.network, this.contact.body.account, peer.body.account, header);
    try {
      const context = await suite.createSenderContext({ recipientPublicKey: await suite.kem.deserializePublicKey(hexToBytes(peer.body.encryptionKey)), info: aad });
      const body = concat(header, new Uint8Array(context.enc), new Uint8Array(await context.seal(plain, aad)));
      const signature = await this.signer.sign(signedBytes(peer.body.network, this.contact.body.account, peer.body.account, body));
      this.active(Date.now()); return concat(body, signature);
    } finally { plain.fill(0); }
  }
  async open(peer: RadioContact, packet: Uint8Array, now = Date.now()): Promise<{ id: string; text: string; timestamp: number }> {
    this.checkPeer(peer, now);
    if (packetKind(packet) !== 1 || packet.length < HEADER + 65 + 16 + 64 || bytesToHex(packet.slice(30, 46)) !== this.contact.body.keyId) throw Error('radio_wrong_recipient_key');
    const rawTime = new DataView(packet.buffer, packet.byteOffset, packet.byteLength).getBigUint64(22);
    if (rawTime > BigInt(Number.MAX_SAFE_INTEGER)) throw Error('radio_invalid_timestamp');
    const timestamp = Number(rawTime);
    if (timestamp < this.contact.body.created - 300000 || timestamp > now + 300000) throw Error('radio_invalid_timestamp');
    const body = packet.slice(0, -64);
    if (!await verify(signedBytes(peer.body.network, peer.body.account, this.contact.body.account, body), packet.slice(-64), await importPublicKey(hexToBytes(peer.publicKey)))) throw Error('radio_invalid_signature');
    const aad = signedBytes(peer.body.network, peer.body.account, this.contact.body.account, packet.slice(0, HEADER));
    const context = await suite.createRecipientContext({ recipientKey: this.keys!.privateKey, enc: packet.slice(HEADER, HEADER + 65), info: aad });
    const plain = new Uint8Array(await context.open(packet.slice(HEADER + 65, -64), aad));
    try {
      this.active(Date.now()); const text = decoder.decode(plain);
      if (!text.trim() || plain.length > MAX_RADIO_TEXT_BYTES) throw Error('radio_invalid_content');
      return { id: packetId(packet), text, timestamp };
    } finally { plain.fill(0); }
  }
  async receipt(peer: RadioContact, packet: Uint8Array): Promise<Uint8Array> {
    this.checkPeer(peer, Date.now()); const body = concat(MAGIC, new Uint8Array([2]), idBytes(packetId(packet)), await digest(packet));
    const signature = await this.signer.sign(signedBytes(peer.body.network, this.contact.body.account, peer.body.account, body));
    this.active(Date.now()); return concat(body, signature);
  }
  async verifyReceipt(peer: RadioContact, receipt: Uint8Array, expectedDigest: Uint8Array): Promise<void> {
    this.checkPeer(peer, Date.now());
    if (packetKind(receipt) !== 2 || receipt.length !== 118 || bytesToHex(receipt.slice(22, 54)) !== bytesToHex(expectedDigest) ||
      !await verify(signedBytes(peer.body.network, peer.body.account, this.contact.body.account, receipt.slice(0, 54)), receipt.slice(54), await importPublicKey(hexToBytes(peer.publicKey)))) throw Error('radio_invalid_receipt');
    this.active(Date.now());
  }
  static isReceipt(packet: Uint8Array): boolean { return packetKind(packet) === 2; }
}
