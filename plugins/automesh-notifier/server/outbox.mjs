import { mkdir, readFile, rename, open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { protect, unprotect } from './protection.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export class Outbox {
  constructor(directory, codec = { protect, unprotect }) { this.directory = directory; this.codec = codec; }
  async locked(work) {
    await mkdir(this.directory, { recursive: true });
    const path = join(this.directory, 'outbox.lock');
    const deadline = Date.now() + 45000;
    let lock;
    while (!lock) {
      try { lock = await open(path, 'wx'); await lock.writeFile(String(process.pid)); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        // Fail closed on a stale lock. Concurrent reclamation could otherwise
        // delete a lock already acquired by a different sender.
        try {
          const pid = Number(await readFile(path, 'utf8'));
          if (Number.isSafeInteger(pid) && pid > 0) {
            try { process.kill(pid, 0); }
            catch (error) { if (error.code === 'ESRCH') throw new Error('notifier_stale_lock'); }
          }
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (Date.now() >= deadline) throw new Error('notifier_busy');
        await sleep(100);
      }
    }
    try { return await work(); }
    finally { await lock.close(); await unlink(path); }
  }
  async read() {
    try {
      const bytes = await this.codec.unprotect(await readFile(join(this.directory, 'outbox.dpapi')));
      try {
        const state = JSON.parse(bytes.toString('utf8'));
        if (state.version !== 1 || !Array.isArray(state.pending) || !Array.isArray(state.sent)) throw new Error('invalid_outbox');
        return state;
      } finally { bytes.fill(0); }
    } catch (error) { if (error.code === 'ENOENT') return { version: 1, pending: [], sent: [] }; throw error; }
  }
  async save(state) {
    const clear = Buffer.from(JSON.stringify(state));
    let encrypted;
    try { encrypted = await this.codec.protect(clear); } finally { clear.fill(0); }
    const temporary = join(this.directory, `outbox-${randomUUID()}.tmp`);
    try {
      const file = await open(temporary, 'wx');
      try { await file.writeFile(encrypted); await file.sync(); } finally { await file.close(); }
      await rename(temporary, join(this.directory, 'outbox.dpapi'));
    } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  async enqueue(entry, scope) {
    return this.locked(async () => {
      const state = await this.read();
      const existing = state.pending.find(item => item.key === entry.key);
      if (existing) return { status: 'duplicate', messageId: existing.messageId };
      if (state.sent.includes(entry.key)) return { status: 'duplicate' };
      if (state.pending.length >= 128) throw new Error('outbox_capacity');
      state.pending.push({ ...entry, ...scope, attempts: 0 });
      await this.save(state);
      return { status: 'queued', messageId: entry.messageId };
    });
  }
  async status() {
    return this.locked(async () => {
      const state = await this.read();
      return { pending: state.pending.length, lastError: state.pending.find(item => item.lastError)?.lastError ?? null };
    });
  }
  async flush(scope, send) {
    return this.locked(async () => {
      const state = await this.read();
      let delivered = 0;
      // One notification per flush bounds browser lifetime and hook latency.
      const entry = state.pending[0];
      if (entry) {
        if (entry.recipient !== scope.recipient || entry.sender !== scope.sender || entry.appUrl !== scope.appUrl)
          throw new Error('outbox_destination_changed');
        entry.attempts++;
        try {
          await send(entry);
          state.pending.shift(); state.sent.push(entry.key);
          state.sent = state.sent.slice(-4096); delivered++;
        } catch { entry.lastError = 'delivery_unconfirmed'; }
        await this.save(state);
      }
      return { delivered, pending: state.pending.length };
    });
  }
}
