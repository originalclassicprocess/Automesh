// Local packaging only. No DNS, SSH, hosting, account or GitHub operations.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { deploymentDefaults } from '../nodes/packages/deployment/src/defaults.js';
const run = promisify(execFile), root = resolve(import.meta.dirname, '..');
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const { version: nodeVersion } = JSON.parse(await readFile(join(root, 'nodes/package.json'), 'utf8'));
const previous = process.argv.slice(2);
for(let i=0;i<previous.length;i+=2) if(previous[i]!=='--previous-release' || !previous[i+1])
  throw new Error('Only repeated --previous-release <local release> options are supported');
const suffix = randomUUID().slice(0, 8), release = `automesh-${version.replaceAll('.', '-')}-clean-${suffix}`;
const directory = join(root, '.release', `clean-start-${version}-${suffix}`);
await mkdir(directory);
const options = { cwd: root, windowsHide: true, timeout: 180000, maxBuffer: 8 * 1024 * 1024 };
await run(process.execPath, [join(root, 'scripts/prepare-release.mjs'), '--output', `.release/${release}`, ...previous], options);
const appArchive = `Automesh-App-${version}-clean.tar.gz`;
await run('tar', ['-czf', join(directory, appArchive), '-C', join(root, '.release'), release], options);
const shared = await run(process.execPath, [join(root, 'nodes/scripts/package-shared-host.mjs')], options);
const nodeBuild = JSON.parse(shared.stdout.trim());
const nodeArchive = `Automesh-Node-${nodeVersion}-shared-clean.tar.gz`;
await copyFile(nodeBuild.archive, join(directory, nodeArchive));
await copyFile(join(root, 'docs/CLEAN_START.md'), join(directory, 'START-HERE.md'));
// Optional home installers were rebuilt separately. These are convenience copies,
// not required to install the shared-host node.
for (const name of ['Automesh-Node-Setup.exe', 'node-release.json', 'Automesh-Node-Linux-x64.tar.gz', 'node-linux-release.json'])
  await copyFile(join(root, 'static/downloads', name), join(directory, name));
const names = [appArchive, nodeArchive, 'START-HERE.md', 'Automesh-Node-Setup.exe', 'node-release.json', 'Automesh-Node-Linux-x64.tar.gz', 'node-linux-release.json'];
const files = [];
for (const path of names) { const bytes = await readFile(join(directory, path)); files.push({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }); }
await writeFile(join(directory, 'SHA256SUMS.txt'), files.map(f => `${f.sha256}  ${f.path}`).join('\n') + '\n');
await writeFile(join(directory, 'prepared.json'), JSON.stringify({ preparedOnly: true, deployed: false, appVersion: version, nodeVersion,
  domains: deploymentDefaults, appBuild: JSON.parse(await readFile(join(root, 'build/client/_app/version.json'), 'utf8')).version,
  nodeSource: { baseRevision: nodeBuild.baseRevision, sourceModified: nodeBuild.sourceModified, attested: false },
  files, secretsIncluded: false, accountDataIncluded: false }, null, 2) + '\n');
console.log(JSON.stringify({ directory, appVersion: version, nodeVersion, preparedOnly: true, deployed: false }));
