import { afterEach, describe, it, expect } from 'vitest';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DiskAttachments } from './attachments.js';
import { createAttachmentManifest, encryptAttachmentPart, attachmentHash } from '$lib/node/attachment-crypto';
import { base64 } from '$lib/node/offline-crypto';
import { ATTACHMENT_CHUNK_BYTES } from '$lib/node/attachment-protocol.js';
let directory = '';
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); directory = ''; });
async function fixture(size = ATTACHMENT_CHUNK_BYTES + 6) {
  directory = await mkdtemp(join(tmpdir(), 'automesh-attachment-'));
  const bytes = new Uint8Array(size).fill(78), m = await createAttachmentManifest({ id: crypto.randomUUID(), name: 'secret.txt', mime: 'text/plain', size, sha256: await attachmentHash(bytes) }, bytes, 'sender', 'recipient');
  const job = { body: { attachment: m.attachment, from: 'sender', to: 'recipient', expiresAt: Date.now() + 60000 }, packet: 'opaque' };
  const box = await new DiskAttachments(directory, 64 * 1024 * 1024).initialize();
  const parts = await Promise.all(Array.from({ length: m.attachment.chunks }, (_, i) => encryptAttachmentPart(m, i, bytes.subarray(i * ATTACHMENT_CHUNK_BYTES, (i + 1) * ATTACHMENT_CHUNK_BYTES)).then(base64)));
  return { job, box, parts, m };
}
describe('bounded durable ciphertext file store', () => {
  it('serializes concurrent upload and receipt cleanup without orphaned parts after restart', async () => {
    const { job, box, parts, m } = await fixture(); await box.start(job);
    await Promise.all([box.put('sender', m.attachment.id, 0, parts[0]), box.remove(m.attachment.id)]);
    expect(await readdir(directory)).toEqual([]);
    expect((await new DiskAttachments(directory, box.maxBytes).initialize()).stats().files).toBe(0);
    await box.start(job);
    const removal = box.remove(m.attachment.id), late = box.put('sender', m.attachment.id, 0, parts[0]);
    await expect(late).rejects.toThrow('attachment_denied'); await removal;
    expect(await readdir(directory)).toEqual([]);
  });
  it('resumes exact staged parts after restart and commits only all matching ciphertext', async () => {
    const { job, box, parts, m } = await fixture(); const id = m.attachment.id;
    expect(await box.start(job)).toEqual({ received: [], complete: false });
    await box.put('sender', id, 0, parts[0]); await expect(box.commit(job)).rejects.toThrow('attachment_incomplete');
    const restarted = await new DiskAttachments(directory, box.maxBytes).initialize(); expect(await restarted.start(job)).toEqual({ received: [0], complete: false });
    await restarted.put('sender', id, 1, parts[1]); await restarted.commit(job);
    expect(await restarted.get(id, 1)).toBe(parts[1]);
    await new DiskAttachments(directory, box.maxBytes).initialize();
    const disk = await Promise.all((await readdir(directory)).map(n => readFile(join(directory, n), 'utf8')));
    expect(disk.join('')).not.toContain('secret.txt'); expect(disk.join('')).not.toContain(m.key);
    await restarted.remove(id); expect(await readdir(directory)).toEqual([]);
  });
  it('rejects unknown senders, mutation, wrong chunk sizes and quota exhaustion', async () => {
    const { job, box, parts, m } = await fixture(); await box.start(job);
    await expect(box.put('evil', m.attachment.id, 0, parts[0])).rejects.toThrow('attachment_denied');
    await expect(box.put('sender', m.attachment.id, 999999, parts[0])).rejects.toThrow();
    await expect(box.put('sender', m.attachment.id, 0, parts[1])).rejects.toThrow();
    await box.put('sender', m.attachment.id, 0, parts[0]);
    const bad = base64(new Uint8Array(ATTACHMENT_CHUNK_BYTES + 16));
    await expect(box.put('sender', m.attachment.id, 0, bad)).rejects.toThrow('attachment_conflict');
    await expect(box.start({ ...job, body: { ...job.body, to: 'evil' } })).rejects.toThrow('attachment_conflict');
    box.maxBytes = box.stats().bytes; await expect(box.start({ ...job, body: { ...job.body, attachment: { ...m.attachment, id: 'f'.repeat(32) } } })).rejects.toThrow('mailbox_full');
  });
  it('rejects wrong ciphertext digest and expires unfinished uploads', async () => {
    const { job, box, parts, m } = await fixture(4);
    const bad = { ...job, body: { ...job.body, attachment: { ...m.attachment, digest: '0'.repeat(64) } } };
    await box.start(bad); await box.put('sender', m.attachment.id, 0, parts[0]); await expect(box.commit(bad)).rejects.toThrow('attachment_digest_mismatch');
    box.records.get(m.attachment.id).job.body.expiresAt = Date.now() - 1; await box.sweep(); expect(box.stats().bytes).toBe(0);
  });
});
