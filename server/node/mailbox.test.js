import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DiskMailbox } from './mailbox.js';
import { MAILBOX_PROTOCOL, MAX_MAIL_TTL_MS } from '../../src/lib/node/protocol.js';

const directories = [];
const envelope = (now, changes = {}) => ({ protocol: MAILBOX_PROTOCOL, id: randomBytes(16).toString('hex'),
  expiresAt: now + 60_000, ciphertext: randomBytes(64).toString('base64url'), ...changes });
async function storage(options) {
  const directory = await mkdtemp(join(tmpdir(), 'automesh-node-test-')); directories.push(directory);
  return new DiskMailbox(directory, options).initialize();
}
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
describe('durable opaque mailbox', () => {
  it('persists opaque bytes over restart and only removes after acknowledgement', async () => {
    const box = await storage(); const item = envelope(Date.now());
    expect(await box.put('alice', item)).toEqual({ id: item.id, status: 'stored' });
    const reopened = await new DiskMailbox(box.directory).initialize();
    expect((await reopened.list())[0]).toMatchObject(item);
    await reopened.acknowledge([item.id]); expect(await reopened.list()).toEqual([]);
    const restarted = await new DiskMailbox(box.directory).initialize();
    expect(await restarted.put('alice', item)).toEqual({ id: item.id, status: 'acknowledged' });
    expect(await restarted.list()).toEqual([]);
    expect(await readFile(join(box.directory, `${item.id}.json`), 'utf8')).not.toContain(item.ciphertext);
  });
  it('deduplicates concurrent deposits and rejects replacement / sender spoofing', async () => {
    const box = await storage(); const item = envelope(Date.now());
    await Promise.all(Array.from({ length: 10 }, () => box.put('alice', item)));
    expect(box.stats().messages).toBe(1);
    await expect(box.put('bob', item)).rejects.toThrow('message_conflict');
    await expect(box.put('alice', { ...item, ciphertext: randomBytes(64).toString('base64url') })).rejects.toThrow('message_conflict');
  });
  it('bounds expiry, envelope size and canonical encoding', async () => {
    const box = await storage(); const now = Date.now();
    for (const value of [envelope(now, { expiresAt: now - 1 }), envelope(now, { expiresAt: now + MAX_MAIL_TTL_MS + 10_000 }),
      envelope(now, { id: '../elsewhere' }), envelope(now, { ciphertext: 'readable text' }),
      envelope(now, { ciphertext: 'a'.repeat(200_000) }), envelope(now, { ciphertext: 'A'.repeat(22) + 'B' })])
      await expect(box.put('alice', value)).rejects.toThrow('invalid_envelope');
    expect(box.stats().messages).toBe(0);
  });
  it('expires both messages and receipts', async () => {
    let now = 10_000; const box = await storage({ now: () => now }); const item = envelope(now);
    await box.put('alice', item); now = item.expiresAt; expect(await box.list()).toEqual([]);
    const restart = await new DiskMailbox(box.directory, { now: () => now }).initialize(); expect(restart.stats().bytes).toBe(0);
  });
  it('enforces count, disk quota and per-sender quota', async () => {
    const box = await storage({ maxMessages: 1 }); await box.put('alice', envelope(Date.now()));
    await expect(box.put('bob', envelope(Date.now()))).rejects.toThrow('mailbox_full');
    const bytes = await storage({ maxBytes: 24 * 1024 });
    await bytes.put('alice', envelope(Date.now(), { ciphertext: randomBytes(16000).toString('base64url') }));
    await expect(bytes.put('bob', envelope(Date.now(), { ciphertext: randomBytes(16000).toString('base64url') }))).rejects.toThrow('mailbox_full');
    const quota = await storage();
    for (let i = 0; i < 100; i++) await quota.put('alice', envelope(Date.now()));
    await expect(quota.put('alice', envelope(Date.now()))).rejects.toThrow('mailbox_full');
    await quota.put('bob', envelope(Date.now()));
  });
  it('fails closed on corrupt committed state instead of silently resetting', async () => {
    const box = await storage(); const item = envelope(Date.now()); await box.put('alice', item);
    await writeFile(join(box.directory, `${item.id}.json`), '{}');
    await expect(new DiskMailbox(box.directory).initialize()).rejects.toThrow('corrupt_mailbox');
  });
  it('exposes only the depositing sender’s signed receipts and preserves them across restart', async () => {
    const box = await storage(); const first = envelope(Date.now()), second = envelope(Date.now());
    await box.put('alice', first); await box.put('bob', second);
    await box.acknowledge([first.id, second.id], { [first.id]: 'signed-alice-receipt', [second.id]: 'signed-bob-receipt' });
    const restarted = await new DiskMailbox(box.directory).initialize();
    expect(await restarted.receipts('alice', [first.id, second.id])).toMatchObject([{ id: first.id, receipt: 'signed-alice-receipt' }]);
    expect(await restarted.receipts('outsider', [first.id, second.id])).toEqual([]);
    await expect(box.acknowledge([first.id], { [second.id]: 'wrong-id' })).rejects.toThrow('invalid_ack');
  });
});
