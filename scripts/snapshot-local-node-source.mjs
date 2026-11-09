// Explicit local source inventory, NOT a canonical GitHub source attestation.
import { readFile, readdir, lstat, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonicalSourceChecksum } from './source-checksum.mjs';
const root = resolve(import.meta.dirname, '..'), node = join(root, 'nodes');
if (process.argv[2] !== '--local-preparation') throw new Error('Use --local-preparation; this is not a canonical source sync');
const previous = JSON.parse(await readFile(join(node, 'source-provenance.json'), 'utf8'));
const allowed = ['package.json', 'package-lock.json', '.gitignore', 'LICENSE', 'README.md', 'README.ru.md', 'CHANGELOG.md', 'HISTORY.md', 'CONTRIBUTING.md', 'SECURITY.md', 'SECURITY.ru.md', 'THIRD_PARTY_NOTICES.md', 'app.cjs', 'packages', 'adapters', 'scripts', 'test', 'docs', '.github', 'ui'];
const files = [];
async function walk(path) {
  const info = await lstat(join(node, path));
  if (info.isSymbolicLink()) throw new Error('source_symlink');
  if (info.isDirectory()) { for (const name of await readdir(join(node, path))) await walk(path + '/' + name); }
  else if (info.isFile()) {
    if (/\.(?:key|pem|pfx|cer|cred|exe|zip|tar|gz)$/i.test(path) || /(?:^|\/)(?:\.env(?:\.|$)|config\.json|server-config\.json|state\.json|node_modules|\.git|\.release|downloads)(?:\/|$)/.test(path)) throw new Error('private_or_generated_source');
    const bytes = await readFile(join(node, path));
    files.push({ path, sha256: canonicalSourceChecksum(bytes) });
  } else throw new Error('source_file');
}
for (const path of allowed) await walk(path);
files.sort((a,b) => a.path.localeCompare(b.path));
await mkdir(join(root, '.release'), { recursive: true });
await copyFile(join(node, 'source-provenance.json'), join(root, '.release', `node-source-inventory-${randomUUID()}.json`));
const { version } = JSON.parse(await readFile(join(node, 'package.json'), 'utf8'));
await writeFile(join(node, 'source-provenance.json'), JSON.stringify({ kind: 'local-source-snapshot',
  baseVersion: previous.baseVersion ?? previous.version, version, files }, null, 2) + '\n');
console.log(`Local node source snapshot: ${files.length} files; no GitHub publication or attestation.`);
