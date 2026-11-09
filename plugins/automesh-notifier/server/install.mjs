import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { dataDir, pluginRoot } from './config.mjs';
import { isValidAccountId } from '../dist/identity.mjs';

// Operator-facing setup, never an MCP tool. All destinations are local,
// selected by this script; account IDs never pass through a command shell.
const args = process.argv.slice(2);
const recipientIndex = args.indexOf('--recipient');
if (process.platform !== 'win32') throw new Error('This release requires Windows DPAPI.');
if (recipientIndex < 0 || !isValidAccountId(args[recipientIndex + 1]))
  throw new Error('Supply --recipient with your own public Automesh Account ID.');
async function run(command, arguments_, cwd) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, { cwd, stdio: 'inherit', windowsHide: true });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error('Installation step failed.')));
  });
}
const runtime = join(dataDir(), 'runtime');
await mkdir(runtime, { recursive: true });
const packageInfo = JSON.parse(await readFile(join(pluginRoot, 'package.json'), 'utf8'));
await writeFile(join(runtime, 'package.json'), JSON.stringify({
  name: 'automesh-notifier-user-runtime', private: true, version: packageInfo.version,
  dependencies: packageInfo.dependencies,
}, null, 2));
// Fixed command, no user values in shell code. Dependencies live outside the
// installed plugin cache and survive upgrades/source-directory moves.
await run('cmd.exe', ['/d', '/s', '/c', 'npm install --ignore-scripts --no-audit --no-fund'], runtime);
await run(process.execPath, [join(pluginRoot, 'server/setup.mjs'), ...args], pluginRoot);
let marketplace = pluginRoot;
try { await access(join(pluginRoot, '.agents/plugins/marketplace.json')); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  marketplace = resolve(pluginRoot, '../..');
  await access(join(marketplace, '.agents/plugins/marketplace.json'));
}
await run('codex', ['plugin', 'marketplace', 'add', marketplace, '--json'], marketplace);
await run('codex', ['plugin', 'add', 'automesh-notifier@mesh-autonomy-local', '--json'], marketplace);
console.log('Installed. Restart/reload Codex, then review and trust the Stop hook in the UI.');
