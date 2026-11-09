import { mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
await import('../nodes/scripts/build-linux.mjs');
await mkdir(join(root, 'static/downloads'), { recursive: true });
for (const name of ['Automesh-Node-Linux-x64.tar.gz', 'node-linux-release.json']) await copyFile(join(root, 'nodes/downloads', name), join(root, 'static/downloads', name));
