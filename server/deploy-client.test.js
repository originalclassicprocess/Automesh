import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { deployClient, deploymentSettings, sshArguments, releaseArchiveArguments } from '../scripts/deploy-client.mjs';

const env = { SSH_HOST: 'example.org', SSH_USER: 'testuser', SSH_PORT: '21098', DEPLOY_ROOT: '/home/testuser/automesh',
  DEPLOY_NODE_BIN: '/home/testuser/nodevenv/automesh/24/bin/node', DEPLOY_ORIGIN: 'https://example.org', DEPLOY_RUN_ID: '1234-1' };
describe('deployment client safety', () => {
  it('bundles exactly one validated release folder with argument-separated paths', () => {
    const args = releaseArchiveArguments('/workspace/.release/automesh-settings', '/temporary with spaces/release.tar.gz');
    expect(args).toEqual(['-czf','/temporary with spaces/release.tar.gz','-C','/workspace/.release','--','automesh-settings']);
    expect(args).not.toContain('.'); expect(args).not.toContain('/workspace');
  });
  it('accepts explicit paths and pins host verification without agent forwarding', () => {
    const config = deploymentSettings(env); expect(config.root).toBe(env.DEPLOY_ROOT);
    const args = sshArguments(config, '/private/key', '/private/hosts');
    expect(args).toContain('StrictHostKeyChecking=yes'); expect(args).toContain('IdentitiesOnly=yes');
    expect(args).toContain('ForwardAgent=no'); expect(args).toContain('BatchMode=yes');
    expect(args).not.toContain('StrictHostKeyChecking=no');
  });
  it('rejects malformed config, shell injection, broad paths and unverified TLS', () => {
    for (const override of [{ SSH_HOST: 'example.org;bad' }, { SSH_USER: '-option' }, { SSH_PORT: '0' }, { SSH_PORT: '65536' },
      { DEPLOY_ROOT: '/home/testuser' }, { DEPLOY_ROOT: '/home/testuser/../elsewhere' },
      { DEPLOY_ROOT: '/home/testuser/automesh;bad' }, { DEPLOY_NODE_BIN: '/bin/node' },
      { DEPLOY_ORIGIN: 'http://example.org' }, { DEPLOY_ORIGIN: 'https://example.org/path' },
      { DEPLOY_RUN_ID: '../escape' }, { NODE_TLS_REJECT_UNAUTHORIZED: '0' }])
      expect(() => deploymentSettings({ ...env, ...override })).toThrow();
  });
  it('fails before any SSH call on missing credentials or wrong release path', async () => {
    const run = vi.fn();
    await expect(deployClient('rollback', undefined, env, run)).rejects.toThrow('secrets');
    await expect(deployClient('deploy', '.', env, run)).rejects.toThrow('inside .release');
    await expect(deployClient('destroy', undefined, env, run)).rejects.toThrow('deploy or rollback');
    expect(run).not.toHaveBeenCalled();
  });
  it('keeps public CI/build workflows free of hosting credentials and deployment', () => {
    const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
    const workflow = readFileSync(new URL('../.github/workflows/preview-build.yml', import.meta.url), 'utf8');
    const node = readFileSync(new URL('../nodes/.github/workflows/preview-build.yml', import.meta.url), 'utf8');
    for (const source of [ci, workflow, node]) {
      expect(source).not.toMatch(/secrets\.|deploy-client|pull_request_target|workflow_run/);
      expect(source).toContain('persist-credentials: false');
      for (const action of source.matchAll(/uses: (actions\/[^\s@]+)@([^\s]+)/g)) expect(action[2]).toMatch(/^[a-f0-9]{40}$/);
    }
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('branches: [main]');
    expect(node).toContain("github.event.repository.visibility == 'public' && github.ref == 'refs/heads/main'");
    expect(node).toContain('command: build:windows');
    expect(node).toContain('command: build:linux');
  });
});
