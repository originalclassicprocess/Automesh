import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { join, resolve, relative, basename, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync, brotliCompressSync, constants } from 'node:zlib';
import { releaseVersion, validateRelease, updateApplication, selectorLifecycle, stopLiteSpeedWorkers } from './deployment.mjs';

const temporary = [];
// Do not create transactional rename fixtures under a running Vite watch tree:
// Windows directory watcher handles can prevent the move being tested.
const testBase = join(tmpdir(), 'automesh-deployment-tests');
function temp() {
  mkdirSync(testBase, { recursive: true });
  const dir = mkdtempSync(join(testBase, 'test-')); temporary.push(dir); return dir;
}
afterEach(() => {
  for (const dir of temporary.splice(0)) {
    // Delete only directories created by this test, never a computed broad root.
    const child = relative(testBase, resolve(dir));
    if (!/^test-[A-Za-z0-9]+$/.test(child) || isAbsolute(child)) throw new Error('Unsafe test cleanup');
    rmSync(dir, { recursive: true, force: true });
  }
});
const read = path => JSON.parse(readFileSync(path, 'utf8'));
function put(root, name, value) { const path = join(root, name); mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, value); }
function manifest(root) {
  function walk(dir, prefix = '') {
    return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
      ? walk(join(dir, entry.name), prefix + entry.name + '/') : [prefix + entry.name]).sort();
  }
  const files = walk(root).filter(path => path !== 'release-manifest.json').map(path => ({ path,
    sha256: createHash('sha256').update(readFileSync(join(root, path))).digest('hex') }));
  put(root, 'release-manifest.json', JSON.stringify({ version: releaseVersion(root), files }));
}
function release(root, version, dependency = '1.0.0') {
  mkdirSync(root, { recursive: true });
  put(root, 'build/client/_app/version.json', JSON.stringify({ version }));
  put(root, `build/client/_app/immutable/${version}.js`, version);
  put(root, 'build/handler.js', 'handler-' + version);
  put(root, 'server/app.js', version); put(root, 'app.cjs', version);
  put(root, 'package.json', JSON.stringify({ dependencies: { example: dependency } }));
  put(root, 'package-lock.json', JSON.stringify({ lockfileVersion: 3, packages: { '': {}, 'node_modules/example': { version: dependency } } }));
  manifest(root);
}
function fixture() {
  const root = temp(); release(root, 'old');
  put(root, '.env', 'operator-environment'); put(root, 'tmp/keep', 'passenger');
  put(root, 'node_modules/do-not-touch', 'installed'); put(root, 'build-backup-0.0.1/keep', 'manual-backup');
  const candidate = join(root, '.deploy-incoming', 'run', 'release'); release(candidate, 'new');
  const lifecycle = vi.fn(async () => {}); const probe = vi.fn(async () => {});
  return { root, candidate, lifecycle, probe };
}
function preserved(root) {
  for (const [name, value] of [['.env', 'operator-environment'], ['tmp/keep', 'passenger'],
    ['node_modules/do-not-touch', 'installed'], ['build-backup-0.0.1/keep', 'manual-backup']]) expect(readFileSync(join(root, name), 'utf8')).toBe(value);
}
describe('operator deployment transaction (no live hosting involved)', () => {
  it('accepts the root MIT notice and rejects MIT releases missing it', () => {
    const root = temp(); release(root, 'licensed');
    const pkg = read(join(root, 'package.json')); pkg.license = 'MIT'; put(root, 'package.json', JSON.stringify(pkg)); manifest(root);
    expect(() => validateRelease(root)).toThrow('MIT release license missing');
    put(root, 'LICENSE', 'MIT License\nTest fixture copyright notice'); manifest(root);
    expect(validateRelease(root).files.some(file => file.path === 'LICENSE')).toBe(true);
  });
  it('deploys and restores the MIT notice as a managed file, preserving legacy rollback', async () => {
    const f = fixture(); put(f.root, 'LICENSE', 'old notice');
    put(f.candidate, 'LICENSE', 'new MIT notice'); const pkg = read(join(f.candidate, 'package.json'));
    pkg.license = 'MIT'; put(f.candidate, 'package.json', JSON.stringify(pkg)); manifest(f.candidate);
    await updateApplication(f); expect(readFileSync(join(f.root, 'LICENSE'), 'utf8')).toBe('new MIT notice');
    await updateApplication({ ...f, operation: 'rollback' });
    expect(readFileSync(join(f.root, 'LICENSE'), 'utf8')).toBe('old notice'); preserved(f.root);
  });
  it('validates checksums and rejects extra files, tampering and traversal', () => {
    const root = temp(); release(root, 'new'); expect(validateRelease(root).version).toBe('new');
    put(root, 'server/app.js', 'tampered'); expect(() => validateRelease(root)).toThrow('checksum');
    release(root, 'new'); put(root, '.env', 'not allowed'); expect(() => validateRelease(root)).toThrow('unlisted');
    const data = read(join(root, 'release-manifest.json')); data.files[0].path = '../escape';
    put(root, 'release-manifest.json', JSON.stringify(data)); expect(() => validateRelease(root)).toThrow('entry');
  });
  it('deploys, retains old hashed assets, preserves operator files, and rolls back', async () => {
    const f = fixture(); const result = await updateApplication(f);
    expect(result.version).toBe('new'); expect(f.lifecycle.mock.calls).toEqual([['stop'], ['start']]);
    expect(releaseVersion(f.root)).toBe('new'); expect(existsSync(join(f.root, 'build/client/_app/immutable/old.js'))).toBe(true);
    expect(read(join(f.root, 'release-manifest.json')).version).toBe('new'); preserved(f.root);
    expect(existsSync(join(f.root, '.deploy-lock'))).toBe(false);
    const rollback = await updateApplication({ ...f, operation: 'rollback' });
    expect(rollback.version).toBe('old'); expect(releaseVersion(f.root)).toBe('old');
    expect(existsSync(join(f.root, 'build/client/_app/immutable/new.js'))).toBe(true);
    expect(read(join(result.backup, 'journal.json')).state).toBe('committed'); preserved(f.root);
  });
  it('restores original application if new version fails its probe', async () => {
    const f = fixture(); f.probe.mockImplementation(async version => { if (version === 'new') throw new Error('probe failed'); });
    await expect(updateApplication(f)).rejects.toThrow('probe failed');
    expect(releaseVersion(f.root)).toBe('old'); preserved(f.root);
    expect(f.probe.mock.calls).toEqual([['new'], ['old']]);
    expect(existsSync(join(f.root, '.deploy-last.json'))).toBe(false);
    expect(existsSync(join(f.root, '.deploy-lock'))).toBe(false);
    expect(readdirSync(join(f.root, '.deploy-failed')).length).toBe(1);
  });
  it('also recovers a failed manual rollback without consuming its snapshot', async () => {
    const f = fixture(); const deployed = await updateApplication(f);
    f.probe.mockImplementation(async version => { if (version === 'old') throw new Error('old probe failed'); });
    await expect(updateApplication({ ...f, operation: 'rollback' })).rejects.toThrow('old probe failed');
    expect(releaseVersion(f.root)).toBe('new');
    expect(read(join(f.root, '.deploy-last.json')).id).toBe(basename(deployed.backup));
    expect(existsSync(join(deployed.backup, 'build/handler.js'))).toBe(true); preserved(f.root);
  });
  it('refuses production dependency changes, concurrent runs and outside staging before stop', async () => {
    const f = fixture(); release(f.candidate, 'new', '2.0.0');
    await expect(updateApplication(f)).rejects.toThrow('dependencies changed');
    expect(f.lifecycle).not.toHaveBeenCalled(); expect(releaseVersion(f.root)).toBe('old');
    release(f.candidate, 'new'); mkdirSync(join(f.root, '.deploy-lock'));
    await expect(updateApplication(f)).rejects.toThrow('Another deployment');
    const g = fixture(); await expect(updateApplication({ ...g, candidate: g.root })).rejects.toThrow('outside');
    expect(g.lifecycle).not.toHaveBeenCalled(); preserved(g.root);
  });
  it('accepts gzip header platform differences only for identical canonical bytes', async () => {
    const f = fixture(); const path = 'build/client/_app/immutable/shared.js'; const content = Buffer.from('same source');
    const a = gzipSync(content); const b = Buffer.from(a); a[9] = 11; b[9] = 3;
    put(f.root, path, content); put(f.candidate, path, content);
    put(f.root, path + '.gz', a); put(f.candidate, path + '.gz', b); manifest(f.candidate);
    await updateApplication(f);
    expect(gunzipSync(readFileSync(join(f.root, path + '.gz')))).toEqual(content); preserved(f.root);
  });
  it('accepts different Brotli encodings of the same canonical asset', async () => {
    const f = fixture(); const path = 'build/client/_app/immutable/shared.css'; const content = Buffer.from('body{color:red}\n'.repeat(50));
    const a = brotliCompressSync(content, { params: { [constants.BROTLI_PARAM_QUALITY]: 1 } });
    const b = brotliCompressSync(content, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } });
    expect(a.equals(b)).toBe(false);
    put(f.root, path, content); put(f.candidate, path, content);
    put(f.root, path + '.br', a); put(f.candidate, path + '.br', b); manifest(f.candidate);
    await updateApplication(f); expect(f.probe).toHaveBeenCalledWith('new');
  });
  it.each(['payload', 'missing-plain', 'invalid-compression', 'plain-collision'])(
    'still refuses compressed collision: %s', async mode => {
      const f = fixture(); const path = 'build/client/_app/immutable/shared.js';
      if (mode !== 'missing-plain') { put(f.root, path, 'same'); put(f.candidate, path, mode === 'plain-collision' ? 'changed' : 'same'); }
      const a = gzipSync('same'); const b = gzipSync(mode === 'payload' ? 'forged' : 'same'); b[9] = 11;
      put(f.root, path + '.gz', a); put(f.candidate, path + '.gz', mode === 'invalid-compression' ? Buffer.from('invalid gzip') : b);
      manifest(f.candidate);
      await expect(updateApplication(f)).rejects.toThrow('Immutable asset collision');
      expect(f.lifecycle).not.toHaveBeenCalled(); expect(releaseVersion(f.root)).toBe('old'); preserved(f.root);
    });
  it('keeps the lock and backups when recovery itself fails', async () => {
    const f = fixture(); f.probe.mockRejectedValue(new Error('unavailable'));
    await expect(updateApplication(f)).rejects.toThrow('operator recovery');
    expect(existsSync(join(f.root, '.deploy-lock'))).toBe(true);
    expect(readdirSync(join(f.root, '.deploy-backups')).length).toBe(1); preserved(f.root);
  });
  it('tries to restart original app if stopping returns an ambiguous failure', async () => {
    const f = fixture(); f.lifecycle.mockImplementation(async action => { if (action === 'stop') throw new Error('stop failed'); });
    await expect(updateApplication(f)).rejects.toThrow('stop failed');
    expect(f.lifecycle.mock.calls).toEqual([['stop'], ['start']]); expect(f.probe).toHaveBeenCalledWith('old');
    expect(releaseVersion(f.root)).toBe('old'); preserved(f.root);
  });
  it('refuses corrupted rollback snapshots before stopping', async () => {
    const f = fixture(); const result = await updateApplication(f); f.lifecycle.mockClear();
    put(result.backup, 'server/app.js', 'corrupted');
    await expect(updateApplication({ ...f, operation: 'rollback' })).rejects.toThrow('checksum');
    expect(f.lifecycle).not.toHaveBeenCalled(); expect(releaseVersion(f.root)).toBe('new');
  });
  it('rejects symlink staging without following it', async () => {
    const f = fixture(); const external = temp();
    const linked = join(f.root, '.deploy-backups');
    symlinkSync(external, linked, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(updateApplication(f)).rejects.toThrow('file type'); expect(f.lifecycle).not.toHaveBeenCalled();
  });
  it('refuses rollback when a different version was installed manually', async () => {
    const f = fixture(); await updateApplication(f); f.lifecycle.mockClear();
    put(f.root, 'build/client/_app/version.json', '{"version":"manual"}');
    await expect(updateApplication({ ...f, operation: 'rollback' })).rejects.toThrow('outside automation');
    expect(f.lifecycle).not.toHaveBeenCalled();
  });
});
describe('cPanel lifecycle adapter', () => {
  it('reads status, makes start/stop idempotent, confirms state, and never exposes env output', async () => {
    const account = temp(); const root = join(account, 'automesh'); let status = 'started';
    const run = vi.fn((_, args) => {
      if (args[0] === 'get') return { status: 0, stdout: JSON.stringify({ result: 'success', users: { me: {
        applications: { automesh: { app_status: status, env_vars: { secret: 'never print' } } } } } }) };
      status = args[0] === 'stop' ? 'stopped' : 'started'; return { status: 0, stdout: '{"result":"success"}' };
    });
    const closeWorkers = vi.fn(async () => {});
    const lifecycle = selectorLifecycle(root, run, account, closeWorkers);
    await lifecycle('stop'); await lifecycle('stop'); await lifecycle('start'); await lifecycle('start');
    expect(closeWorkers).toHaveBeenCalledTimes(2);
    expect(run.mock.calls.filter(([, args]) => args[0] !== 'get').map(([, args]) => args)).toEqual([
      ['stop', '--json', '--interpreter', 'nodejs', '--app-root', 'automesh'],
      ['start', '--json', '--interpreter', 'nodejs', '--app-root', 'automesh']]);
    const failing = selectorLifecycle(root, () => ({ status: 1, stdout: 'private provider details' }), account);
    await expect(failing('stop')).rejects.toThrow('CloudLinux get failed');
    expect(() => selectorLifecycle(join(account, '..'), run, account)).toThrow('below SSH account home');
  });
  it('gracefully closes only the exact application worker owned by the SSH account, not its neighbor', async () => {
    const root = join(temp(), 'automesh'), title = 'lsnode:' + resolve(root) + '/';
    let alive = true;
    const run = vi.fn(() => ({ status: 0, stdout: (alive ? '123 ' + title + '\n' : '') + '456 ' + title + 'other\n789 unrelated-app\n' }));
    const signal = vi.fn(() => { alive = false; });
    await stopLiteSpeedWorkers(root, run, signal, async () => {}, 1001);
    expect(signal).toHaveBeenCalledExactlyOnceWith(123, 'SIGTERM');
    expect(run.mock.calls[0][1]).toEqual(['-u', '1001', '-o', 'pid=,args=']);
  });
  it('fails closed if the old worker does not exit; never force-kills or changes another process', async () => {
    const root = join(temp(), 'automesh'), title = 'lsnode:' + resolve(root) + '/';
    const signal = vi.fn(), run = () => ({ status: 0, stdout: '123 ' + title + '\n' });
    await expect(stopLiteSpeedWorkers(root, run, signal, async () => {}, 1001)).rejects.toThrow('no live files replaced');
    expect(signal).toHaveBeenCalledExactlyOnceWith(123, 'SIGTERM');
  });
});
