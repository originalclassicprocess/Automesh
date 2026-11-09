import { mkdir, readdir, lstat, readFile, copyFile, writeFile } from 'node:fs/promises';
import { resolve, join, dirname, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url)), source = join(root, 'nodes');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--output')) throw new Error('Usage: export-node-project.mjs [--output <new directory>]');
const output = args.length ? resolve(args[1]) : join(root, '.release', 'automesh-nodes-' + Date.now());
const withinSource = relative(source, output);
if (!withinSource || (!withinSource.startsWith('..') && !isAbsolute(withinSource))) throw new Error('Output cannot be inside the source project');
try { await lstat(output); throw new Error('Output must be a new directory; never overwrite an existing checkout'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
// Explicit source allowlist. Never export local configs, .git, caches, keys,
// credentials, queue data, runtimes or previous build/download directories.
const allowed = ['package.json', 'package-lock.json', '.gitignore', 'LICENSE', 'README.md', 'README.ru.md', 'CHANGELOG.md', 'HISTORY.md', 'CONTRIBUTING.md', 'SECURITY.md', 'SECURITY.ru.md', 'THIRD_PARTY_NOTICES.md', 'app.cjs', 'packages', 'adapters', 'scripts', 'test', 'docs', '.github', 'ui'];
const paths = [];
async function enumerate(path) {
  const info = await lstat(join(source, path));
  if (info.isSymbolicLink()) throw new Error('Source symlinks are forbidden');
  if (info.isDirectory()) {
    for (const entry of await readdir(join(source, path))) await enumerate(path + '/' + entry);
  } else if (info.isFile()) paths.push(path);
  else throw new Error('Unsupported source file');
}
for (const path of allowed) await enumerate(path);
await mkdir(output, { recursive: true });
const manifest = [];
for (const path of paths.sort()) {
  await mkdir(dirname(join(output, path)), { recursive: true });
  await copyFile(join(source, path), join(output, path));
  manifest.push({ path, sha256: createHash('sha256').update(await readFile(join(output, path))).digest('hex') });
}
await writeFile(join(output, 'source-manifest.json'), JSON.stringify({ project: 'automesh-nodes', files: manifest }, null, 2) + '\n');
process.stdout.write(`Standalone node project prepared (not published): ${output}\nSource files: ${manifest.length}\n`);
