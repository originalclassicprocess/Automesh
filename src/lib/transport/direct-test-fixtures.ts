import { WebCryptoIdentity } from '$lib/identity/webcrypto';
import { bytesToHex } from '$lib/message/encoding';
import { getAccountId } from '$lib/addressing/address';
import { signDirectInvite, type DirectInvite } from './direct-invite';

export const testSdp = (id = 'abc'): string => `v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\na=ice-ufrag:${id}\r\na=fingerprint:sha-256 AA:BB:CC\r\na=candidate:1 1 udp 2122260223 192.168.0.2 5000 typ host\r\n`;
export async function testIdentity(byte: number) {
  const provider = new WebCryptoIdentity(); const seed = new Uint8Array(32); seed[31] = byte;
  const publicKey = (await provider.fromSeed(seed)).publicKey;
  return { provider, address: await getAccountId(bytesToHex(publicKey)),
    signer: { publicKey, sign: (data: Uint8Array) => provider.sign(data) } };
}
export async function testOffer(byte = 1): Promise<DirectInvite> {
  const identity = await testIdentity(byte); const created = Date.now();
  return signDirectInvite({ type:'mesh-direct', version:1, kind:'offer', session:crypto.randomUUID(),
    from:identity.address, to:'', created, expires:created + 300_000, sdp:testSdp(), replyTo:'' }, identity.signer);
}
