import { describe, expect, it } from 'vitest';
import { signDirectInvite, verifyDirectInvite, inviteHash, encodeDirectInvite, decodeDirectInvite,
  directQrFrames, DirectQrCollector } from './direct-invite';
import { testSdp, testIdentity, testOffer } from './direct-test-fixtures';

describe('signed offline pairing codes', () => {
  it('round-trips a signed offer through bounded compression and all QR parts in reverse order', async () => {
    const offer = await testOffer(); const encoded = await encodeDirectInvite(offer);
    expect(await decodeDirectInvite(encoded)).toEqual(offer);
    const frames = await directQrFrames(encoded); const collector = new DirectQrCollector();
    let result: string | null = null;
    for (const frame of [...frames].reverse()) result = await collector.add(frame);
    expect(result).toBe(encoded);
    expect(await decodeDirectInvite(result!)).toEqual(offer);
  });
  it('rejects a modified SDP, identity or signature', async () => {
    const offer = await testOffer(); const other = await testIdentity(2);
    await expect(verifyDirectInvite({ ...offer, sdp:offer.sdp.replace('5000', '5001') })).rejects.toThrow('signature');
    await expect(verifyDirectInvite({ ...offer, from:other.address })).rejects.toThrow('signature');
    await expect(verifyDirectInvite({ ...offer, signature:'0'.repeat(128) })).rejects.toThrow('signature');
  });
  it('rejects expired, future, wrong-type and non-host/media SDP', async () => {
    const offer = await testOffer();
    await expect(verifyDirectInvite(offer, offer.expires)).rejects.toThrow('expired');
    await expect(verifyDirectInvite(offer, offer.created - 60_000)).rejects.toThrow('expired');
    await expect(verifyDirectInvite({ ...offer, type:'mesh-local-node' })).rejects.toThrow();
    await expect(verifyDirectInvite({ ...offer, sdp:offer.sdp.replace('typ host', 'typ relay') })).rejects.toThrow('sdp');
    await expect(verifyDirectInvite({ ...offer, sdp:offer.sdp + 'm=audio 9 RTP/AVP 0\r\n' })).rejects.toThrow('sdp');
  });
  it('binds the signed answer to both the recipient and the exact signed offer', async () => {
    const offer = await testOffer(); const responder = await testIdentity(2);
    const answer = await signDirectInvite({ ...offer, kind:'answer', from:responder.address, to:offer.from,
      sdp:testSdp('answer'), replyTo:await inviteHash(offer) }, responder.signer);
    expect((await verifyDirectInvite(answer)).replyTo).toBe(await inviteHash(offer));
    await expect(verifyDirectInvite({ ...answer, to:responder.address })).rejects.toThrow('signature');
  });
  it('does not mix QR groups and rejects altered pieces before decompression', async () => {
    const encoded = await encodeDirectInvite(await testOffer());
    const frames = await directQrFrames(encoded); const collector = new DirectQrCollector();
    expect(frames.length).toBeGreaterThan(1);
    await collector.add(frames[0]);
    const other = await directQrFrames(await encodeDirectInvite(await testOffer(2)));
    await expect(collector.add(other[0])).rejects.toThrow('different_session');
    collector.reset();
    for (const frame of frames.slice(0, -1)) await collector.add(frame);
    await expect(collector.add(frames.at(-1)! + 'x')).rejects.toThrow();
  });
  it('bounds decompression and refuses ordinary account/node QR', async () => {
    await expect(decodeDirectInvite('mesh-direct1:' + 'A'.repeat(16_000))).rejects.toThrow();
    const stream = new Blob([JSON.stringify({ sdp:'x'.repeat(70_000) })]).stream().pipeThrough(new CompressionStream('deflate'));
    const zipped = new Uint8Array(await new Response(stream).arrayBuffer());
    await expect(decodeDirectInvite('mesh-direct1:' + btoa(String.fromCharCode(...zipped)))).rejects.toThrow('too_large');
    await expect(decodeDirectInvite((await testIdentity(1)).address)).rejects.toThrow('not_direct_invite');
  });
});
