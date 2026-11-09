import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Svelte/Vite may load the config more than once during one build. A timestamp
// created on each import makes HTML, version.json and worker disagree. Hash the
// fixed inputs instead; no generated output or user data participates.
export function buildVersion(root = resolve(import.meta.dirname, '..')) {
  if (process.env.MESH_APP_VERSION) return process.env.MESH_APP_VERSION;
  const hash = createHash('sha256');
  const add = path => { hash.update(path + '\0'); hash.update(readFileSync(join(root, path))); };
  function walk(path) {
    for (const entry of readdirSync(join(root, path), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = path + '/' + entry.name;
      if (entry.isDirectory()) walk(child); else add(child);
    }
  }
  for (const path of ['src', 'static', 'server', 'scripts']) walk(path);
  // Extracted dependencies must participate in the client/server version hash.
  walk('nodes/packages/protocol/src');
  walk('nodes/packages/deployment/src');
  for (const path of ['nodes/packages/runtime/src/signaling.js', 'nodes/packages/runtime/src/limits.js']) add(path);
  for (const path of ['package.json', 'package-lock.json', 'svelte.config.js', 'vite.config.ts']) add(path);
  return `v${JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version}-${hash.digest('hex').slice(0, 16)}`;
}
