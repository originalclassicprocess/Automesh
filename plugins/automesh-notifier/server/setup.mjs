import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { dataDir, DEFAULT_APP_URL, defaultBrowser, validateConfig } from './config.mjs';
import { protect, unprotect } from './protection.mjs';
import { senderIdentity, isValidAccountId } from '../dist/identity.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
const recipient = option('--recipient');
if (!isValidAccountId(recipient)) throw new Error('Pass --recipient with a valid public Automesh Account ID. Do not pass a seed.');
const directory = dataDir();
await mkdir(directory, { recursive: true });
let seed;
try { seed = await unprotect(await readFile(join(directory, 'sender.dpapi'))); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  seed = randomBytes(32);
  await writeFile(join(directory, 'sender.dpapi'), await protect(seed), { flag: 'wx' });
}
try {
  const identity = await senderIdentity(new Uint8Array(seed));
  const config = validateConfig({ version: 1, sender: identity.address, recipient,
    appUrl: option('--app-url', DEFAULT_APP_URL), browser: option('--browser', defaultBrowser()),
    ...(args.includes('--playwright-dir') ? { playwrightDirectory: option('--playwright-dir') } : {}),
    autoNotify: args.includes('--auto') });
  identity.provider.dispose();
  await writeFile(join(directory, 'config.json'), JSON.stringify(config, null, 2));
  console.log(JSON.stringify({ configured: true, sender: config.sender, recipient: config.recipient, autoNotify: config.autoNotify }));
} finally { seed.fill(0); }
