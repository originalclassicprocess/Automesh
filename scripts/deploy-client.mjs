// Called manually or by the main-only GitHub deployment job. Branch/environment
// protection is an operator setting, not guaranteed by this workflow's guard.
// Never imports private keys into the application or uploads node_modules/.env.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync, existsSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { validateRelease } from '../server/deployment.mjs';

const repository = resolve(fileURLToPath(new URL('..', import.meta.url)));
function homePath(value, user) {
  if (typeof value !== 'string' || !value.startsWith(`/home/${user}/`) || value.length > 240 ||
      !/^\/[A-Za-z0-9_./-]+$/.test(value) || value.split('/').slice(1).some(part => !part || part === '.' || part === '..'))
    throw new Error('Deployment paths must be explicit directories below the SSH account home');
  return value;
}
export function deploymentSettings(env) {
  const host = env.SSH_HOST; const user = env.SSH_USER; const port = env.SSH_PORT;
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/.test(host || '') ||
      !/^[a-z][a-z0-9_-]{0,31}$/.test(user || '') || !/^[0-9]{1,5}$/.test(port || '') || Number(port) < 1 || Number(port) > 65535)
    throw new Error('Configure SSH_HOST, SSH_USER and SSH_PORT repository variables');
  const root = homePath(env.DEPLOY_ROOT, user); const node = homePath(env.DEPLOY_NODE_BIN, user);
  if (basename(root).startsWith('.') || basename(node) !== 'node') throw new Error('Invalid application root or Node executable');
  let url;
  try { url = new URL(env.DEPLOY_ORIGIN); } catch { throw new Error('Configure DEPLOY_ORIGIN'); }
  if (url.protocol !== 'https:' || url.origin !== env.DEPLOY_ORIGIN || url.username || url.password)
    throw new Error('DEPLOY_ORIGIN must be a canonical HTTPS origin');
  const runId = env.DEPLOY_RUN_ID || `local-${Date.now()}-${randomUUID()}`;
  if (!/^(?:[0-9]+-[0-9]+|local-[0-9]+-[a-f0-9-]{36})$/.test(runId)) throw new Error('Invalid deployment run ID');
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('TLS verification must remain enabled');
  return { host, user, port, root, node, origin: url.origin, runId };
}
export function sshArguments(config, key, hosts) {
  return ['-i', key, '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes',
    '-o', `UserKnownHostsFile=${hosts}`, '-o', 'ConnectTimeout=10', '-o', 'ConnectionAttempts=1',
    '-o', 'ForwardAgent=no', '-o', 'ClearAllForwardings=yes'];
}
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
export function releaseArchiveArguments(release, archive) {
  return ['-czf', archive, '-C', dirname(release), '--', basename(release)];
}
export async function deployClient(operation, releaseDirectory, env = process.env, run = spawnSync) {
  if (!['deploy', 'rollback'].includes(operation)) throw new Error('Choose deploy or rollback');
  const config = deploymentSettings(env);
  let release;
  if (operation === 'deploy') {
    if (!releaseDirectory) throw new Error('Specify the prepared release directory');
    release = resolve(releaseDirectory);
    const child = relative(join(repository, '.release'), release);
    if (!/^automesh-[a-z0-9-]+$/.test(child) || isAbsolute(child)) throw new Error('Release must be directly inside .release');
    validateRelease(release);
  }
  const secretKey = env.SSH_PRIVATE_KEY;
  const knownHosts = env.SSH_KNOWN_HOSTS;
  const keyPath = env.DEPLOY_SSH_KEY_FILE; const hostsPath = env.DEPLOY_KNOWN_HOSTS_FILE;
  if ((!keyPath || !hostsPath) && (!secretKey?.includes('PRIVATE KEY-----') || !knownHosts?.trim()))
    throw new Error('Configure SSH_PRIVATE_KEY and SSH_KNOWN_HOSTS secrets (or explicit local credential files)');
  if (keyPath && (!hostsPath || !existsSync(keyPath) || !existsSync(hostsPath))) throw new Error('Local SSH credential file missing');
  const temporary = (!keyPath || !hostsPath) ? mkdtempSync(join(tmpdir(), 'automesh-ssh-')) : null;
  const created = [];
  let archiveTemporary;
  try {
    let key = keyPath; let hosts = hostsPath;
    if (temporary) {
      key = join(temporary, 'key'); hosts = join(temporary, 'known_hosts');
      // Secrets never appear in command arguments, artifact files or stdout.
      writeFileSync(key, secretKey.trim() + '\n', { flag: 'wx', mode: 0o600 }); created.push(key);
      writeFileSync(hosts, knownHosts.trim() + '\n', { flag: 'wx', mode: 0o600 }); created.push(hosts);
    }
    const options = sshArguments(config, key, hosts); const destination = `${config.user}@${config.host}`;
    const command = (program, args) => {
      const result = run(program, args, { stdio: 'inherit', timeout: 10 * 60 * 1000, env: { ...env,
        SSH_PRIVATE_KEY: '', SSH_KNOWN_HOSTS: '' } });
      if (result.status !== 0) throw new Error(`${program} failed; live site was not necessarily changed — inspect deployment result`);
    };
    const ssh = remote => command('ssh', ['-T', '-p', config.port, ...options, destination, remote]);
    const copy = (source, target, recursive = false) => command('scp', ['-P', config.port, ...options,
      ...(recursive ? ['-r'] : []), source, `${destination}:${target}`]);
    const incoming = `${config.root}/.deploy-incoming`; const tools = `${config.root}/.deploy-tools`;
    const stage = `${incoming}/${config.runId}`; const operator = `${tools}/${config.runId}/deployment.mjs`;
    // Fail on existing run directories (including symlinks): reruns have a new attempt ID.
    ssh(`test -d ${quote(config.root)} && test ! -L ${quote(config.root)} && umask 077 && ` +
      `mkdir -p -- ${quote(incoming)} ${quote(tools)} && test ! -L ${quote(incoming)} && test ! -L ${quote(tools)} && ` +
      `mkdir -- ${quote(stage)} ${quote(`${tools}/${config.runId}`)}`);
    copy(join(repository, 'server/deployment.mjs'), operator);
    let candidate;
    if (release) {
      if (env.DEPLOY_UPLOAD_ARCHIVE === '1') {
        // Bundle only the already validated, public release. Keys/.env and user
        // storage never enter this directory. Avoid one network roundtrip per file.
        archiveTemporary = mkdtempSync(join(tmpdir(), 'automesh-release-'));
        const archive = join(archiveTemporary, 'release.tar.gz'); created.push(archive);
        command('tar', releaseArchiveArguments(release, archive));
        const uploaded = `${stage}/release.tar.gz`; copy(archive, uploaded);
        // New, private stage created above; no extraction into the live root.
        // validateRelease verifies all extracted paths/types/hashes before switching.
        ssh(`test -f ${quote(uploaded)} && test ! -L ${quote(uploaded)} && ` +
          `tar --no-same-owner --no-same-permissions -xzf ${quote(uploaded)} -C ${quote(stage)}`);
      } else copy(release, stage, true);
      candidate = `${stage}/${basename(release)}`;
    }
    ssh([config.node, operator, operation, config.root, config.origin, ...(candidate ? [candidate] : [])].map(quote).join(' '));
  } finally {
    // Only exact credential files created by this invocation, never recursive cleanup.
    for (const path of created) if (existsSync(path)) unlinkSync(path);
    if (temporary) rmdirSync(temporary);
    if (archiveTemporary) rmdirSync(archiveTemporary);
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await deployClient(process.argv[2], process.argv[3]); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
