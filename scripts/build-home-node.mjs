// Legacy app command: build from the independent nodes project, then publish
// only its installer/manifest into the app download directory.
import { mkdir, copyFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const appRoot = fileURLToPath(new URL('../', import.meta.url));
if (!process.env.AUTOMESH_NODE_RUNTIME) {
  const runtime = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../nodes/adapters/windows/runtime.json', import.meta.url), 'utf8'));
  const cached = join(appRoot, '.release/home-node', 'node-v' + runtime.version + '.exe');
  try { await stat(cached); process.env.AUTOMESH_NODE_RUNTIME = cached; } catch { /* independent builder downloads the pinned runtime */ }
}
const nodePayload = join(appRoot, 'nodes/.release/home-node/payload');
await mkdir(nodePayload, { recursive: true });
try { await copyFile(join(appRoot, '.release/home-node/payload/LICENSE-Node.txt'), join(nodePayload, 'LICENSE-Node.txt')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
await import('../nodes/scripts/build-windows.mjs');
await mkdir(join(appRoot, 'static/downloads'), { recursive: true });
for (const name of ['Automesh-Node-Setup.exe', 'node-release.json']) await copyFile(join(appRoot, 'nodes/downloads', name), join(appRoot, 'static/downloads', name));
// Preserve the existing CI artifact path; node sources/builds live in nodes/.
await copyFile(join(appRoot, 'nodes/downloads/Automesh-Node-Setup.exe'), join(appRoot, '.release/home-node/Automesh-Node-Setup.exe'));
