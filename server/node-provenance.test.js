import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { packageArtifacts, packageRepository, packageWorkflow, packageRef, parsePackageProvenance,
  packageVerificationArgs, packageVerificationCommand } from '../src/lib/application/package-provenance.js';
import { packageHash, verifyNodePackage } from '../scripts/verify-node-package.mjs';
import { provenanceContext, recordNodeProvenance, verifyPublishedNodePackages } from '../scripts/record-node-provenance.mjs';

const commit = 'a'.repeat(40);
const env = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: packageRepository, GITHUB_REF: packageRef,
  GITHUB_WORKFLOW_REF: `${packageWorkflow}@${packageRef}`, GITHUB_SHA: commit, GITHUB_RUN_ID: '12345',
  GITHUB_EVENT_NAME: 'workflow_dispatch', RUNNER_ENVIRONMENT: 'github-hosted', AUTOMESH_REPOSITORY_VISIBILITY: 'public' };
// Mocks exercise orchestration/fail-closed behavior, NOT cryptographic validity.
const goodCli = () => ({ status: 0, signal: null, stdout: '[]' });
let directory, file, bundle, manifest;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'automesh-provenance-test-'));
  file = join(directory, packageArtifacts.windows.file); bundle = join(directory, 'test-proof.json');
  const data = Buffer.alloc(1024 * 1024, 23); writeFileSync(file, data); writeFileSync(bundle, '{"mock":true}');
  manifest = { version: '0.4.1', url: '/downloads/' + packageArtifacts.windows.file, signed: false,
    bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') };
  writeFileSync(join(directory, packageArtifacts.windows.manifest), JSON.stringify(manifest));
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

describe('pinned GitHub package provenance policy', () => {
  it('pins repo, workflow, issuer, branch, provenance predicate and hosted runners', () => {
    const args = packageVerificationArgs('./file with spaces.exe', commit);
    expect(args).toEqual(['attestation', 'verify', './file with spaces.exe', '--hostname', 'github.com', '--repo', packageRepository,
      '--signer-workflow', packageWorkflow, '--source-ref', packageRef, '--cert-oidc-issuer', 'https://token.actions.githubusercontent.com',
      '--predicate-type', 'https://slsa.dev/provenance/v1', '--deny-self-hosted-runners', '--source-digest', commit, '--signer-digest', commit, '--format', 'json']);
    expect(() => packageVerificationArgs('file', '--owner evil')).toThrow('invalid_commit');
    expect(() => packageVerificationArgs('-evil')).toThrow('invalid_file');
    expect(packageVerificationCommand('windows', commit)).toContain('--signer-digest ' + commit);
    expect(packageVerificationCommand('linux')).toContain('./Automesh-Node-Linux-x64.tar.gz');
  });
  it('does not treat unsigned manifest metadata as a verification result', () => {
    const value = { type: 'github-actions', repository: packageRepository, workflow: packageWorkflow,
      ref: packageRef, commit, runId: '12345', bundleUrl: '/downloads/' + packageArtifacts.windows.file + '.sigstore.json' };
    expect(parsePackageProvenance('windows', { ...value, verified: true })).toEqual(value);
    expect(parsePackageProvenance('windows', undefined)).toBeUndefined();
    for (const patch of [{ repository: 'evil/repo' }, { workflow: packageRepository + '/other.yml' }, { ref: 'refs/heads/evil' },
      { commit: 'not-a-hash' }, { runId: '../redirect' }, { bundleUrl: 'https://evil.test/proof' }, { type: 'checksum' }])
      expect(() => parsePackageProvenance('windows', { ...value, ...patch })).toThrow('invalid_provenance');
    expect(() => parsePackageProvenance('linux', value)).toThrow();
    expect(() => parsePackageProvenance('windows', null)).toThrow();
  });
  it('allows recording only in the public main hosted manual release context', () => {
    expect(provenanceContext(env)).toEqual({ commit, runId: '12345' });
    for (const patch of [{ AUTOMESH_REPOSITORY_VISIBILITY: 'private' }, { GITHUB_ACTIONS: 'false' }, { GITHUB_REPOSITORY: 'evil/repo' },
      { GITHUB_REF: 'refs/pull/1/merge' }, { GITHUB_WORKFLOW_REF: packageWorkflow + '@refs/heads/evil' }, { GITHUB_SHA: '' },
      { GITHUB_RUN_ID: '0' }, { GITHUB_EVENT_NAME: 'pull_request' }, { RUNNER_ENVIRONMENT: 'self-hosted' }])
      expect(() => provenanceContext({ ...env, ...patch })).toThrow();
  });
  it('requires explicit context before any file/CLI operation', async () => {
    const run = vi.fn(goodCli);
    await expect(recordNodeProvenance(directory, 'windows', bundle, {}, run)).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
    await expect(recordNodeProvenance(directory, '__proto__', bundle, env, run)).rejects.toThrow('invalid_platform');
  });
  it('delegates real verification to official gh without shell execution or unbounded output', async () => {
    const run = vi.fn(goodCli);
    expect(await verifyNodePackage(file, { commit, bundle, sha256: manifest.sha256 }, run)).toEqual({ bytes: manifest.bytes, sha256: manifest.sha256 });
    expect(run).toHaveBeenCalledWith('gh', expect.arrayContaining(['--bundle', bundle]),
      expect.objectContaining({ shell: false, windowsHide: true, timeout: 90_000, maxBuffer: 4 * 1024 * 1024 }));
  });
  it('fails closed on absent proof, wrong signer, old CLI, timeout, overflow and missing executable', async () => {
    for (const failure of [{ status: 1, stderr: 'private auth diagnostics' }, { status: null, signal: 'SIGTERM' },
      { status: 0, error: { code: 'ETIMEDOUT' } }, { status: 0, error: { code: 'ENOBUFS' } }]) {
      await expect(verifyNodePackage(file, {}, () => failure)).rejects.toThrow('package_provenance_not_verified');
    }
    await expect(verifyNodePackage(file, {}, () => ({ error: { code: 'ENOENT' } }))).rejects.toThrow('github_cli_required');
  });
  it('rejects a wrong checksum before even invoking gh', async () => {
    const run = vi.fn(goodCli);
    await expect(verifyNodePackage(file, { sha256: 'f'.repeat(64) }, run)).rejects.toThrow('package_checksum_mismatch');
    await expect(verifyNodePackage(file, { sha256: '--unsafe' }, run)).rejects.toThrow('invalid_sha256');
    expect(run).not.toHaveBeenCalled();
  });
  it('detects mutation during verification and never executes the package', async () => {
    await expect(verifyNodePackage(file, {}, () => { writeFileSync(file, Buffer.alloc(manifest.bytes, 24)); return goodCli(); }))
      .rejects.toThrow('package_changed_during_verification');
  });
  it('rejects tiny/non-file packages and oversized proof files', async () => {
    const run = vi.fn(goodCli);
    await expect(packageHash(directory)).rejects.toThrow('invalid_package_file');
    writeFileSync(file, 'not-a-package');
    await expect(verifyNodePackage(file, {}, run)).rejects.toThrow('invalid_package_file');
    writeFileSync(bundle, Buffer.alloc(4 * 1024 * 1024 + 1));
    await expect(verifyNodePackage(file, { bundle }, run)).rejects.toThrow('invalid_provenance_bundle');
    expect(run).not.toHaveBeenCalled();
  });
  it('never writes a reference or public sidecar after failed verification', async () => {
    await expect(recordNodeProvenance(directory, 'windows', bundle, env, () => ({ status: 1 }))).rejects.toThrow();
    expect(JSON.parse(readFileSync(join(directory, packageArtifacts.windows.manifest), 'utf8'))).toEqual(manifest);
    expect(existsSync(file + '.sigstore.json')).toBe(false);
  });
  it('records public proof only after a successful CLI result, preserving unsigned publisher status (mock)', async () => {
    await recordNodeProvenance(directory, 'windows', bundle, env, goodCli);
    const recorded = JSON.parse(readFileSync(join(directory, packageArtifacts.windows.manifest), 'utf8'));
    expect(recorded.signed).toBe(false); expect(recorded.sha256).toBe(manifest.sha256);
    expect(recorded.provenance.commit).toBe(commit); expect(recorded.provenance.runId).toBe('12345');
    expect(readFileSync(file + '.sigstore.json', 'utf8')).toBe(readFileSync(bundle, 'utf8'));
    await expect(recordNodeProvenance(directory, 'windows', bundle, env, goodCli)).rejects.toThrow('provenance_already_recorded');
  });
  it('re-verifies both downloaded artifacts and refuses a local/unattested release (mock)', async () => {
    const run = vi.fn(goodCli);
    await expect(verifyPublishedNodePackages(directory, env, run)).rejects.toThrow('current_release_provenance_required');
    expect(run).not.toHaveBeenCalled();
    writeFileSync(join(directory, packageArtifacts.linux.file), readFileSync(file));
    writeFileSync(join(directory, packageArtifacts.linux.manifest), JSON.stringify({ ...manifest, url: '/downloads/' + packageArtifacts.linux.file }));
    await recordNodeProvenance(directory, 'windows', bundle, env, run);
    await recordNodeProvenance(directory, 'linux', bundle, env, run);
    run.mockClear(); await verifyPublishedNodePackages(directory, env, run); expect(run).toHaveBeenCalledTimes(2);
    await expect(verifyPublishedNodePackages(directory, { ...env, GITHUB_RUN_ID: '54321' }, run)).rejects.toThrow('current_release_provenance_required');
    await expect(verifyPublishedNodePackages(directory, { ...env, GITHUB_SHA: 'b'.repeat(40) }, run)).rejects.toThrow('current_release_provenance_required');
  });
  it('separates public node attestations from app and contributor CI', () => {
    const release = readFileSync(new URL('../nodes/.github/workflows/preview-build.yml', import.meta.url), 'utf8');
    const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
    const app = readFileSync(new URL('../.github/workflows/preview-build.yml', import.meta.url), 'utf8');
    for (const source of [ci, app]) expect(source).not.toMatch(/id-token: write|attestations: write|actions\/attest@/);
    expect(release).toContain("github.event.repository.visibility == 'public' && github.ref == 'refs/heads/main'");
    expect(release.match(/actions\/attest@1e69f48acb82d1966a394da916b4c1698aa569d6/g)).toHaveLength(1);
    expect(release).toContain('downloads/*.exe');
    expect(release).toContain('downloads/*.tar.gz');
    expect(release).not.toMatch(/secrets\.|deploy-client|pull_request_target/);
    expect(packageRepository).toBe('originalclassicprocess/automesh-nodes');
    expect(packageWorkflow).toBe(packageRepository + '/.github/workflows/release.yml');
  });
});
