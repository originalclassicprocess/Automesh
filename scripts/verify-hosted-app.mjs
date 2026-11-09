import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { boundedBody, downloadPublicApp } from './public-app-release.mjs';
export function verificationOrigin(input) {
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error('Specify a plain HTTPS origin');
  return url.origin;
}
export async function verifyHostedApp(input, tag) {
  const origin = verificationOrigin(input);
  const get = async (path, maximum) => boundedBody(await fetch(origin + path, {credentials: 'omit', redirect: 'error',
    cache: 'no-store', signal: AbortSignal.timeout(30000)}), maximum);
  const served = JSON.parse((await get('/build-info.json', 16384)).toString('utf8'));
  tag ??= `v${served.version}`;
  const temporary = await mkdtemp(join(tmpdir(), 'automesh-verify-'));
  const release = await downloadPublicApp(tag, join(temporary, 'verified-release'));
  for (const key of ['schema', 'version', 'buildVersion', 'repository', 'commit', 'dirty', 'source', 'workflow', 'runId'])
    if (served[key] !== release.info[key]) throw Error(`Hosted metadata mismatch: ${key}`);
  const assets = release.manifest.files.filter(file => file.path.startsWith('build/client/_app/immutable/') && !/\.(br|gz)$/.test(file.path));
  if (!assets.length) throw Error('No immutable client assets in package');
  let index = 0;
  await Promise.all(Array.from({length: 4}, async () => {
    while (index < assets.length) {
      const file = assets[index++], body = await get('/' + file.path.slice('build/client/'.length), 32 * 1024 * 1024);
      if (createHash('sha256').update(body).digest('hex') !== file.sha256) throw Error(`Hosted client asset mismatch: ${file.path}`);
    }
  }));
  console.log(JSON.stringify({origin, tag, commit: release.identity.commit, verifiedClientAssets: assets.length,
    attestation: true, limitation: 'Does not attest hidden server code, dynamic HTML, browser cache or security of the program itself.'}, null, 2));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await verifyHostedApp(process.argv[2], process.argv[3]); } catch (error) { console.error('Verification failed:', error.message); process.exitCode = 1; }
}
