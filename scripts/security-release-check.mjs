// A reproducible internal gate, not a vulnerability scanner or external audit.
import { readFile, readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { sourceChecksumMatches } from './source-checksum.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const json = async path => JSON.parse(await readFile(join(root, path), 'utf8'));
const hash = async path => createHash('sha256').update(await readFile(join(root, path))).digest('hex');
const app = await json('package.json'), lock = await json('package-lock.json');
assert.equal(app.version, lock.version); assert.equal(app.version, lock.packages[''].version);
const node = await json('nodes/package.json'), nodeLock = await json('nodes/package-lock.json');
assert.equal(node.version, nodeLock.version); assert.equal(node.version, nodeLock.packages[''].version);
const provenance = await json('nodes/source-provenance.json');
assert.equal(provenance.version, node.version);
for (const file of provenance.files) assert.ok(sourceChecksumMatches(await readFile(join(root, 'nodes', file.path)), file.sha256), 'Node source drift: ' + file.path);
let sources = 0;
async function walk(path) {
  for (const entry of await readdir(join(root, path), { withFileTypes: true })) {
    const next = path + '/' + entry.name;
    if (entry.isDirectory()) { await walk(next); continue; }
    if (!/\.(?:[cm]?js|ts|svelte)$/.test(entry.name) || /\.(?:test|fixture)\./.test(entry.name) || /(?:^|\/)(?:dev|fixtures)(?:\/|$)/.test(next)) continue;
    assert.ok(!entry.isSymbolicLink(), 'Source symlink: ' + next);
    const source = await readFile(join(root, next), 'utf8'); sources++;
    assert.doesNotMatch(source, /\{@html\b|\.innerHTML\s*=|\beval\s*\(|\bnew\s+Function\s*\(/, 'Executable content sink: ' + next);
  }
}
for (const path of ['src', 'server', 'nodes/packages', 'nodes/adapters', 'nodes/ui']) await walk(path);
for (const [manifest, name] of [['node-release.json', 'Automesh-Node-Setup.exe'], ['node-linux-release.json', 'Automesh-Node-Linux-x64.tar.gz']]) {
  const value = await json('static/downloads/' + manifest), path = 'static/downloads/' + name;
  assert.equal(value.version, node.version); assert.equal(value.url, '/downloads/' + name);
  assert.equal(value.signed, false, 'This preview has no independent signing certificate');
  assert.equal((await lstat(join(root, path))).size, value.bytes); assert.equal(await hash(path), value.sha256);
}
const listing = spawnSync('tar', ['-tzf', join(root, 'static/downloads/Automesh-Node-Linux-x64.tar.gz')], { encoding: 'utf8', windowsHide: true });
assert.equal(listing.status, 0);
const names = listing.stdout.trim().split(/\r?\n/);
assert.ok(names.includes('bin/node') && names.includes('automesh-node') && names.includes('ui/panel.html'));
for (const path of names) {
  assert.ok(!path.startsWith('/') && !path.includes('\\') && !path.split('/').includes('..'), 'Archive traversal');
  assert.doesNotMatch(path, /(?:^|\/)(?:\.git|\.env(?:\.|$)|\.release|test|downloads|private|data)(?:\/|$)|\.(?:pem|pfx|key|cred|exe)$/i, 'Private/test/unrelated payload: ' + path);
  assert.ok(!path.startsWith('adapters/windows/'), 'Windows adapter in Linux package');
}
const inventory = provenance.kind === 'local-source-snapshot' ? 'local snapshot node' : 'canonical node';
process.stdout.write(`Internal release gate passed: ${sources} production source files scanned; ${provenance.files.length} ${inventory} files matched; both artifact hashes and Linux payload allowlist checked.\nThis is not a claim of zero vulnerabilities, anonymity, external crypto review, or signed publication.\n`);
