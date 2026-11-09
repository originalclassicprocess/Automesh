import { describe, it, expect } from 'vitest';
import { createAttachmentManifest, encryptAttachmentPart, decryptAttachmentPart, validateManifest, attachmentHash } from './attachment-crypto';
import { ATTACHMENT_CHUNK_BYTES, FILE_POLICY_BYTES, validateAttachment, validAttachmentRequest } from './attachment-protocol.js';
const offer = async (bytes: Uint8Array) => ({ id: crypto.randomUUID(), name: 'private-photo.jpg', mime: 'image/jpeg', size: bytes.length, sha256: await attachmentHash(bytes) });
describe('encrypted resumable attachment contract', () => {
  it('carries sticker metadata in the existing encrypted file manifest without a node protocol change',async()=>{
    const bytes=new Uint8Array([1,2,3]);
    const media={kind:'sticker' as const,packId:'a'.repeat(64),packName:'Pack'};
    const manifest=await createAttachmentManifest({...await offer(bytes),details:{media}},bytes,'a','b');
    const reopened=validateManifest(JSON.parse(JSON.stringify(manifest)),'a','b',manifest.offer.id);
    expect(reopened.offer.details?.media).toEqual(media);
    const encrypted=await encryptAttachmentPart(manifest,0,bytes);
    expect(await decryptAttachmentPart(reopened,0,encrypted)).toEqual(bytes);
    expect(()=>validateManifest({...manifest,offer:{...manifest.offer,details:{media:{...media,packId:'invalid'}}}},'a','b',manifest.offer.id)).toThrow();
  });
  it('handles the exact 20 MiB policy boundary without encoding the file in the small envelope', async () => {
    const bytes = new Uint8Array(FILE_POLICY_BYTES).fill(19); const m = await createAttachmentManifest(await offer(bytes), bytes, 'a', 'b');
    expect(m.attachment.chunks).toBe(640); expect(JSON.stringify(m).length).toBeLessThan(2048);
    const last = await encryptAttachmentPart(m, 639, bytes.subarray(639 * ATTACHMENT_CHUNK_BYTES));
    expect(await decryptAttachmentPart(m, 639, last)).toEqual(bytes.subarray(639 * ATTACHMENT_CHUNK_BYTES));
    const huge = { ...m.offer, size: FILE_POLICY_BYTES + 1 }; await expect(createAttachmentManifest(huge, new Uint8Array(0), 'a', 'b')).rejects.toThrow();
  });
  it('authenticates chunk index, file, profile, recipient and size; repeat encryption is exact', async () => {
    const bytes = new Uint8Array(ATTACHMENT_CHUNK_BYTES + 5); bytes.fill(77);
    const m = await createAttachmentManifest(await offer(bytes), bytes, 'a', 'b');
    const cipher = await encryptAttachmentPart(m, 0, bytes.subarray(0, ATTACHMENT_CHUNK_BYTES));
    expect(await encryptAttachmentPart(m, 0, bytes.subarray(0, ATTACHMENT_CHUNK_BYTES))).toEqual(cipher);
    expect(await decryptAttachmentPart(m, 0, cipher)).toEqual(bytes.subarray(0, ATTACHMENT_CHUNK_BYTES));
    for (const changed of [{ ...m, from: 'x' }, { ...m, to: 'x' }, { ...m, offer: { ...m.offer, id: crypto.randomUUID() } },
      { ...m, attachment: { ...m.attachment, id: 'a'.repeat(32) } }]) await expect(decryptAttachmentPart(changed, 0, cipher)).rejects.toThrow();
    const bad = cipher.slice(); bad[0] ^= 1; await expect(decryptAttachmentPart(m, 0, bad)).rejects.toThrow();
    await expect(decryptAttachmentPart(m, 1, cipher)).rejects.toThrow();
    const other = await createAttachmentManifest(await offer(bytes), bytes, 'a', 'b'); expect(other.key).not.toBe(m.key); expect(other.attachment.id).not.toBe(m.attachment.id);
    expect(() => validateManifest(m, 'a', 'b', m.offer.id)).not.toThrow();
    expect(() => validateManifest(m, 'a', 'x', m.offer.id)).toThrow();
  });
  it('supports empty files and rejects changed sources, oversized or unknown contracts before allocation', async () => {
    const bytes = new Uint8Array(); const o = await offer(bytes); const m = await createAttachmentManifest(o, bytes, 'a', 'b');
    const cipher = await encryptAttachmentPart(m, 0, bytes); expect(cipher).toHaveLength(16); expect(await decryptAttachmentPart(m, 0, cipher)).toHaveLength(0);
    await expect(createAttachmentManifest({ ...o, sha256: '0'.repeat(64) }, bytes, 'a', 'b')).rejects.toThrow('attachment_source_changed');
    for (const a of [{ ...m.attachment, size: FILE_POLICY_BYTES + 1 }, { ...m.attachment, chunks: 999999 }, { ...m.attachment, chunkBytes: 999999 },
      { ...m.attachment, protocol: 'v2' }, { ...m.attachment, bytes: -1 }, { ...m.attachment, extra: true }]) expect(() => validateAttachment(a)).toThrow();
    expect(validAttachmentRequest({ body: { protocol: 'v2' } })).toBe(false);
  });
});
