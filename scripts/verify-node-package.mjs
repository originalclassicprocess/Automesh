// Delegates certificate, transparency-log and subject-digest validation to the
// official GitHub CLI. A checksum/unsigned JSON is never accepted as provenance.
import { createReadStream } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { packageVerificationArgs } from '../src/lib/application/package-provenance.js';

export async function packageHash(file) {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1024 * 1024 || stat.size > 256 * 1024 * 1024)
    throw new Error('invalid_package_file');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return { bytes: stat.size, sha256: hash.digest('hex') };
}

export async function verifyNodePackage(file, { commit, bundle, sha256 } = {}, run = spawnSync) {
  if (sha256 !== undefined && !/^[a-f0-9]{64}$/.test(sha256)) throw new Error('invalid_sha256');
  const args = packageVerificationArgs(resolve(file), commit);
  if (bundle !== undefined) {
    const stat = await lstat(bundle);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 4 * 1024 * 1024)
      throw new Error('invalid_provenance_bundle');
    args.push('--bundle', resolve(bundle));
  }
  const before = await packageHash(file);
  if (sha256 && before.sha256 !== sha256) throw new Error('package_checksum_mismatch');
  const result = run('gh', args, { encoding: 'utf8', shell: false, windowsHide: true, timeout: 90_000, maxBuffer: 4 * 1024 * 1024 });
  if (result.error?.code === 'ENOENT') throw new Error('github_cli_required');
  // No fallback on offline errors, wrong identity, missing proof, old CLI or timeout.
  // Never print raw verifier output: it can contain local paths/auth diagnostics.
  if (result.error || result.signal || result.status !== 0) throw new Error('package_provenance_not_verified');
  const after = await packageHash(file);
  if (after.sha256 !== before.sha256 || after.bytes !== before.bytes) throw new Error('package_changed_during_verification');
  return after;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2), options = new Map();
    for (let i = 0; i < args.length; i += 2) {
      if (!['--file', '--commit', '--bundle', '--sha256'].includes(args[i]) || !args[i + 1] || options.has(args[i]))
        throw new Error('usage: node scripts/verify-node-package.mjs --file <package> [--commit <40-hex>] [--bundle <proof>] [--sha256 <64-hex>]');
      options.set(args[i], args[i + 1]);
    }
    if (!options.has('--file')) throw new Error('package_file_required');
    await verifyNodePackage(options.get('--file'), { commit: options.get('--commit'), bundle: options.get('--bundle'), sha256: options.get('--sha256') });
    process.stdout.write('GitHub package provenance verified. This does not prove absence of vulnerabilities or Windows publisher trust.\n');
  } catch (error) {
    const allowed = /^(?:invalid_[a-z_]+|package_[a-z_]+|github_cli_required|usage:.*)$/;
    process.stderr.write((allowed.test(error.message) ? error.message : 'package_provenance_not_verified') + '\n');
    process.exitCode = 1;
  }
}
