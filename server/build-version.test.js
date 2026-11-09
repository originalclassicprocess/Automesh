import { expect, it, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildVersion } from '../scripts/build-version.mjs';
afterEach(() => vi.unstubAllEnvs());
it('keeps the application and both root lockfile release counters in sync', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
  expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
  expect(lock.version).toBe(pkg.version);
  expect(lock.packages[''].version).toBe(pkg.version);
});
it('declares root MIT licensing and includes it in prepared application releases', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
  const license = readFileSync(new URL('../LICENSE', import.meta.url), 'utf8');
  expect(pkg.license).toBe('MIT'); expect(lock.packages[''].license).toBe('MIT');
  expect(license).toContain('MIT License'); expect(license).toContain('Copyright (c) 2026 Automesh contributors');
  expect(license).toContain('The above copyright notice and this permission notice shall be included');
  expect(license).toContain('THE SOFTWARE IS PROVIDED "AS IS"');
  expect(readFileSync(new URL('../scripts/prepare-release.mjs', import.meta.url), 'utf8')).toContain("copy('LICENSE')");
});
it('generates the same version on repeated config imports for fixed build inputs', () => {
  vi.stubEnv('MESH_APP_VERSION', '');
  expect(buildVersion()).toBe(buildVersion());
  const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  const prefix = `v${version}-`;
  expect(buildVersion().startsWith(prefix)).toBe(true);
  expect(buildVersion().slice(prefix.length)).toMatch(/^[a-f0-9]{16}$/);
});
it('accepts an explicitly pinned release version', () => {
  vi.stubEnv('MESH_APP_VERSION', 'pilot-2026-09-30'); expect(buildVersion()).toBe('pilot-2026-09-30');
});
