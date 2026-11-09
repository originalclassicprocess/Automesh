import { lstat, mkdir, mkdtemp, readFile, readdir, copyFile, writeFile } from 'node:fs/promises';
import { resolve, join, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalSourceChecksum } from './source-checksum.mjs';
import { execFileSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url)), target = join(root, 'nodes');
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--source') throw new Error('Usage: sync-node-source.mjs --source <canonical node repository>');
const source = resolve(args[1]);
const git = (...args) => execFileSync('git', args, { cwd: source, encoding: 'utf8', windowsHide: true }).trim();
const repository = 'originalclassicprocess/automesh-nodes', commit = git('rev-parse', 'HEAD');
if (!/^[a-f0-9]{40}$/.test(commit) || git('status', '--porcelain') ||
    git('remote', 'get-url', 'origin') !== `https://github.com/${repository}.git`) throw new Error('Clean canonical public checkout required');
const overlap = relative(target, source);
if (!overlap || (!overlap.startsWith('..') && !isAbsolute(overlap))) throw new Error('Source must be an independent checkout');
const allowed = ['package.json', 'package-lock.json', '.gitignore', 'LICENSE', 'README.md', 'README.ru.md', 'CHANGELOG.md', 'HISTORY.md', 'CONTRIBUTING.md', 'SECURITY.md', 'SECURITY.ru.md', 'THIRD_PARTY_NOTICES.md', 'app.cjs', 'packages', 'adapters', 'scripts', 'test', 'docs', '.github', 'ui'];
const paths = [];
async function walk(path) {
  const info = await lstat(join(source, path)); if (info.isSymbolicLink()) throw new Error('source_symlink');
  if (info.isDirectory()) { for (const name of await readdir(join(source, path))) await walk(path + '/' + name); }
  else if (info.isFile()) {
    if (/\.(?:key|pem|pfx|cer|cred|exe|zip|tar|gz)$/i.test(path) || /(?:^|\/)(?:\.env(?:\.|$)|config\.json|server-config\.json|state\.json|node_modules|\.git|\.release|downloads)(?:\/|$)/.test(path)) throw new Error('private_or_generated_source');
    paths.push(path);
  } else throw new Error('unsupported_source_file');
}
for (const path of allowed) await walk(path);
await mkdir(join(root, '.release'), { recursive: true });
const backup = await mkdtemp(join(root, '.release/node-source-backup-'));
const files = []; let changed = 0;
for (const path of paths.sort()) {
  const bytes = await readFile(join(source, path)), hash = canonicalSourceChecksum(bytes);
  let previous;
  try {
    // Reject destination links as well. Never follow one while backing up or overwriting.
    let current = target;
    for (const part of path.split('/')) { current = join(current, part); if ((await lstat(current)).isSymbolicLink()) throw new Error('destination_symlink'); }
    previous = await readFile(join(target, path));
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!previous || canonicalSourceChecksum(previous) !== hash) {
    if (previous) { await mkdir(dirname(join(backup, path)), { recursive: true }); await copyFile(join(target, path), join(backup, path)); }
    await mkdir(dirname(join(target, path)), { recursive: true }); await copyFile(join(source, path), join(target, path)); changed++;
  }
  files.push({ path, sha256: hash });
}
// Old extra files are preserved, not removed. Neither checkout's Git state is touched.
await writeFile(join(target, 'source-provenance.json'), JSON.stringify({ repository, commit, version: JSON.parse(await readFile(join(source, 'package.json'), 'utf8')).version, files }, null, 2) + '\n');
process.stdout.write(`Node source synchronized: ${changed} files changed; ${files.length} public files verified.\nPrevious versions preserved in ${backup}\n`);
