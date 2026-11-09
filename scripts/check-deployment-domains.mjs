// Offline regression guard: product addresses belong in public defaults, not
// in network/UI branches. Historical docs and explicit test fixtures may retain
// old URLs to test compatibility; examples below must match the current defaults.
import { readdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import { deploymentDefaults } from '../nodes/packages/deployment/src/defaults.js';
const root = resolve(import.meta.dirname, '..');
let count = 0;
async function scan(path) {
  for (const entry of await readdir(join(root, path), { withFileTypes: true })) {
    const name = path + '/' + entry.name;
    if (/(?:^|\/)(?:test|dev|fixtures)(?:\/|$)/.test(name) || /\.(?:test|fixture)\./.test(name)) continue;
    if (entry.isDirectory()) await scan(name);
    else if (/\.(?:[cm]?js|ts|svelte|ps1)$/.test(entry.name) && name !== 'nodes/packages/deployment/src/defaults.js') {
      const text = await readFile(join(root, name), 'utf8');
      assert.doesNotMatch(text, /\bautomesh\.(?:space|online|org)\b/i, 'Product domain hardcoded outside defaults: ' + name); count++;
    }
  }
}
for (const path of ['src', 'server', 'nodes/packages', 'nodes/adapters']) await scan(path);
const env = await readFile(join(root, '.env.example'), 'utf8');
assert.ok(env.split(/\r?\n/).includes('ORIGIN=' + deploymentDefaults.appOrigin));
const example = JSON.parse(await readFile(join(root, 'nodes/adapters/server/config.example.json'), 'utf8'));
assert.deepEqual(example.allowedOrigins, [deploymentDefaults.appOrigin]);
assert.equal(deploymentDefaults.projectOrigin, '', 'Website must remain disabled until an owned domain is configured');
assert.equal(new Set(Object.values(deploymentDefaults).filter(Boolean)).size, 2);
console.log(`Domain separation passed: ${count} production files; shared defaults and examples consistent; no network requests.`);
