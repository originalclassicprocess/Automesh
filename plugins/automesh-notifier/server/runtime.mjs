import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dataDir, readConfig } from './config.mjs';
import { unprotect } from './protection.mjs';
import { notification } from './notifications.mjs';
import { Outbox } from './outbox.mjs';
import { startBrowserClient } from './browser.mjs';

export async function status() {
  try {
    const directory = dataDir();
    const config = await readConfig(directory);
    return { configured: true, sender: config.sender, recipient: config.recipient,
      autoNotify: config.autoNotify, ...await new Outbox(directory).status() };
  } catch (error) {
    return { configured: false, reason: error.message === 'notifier_not_configured' ? error.message : 'configuration_unavailable' };
  }
}
export async function probe() {
  const directory = dataDir();
  const config = await readConfig(directory);
  const seed = await unprotect(await readFile(join(directory, 'sender.dpapi')));
  let client;
  try {
    client = await startBrowserClient(config, seed);
    return { registered: true, sender: config.sender, recipient: config.recipient,
      ...await client.page.evaluate(() => globalThis.automeshClient.getStatus()) };
  } finally { seed.fill(0); await client?.close(); }
}
export async function flush() {
  const directory = dataDir();
  const config = await readConfig(directory);
  return new Outbox(directory).flush(config, async entry => {
    const seed = await unprotect(await readFile(join(directory, 'sender.dpapi')));
    let client;
    try {
      if (seed.length !== 32) throw new Error('invalid_sender_seed');
      client = await startBrowserClient(config, seed);
      seed.fill(0);
      await client.send(entry);
    } finally { seed.fill(0); await client?.close(); }
  });
}
export async function notify(input, { automatic = false } = {}) {
  const entry = notification(input);
  const directory = dataDir();
  const config = await readConfig(directory);
  if (automatic && !config.autoNotify) return { status: 'disabled' };
  const queued = await new Outbox(directory).enqueue(entry, {
    sender: config.sender, recipient: config.recipient, appUrl: config.appUrl,
  });
  if (queued.status === 'duplicate') return queued;
  const result = await flush();
  // FIFO: a prior pending notification may have been delivered instead.
  const remaining = await new Outbox(directory).locked(async () => (await new Outbox(directory).read()).pending.some(item => item.key === entry.key));
  return { status: remaining ? 'queued' : 'delivered', messageId: entry.messageId, pending: result.pending };
}
