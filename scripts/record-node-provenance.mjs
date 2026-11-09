import { readFile, writeFile, copyFile, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { packageArtifacts, packageRepository, packageWorkflow, packageRef, parsePackageProvenance } from '../src/lib/application/package-provenance.js';
import { verifyNodePackage } from './verify-node-package.mjs';

export function provenanceContext(env) {
  if (env.AUTOMESH_REPOSITORY_VISIBILITY !== 'public') throw new Error('public_repository_required_for_free_provenance');
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_REPOSITORY !== packageRepository ||
      env.GITHUB_REF !== packageRef || env.GITHUB_WORKFLOW_REF !== `${packageWorkflow}@${packageRef}` ||
      !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '') || !/^[1-9][0-9]{0,19}$/.test(env.GITHUB_RUN_ID ?? '') ||
      env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || env.RUNNER_ENVIRONMENT !== 'github-hosted')
    throw new Error('github_release_context_required');
  return { commit: env.GITHUB_SHA, runId: env.GITHUB_RUN_ID };
}

export async function readPackageManifest(directory, platform) {
  if (!Object.hasOwn(packageArtifacts, platform)) throw new Error('invalid_platform');
  const path = join(directory, packageArtifacts[platform].manifest), stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192) throw new Error('invalid_download_manifest');
  const value = JSON.parse(await readFile(path, 'utf8'));
  if (!value || value.url !== `/downloads/${packageArtifacts[platform].file}` ||
      !/^[a-f0-9]{64}$/.test(value.sha256) || !Number.isSafeInteger(value.bytes) ||
      value.bytes < 1024 * 1024 || value.bytes > 256 * 1024 * 1024 || value.signed !== false)
    throw new Error('invalid_download_manifest');
  return value;
}

export async function recordNodeProvenance(directory, platform, bundle, env = process.env, run) {
  const context = provenanceContext(env), manifest = await readPackageManifest(directory, platform);
  if (manifest.provenance !== undefined) throw new Error('provenance_already_recorded');
  const artifact = packageArtifacts[platform];
  const checked = await verifyNodePackage(join(directory, artifact.file), { commit: context.commit, bundle, sha256: manifest.sha256 }, run);
  if (checked.bytes !== manifest.bytes) throw new Error('package_size_mismatch');
  const provenance = { type: 'github-actions', repository: packageRepository, workflow: packageWorkflow,
    ref: packageRef, ...context, bundleUrl: `/downloads/${artifact.file}.sigstore.json` };
  parsePackageProvenance(platform, provenance);
  await copyFile(bundle, join(directory, artifact.file + '.sigstore.json'));
  // Only after actual gh verification succeeds; still NOT Authenticode signed.
  await writeFile(join(directory, artifact.manifest), JSON.stringify({ ...manifest, provenance }, null, 2) + '\n');
}

export async function verifyPublishedNodePackages(directory, env = process.env, run) {
  const context = provenanceContext(env);
  for (const platform of ['windows', 'linux']) {
    const manifest = await readPackageManifest(directory, platform), provenance = parsePackageProvenance(platform, manifest.provenance);
    if (!provenance || provenance.commit !== context.commit || provenance.runId !== context.runId)
      throw new Error('current_release_provenance_required');
    const artifact = packageArtifacts[platform];
    const checked = await verifyNodePackage(join(directory, artifact.file), { commit: context.commit,
      bundle: join(directory, artifact.file + '.sigstore.json'), sha256: manifest.sha256 }, run);
    if (checked.bytes !== manifest.bytes) throw new Error('package_size_mismatch');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const directory = fileURLToPath(new URL('../static/downloads/', import.meta.url));
    const [platform, bundle, extra] = process.argv.slice(2);
    if (platform === '--check-context' && !bundle) provenanceContext(process.env);
    else if (platform === '--verify-all' && !bundle) await verifyPublishedNodePackages(directory);
    else if (Object.hasOwn(packageArtifacts, platform ?? '') && bundle && !extra) await recordNodeProvenance(directory, platform, bundle);
    else throw new Error('invalid_provenance_arguments');
    process.stdout.write(platform === '--check-context' ? 'Public hosted release context validated; packages not yet verified.\n' : 'GitHub package provenance gate passed.\n');
  } catch {
    process.stderr.write('GitHub package provenance gate failed; nothing may be published as verified. Check public repository, official gh CLI and signed bundle.\n');
    process.exitCode = 1;
  }
}
