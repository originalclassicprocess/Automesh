// Offline integrity/allowlist checks. Never starts an app or contacts hosting.
import assert from 'node:assert/strict';
import { readFile, lstat, readdir } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
const root = resolve(import.meta.dirname, '..'), directory = resolve(process.argv[2] || '');
const child = relative(join(root, '.release'), directory);
assert.ok(child.startsWith('clean-start-') && !isAbsolute(child) && !child.includes('..'));
const metadata = JSON.parse(await readFile(join(directory, 'prepared.json'), 'utf8'));
assert.equal(metadata.preparedOnly, true); assert.equal(metadata.deployed, false);
assert.equal(metadata.secretsIncluded, false); assert.equal(metadata.accountDataIncluded, false);
const files = metadata.files;
assert.ok(Array.isArray(files) && files.length === 7);
for (const item of files) {
  assert.match(item.path, /^[A-Za-z0-9.-]+$/);
  const path = join(directory, item.path); assert.ok(!(await lstat(path)).isSymbolicLink());
  const bytes = await readFile(path); assert.equal(bytes.length, item.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), item.sha256);
}
const allowed = new Set([...files.map(f => f.path), 'SHA256SUMS.txt', 'prepared.json']);
for (const name of await readdir(directory)) assert.ok(allowed.has(name), 'Unexpected bundle file: ' + name);
const sums = await readFile(join(directory, 'SHA256SUMS.txt'), 'utf8');
for (const item of files) assert.ok(sums.includes(`${item.sha256}  ${item.path}\n`));
const run = promisify(execFile);
for (const item of files.filter(f => f.path.endsWith('.tar.gz'))) {
  const { stdout } = await run('tar', ['-tzf', join(directory, item.path)], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  for (const path of stdout.trim().split(/\r?\n/)) {
    assert.ok(!path.startsWith('/') && !path.includes('\\') && !path.split('/').includes('..'), 'Archive traversal');
    assert.doesNotMatch(path, /(?:^|\/)(?:\.git|\.deploy-secrets|\.automesh-node-private|\.automesh-node-data|data|private|config\.json|state\.json|\.env)(?:\/|$)|\.(?:pem|pfx|cred|key)$/i, 'Private data in archive: ' + path);
  }
}
const windows = JSON.parse(await readFile(join(directory, 'node-release.json'), 'utf8'));
const linux = JSON.parse(await readFile(join(directory, 'node-linux-release.json'), 'utf8'));
for (const [manifest, name] of [[windows, 'Automesh-Node-Setup.exe'], [linux, 'Automesh-Node-Linux-x64.tar.gz']]) {
  assert.equal(manifest.version, metadata.nodeVersion); assert.equal(manifest.sha256, files.find(f => f.path === name).sha256);
  assert.equal(manifest.signed, false);
}
console.log(JSON.stringify({ offlinePackageChecks: true, appVersion: metadata.appVersion, nodeVersion: metadata.nodeVersion, files: files.length, deployed: false }));
