import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { Outbox } from '../server/outbox.mjs';
import { notification, fromStop } from '../server/notifications.mjs';
import { protect, unprotect } from '../server/protection.mjs';

// Real authenticated encryption for storage tests; platform DPAPI tested below.
const key = randomBytes(32);
const codec = {
  async protect(value) {
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(value), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
  },
  async unprotect(value) {
    const cipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12));
    cipher.setAuthTag(value.subarray(12, 28));
    return Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]);
  },
};
const scope = { sender: 'sender-A', recipient: 'recipient-A', appUrl: 'https://automesh.space/' };
const make = (eventId = 'test-1') => notification({ eventId, title: 'Тест', summary: 'private-result-123', status: 'completed' });
async function fixture(t) {
  const root = fileURLToPath(new URL('../.test-data/', import.meta.url));
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'outbox-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, box: new Outbox(directory, codec) };
}
test('survives restart, encrypts content, and keeps the original message ID for retry', async t => {
  const { box, directory } = await fixture(t);
  const entry = make(); await box.enqueue(entry, scope);
  assert.equal((await readFile(join(directory, 'outbox.dpapi'))).includes(Buffer.from('private-result-123')), false);
  const reopened = new Outbox(directory, codec);
  assert.deepEqual(await reopened.flush(scope, async () => { throw new Error('offline'); }), { delivered: 0, pending: 1 });
  let sent;
  assert.deepEqual(await reopened.flush(scope, async value => { sent = value; }), { delivered: 1, pending: 0 });
  assert.equal(sent.messageId, entry.messageId);
  assert.equal((await reopened.enqueue(make(), scope)).status, 'duplicate');
});
test('two processes cannot concurrently claim the same notification', async t => {
  const { box, directory } = await fixture(t);
  const other = new Outbox(directory, codec);
  const values = await Promise.all([box.enqueue(make(), scope), other.enqueue(make(), scope)]);
  assert.deepEqual(values.map(v => v.status).sort(), ['duplicate', 'queued']);
  assert.equal(values[0].messageId, values[1].messageId);
  let count = 0;
  await Promise.all([box.flush(scope, async () => { count++; }), other.flush(scope, async () => { count++; })]);
  assert.equal(count, 1);
});
test('queue destination cannot silently change', async t => {
  const { box } = await fixture(t);
  await box.enqueue(make(), scope);
  let called = false;
  await assert.rejects(box.flush({ ...scope, recipient: 'recipient-B' }, async () => { called = true; }), /destination_changed/);
  assert.equal(called, false);
  assert.equal((await box.status()).pending, 1);
});
test('corrupt encrypted storage is not discarded or treated as an empty outbox', async t => {
  const { box, directory } = await fixture(t);
  await box.enqueue(make(), scope);
  await writeFile(join(directory, 'outbox.dpapi'), randomBytes(64));
  await assert.rejects(box.enqueue(make('other'), scope));
});
test('notification rejects dynamic destinations and privileged inputs', () => {
  assert.throws(() => notification({ eventId: 'x', title: 't', summary: 's', status: 'completed', recipient: 'other' }), /invalid_notification/);
  assert.throws(() => notification({ eventId: 'x', title: 't', summary: 's', status: '__proto__' }), /invalid_notification/);
  assert.equal(fromStop({ hook_event_name: 'Interrupt' }), null);
  const value = fromStop({ hook_event_name: 'Stop', session_id: 'session', turn_id: 'turn', last_assistant_message: 'Готово' });
  assert.equal(value.status, 'finished');
  assert.equal(value.eventId, 'codex-stop:session:turn');
});
test('DPAPI encrypts and restores the sender secret without plaintext on disk', { skip: process.platform !== 'win32' }, async () => {
  const seed = randomBytes(32);
  const encrypted = await protect(seed);
  assert.equal(encrypted.includes(seed), false);
  assert.deepEqual(await unprotect(encrypted), seed);
});
