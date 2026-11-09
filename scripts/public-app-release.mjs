// Shared by the independent verifier and the private hosting relay. No downloaded code is executed.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { validateRelease } from '../server/deployment.mjs';
export const repository = 'originalclassicprocess/Automesh';
export const workflow = `${repository}/.github/workflows/release.yml`;
export function releaseIdentity(value, tag) {
  if (!/^v\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(tag ?? '') || !value || value.draft !== false || value.prerelease !== false ||
      value.tag_name !== tag || !/^[a-f0-9]{40}$/.test(value.target_commitish ?? '') ||
      value.html_url !== `https://github.com/${repository}/releases/tag/${tag}` || !Array.isArray(value.assets)) throw Error('Invalid public release');
  const name = `Automesh-App-${tag.slice(1)}-update.tar.gz`;
  const matches = value.assets.filter(asset => asset.name === name);
  if (matches.length !== 1) throw Error('Public release archive missing or duplicated');
  const asset = matches[0];
  if (asset.browser_download_url !== `https://github.com/${repository}/releases/download/${tag}/${name}` ||
      !Number.isSafeInteger(asset.size) || asset.size < 1024 || asset.size > 150 * 1024 * 1024 ||
      !/^sha256:[a-f0-9]{64}$/.test(asset.digest ?? '')) throw Error('Invalid public release archive');
  return { name, commit: value.target_commitish, url: asset.browser_download_url, bytes: asset.size, digest: asset.digest };
}
export function attestationArguments(file, commit) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw Error('Invalid source commit');
  return ['attestation', 'verify', file, '--repo', repository, '--signer-workflow', workflow,
    '--source-ref', 'refs/heads/main', '--source-digest', commit, '--signer-digest', commit,
    '--deny-self-hosted-runners', '--cert-oidc-issuer', 'https://token.actions.githubusercontent.com',
    '--predicate-type', 'https://slsa.dev/provenance/v1'];
}
export function checkArchiveListing(names, types) {
  const paths = names.trim().split(/\r?\n/), seen = new Set();
  if (!paths.length || paths.length > 12000) throw Error('Archive size limit');
  for (let name of paths) {
    if (name === './' || name === '.') continue;
    name = name.replace(/^\.\//, '').replace(/\/$/, '');
    if (!/^[A-Za-z0-9_.\/-]+$/.test(name) || name.startsWith('/') || name.split('/').some(p => !p || p === '.' || p === '..') || seen.has(name)) throw Error('Unsafe archive path');
    seen.add(name);
  }
  const lines = types.trim().split(/\r?\n/);
  if (lines.length !== paths.length || lines.some(line => !/^[-d]/.test(line))) throw Error('Archive links or special files forbidden');
  let total = 0;
  for (const line of lines) {
    const size = line.trim().split(/\s+/)[2];
    if (!/^\d+$/.test(size ?? '')) throw Error('Unrecognized tar listing');
    total += Number(size);
    if (total > 512 * 1024 * 1024) throw Error('Expanded archive size limit');
  }
}
export async function boundedBody(response, maximum) {
  if (!response.ok || !response.body) throw Error(`Public release request failed (${response.status})`);
  const reader = response.body.getReader(), chunks = []; let length = 0;
  try {
    while (true) { const {done, value} = await reader.read(); if (done) break; length += value.length;
      if (length > maximum) throw Error('Public release response too large'); chunks.push(value); }
    return Buffer.concat(chunks, length);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export async function downloadPublicApp(tag, destination) {
  const api = `https://api.github.com/repos/${repository}`;
  if (!/^v\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(tag ?? '')) throw Error('Invalid release tag');
  const headers = {Accept: 'application/vnd.github+json', 'User-Agent': 'Automesh-release-verifier'};
  const metadata = JSON.parse((await boundedBody(await fetch(`${api}/releases/tags/${tag}`, {
    headers, redirect: 'error', signal: AbortSignal.timeout(30000) }), 256 * 1024)).toString('utf8'));
  const identity = releaseIdentity(metadata, tag), out = resolve(destination);
  await mkdir(out); // A new isolated directory is required; never overwrite user data.
  const archive = join(out, identity.name);
  const bytes = await boundedBody(await fetch(identity.url, {credentials: 'omit', signal: AbortSignal.timeout(240000)}), identity.bytes);
  if (bytes.length !== identity.bytes || 'sha256:' + createHash('sha256').update(bytes).digest('hex') !== identity.digest) throw Error('Public release checksum mismatch');
  await writeFile(archive, bytes, {flag: 'wx'});
  execFileSync('gh', attestationArguments(archive, identity.commit), {stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000, maxBuffer: 4 * 1024 * 1024, windowsHide: true});
  const tar = args => execFileSync('tar', args, {encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024, windowsHide: true});
  checkArchiveListing(tar(['-tzf', archive]), tar(['-tvzf', archive]));
  const extracted = join(out, 'package'); await mkdir(extracted);
  tar(['--no-same-owner', '--no-same-permissions', '-xzf', archive, '-C', extracted]);
  const manifest = validateRelease(extracted);
  const info = JSON.parse(await readFile(join(extracted, 'docs/build-info.json'), 'utf8'));
  if (info.schema !== 1 || info.version !== tag.slice(1) || info.commit !== identity.commit || info.repository !== repository ||
      info.source !== 'github-actions' || info.workflow !== workflow || info.dirty !== false || manifest.version !== info.buildVersion) throw Error('Attested package source metadata mismatch');
  return {directory: extracted, manifest, info, identity};
}
