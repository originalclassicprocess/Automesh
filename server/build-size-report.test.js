import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';
import { measureBuild, formatBuildReport } from '../scripts/build-size-report.mjs';

const temporary = [];
afterEach(() => {
  for (const directory of temporary.splice(0)) {
    if (!resolve(directory).startsWith(resolve(tmpdir(), 'automesh-size-'))) throw Error('unexpected_test_directory');
    rmSync(directory, { recursive: true });
  }
});
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'automesh-size-'));
  temporary.push(directory);
  const build = join(directory, 'build'), client = join(build, 'client');
  mkdirSync(client, { recursive: true });
  const write = (name, bytes) => writeFileSync(join(client, name), bytes);
  write('app.js', 'app'); write('start.js', 'start'); write('layout.js', 'layout'); write('page.js', 'page');
  write('page.css', 'page-style'); write('shared.js', 'shared'); write('lazy.js', 'lazy'.repeat(100));
  write('photo.png', 'photo'); write('page.js.map', 'source-map');
  write('page.js.br', brotliCompressSync(Buffer.from('page')));
  write('page.js.gz', gzipSync(Buffer.from('page')));
  writeFileSync(join(build, 'index.js'), 'server'); writeFileSync(join(build, 'index.js.map'), 'server-map');
  const manifestPath = join(directory, 'manifest.json');
  const manifest = {
    app: { name: 'entry/app', file: 'app.js', dynamicImports: ['lazy'] },
    start: { name: 'entry/start', file: 'start.js' },
    layout: { name: 'nodes/0', file: 'layout.js', imports: ['shared'] },
    page: { name: 'nodes/2', file: 'page.js', imports: ['shared'], css: ['page.css'], dynamicImports: ['lazy'] },
    shared: { file: 'shared.js' }, lazy: { file: 'lazy.js' },
  };
  writeFileSync(manifestPath, JSON.stringify(manifest));
  return { build, client, manifestPath, manifest };
}

describe('informational build sizes', () => {
  it('counts payloads once, separates disk/maps/server, and excludes lazy routes from the static estimate', () => {
    const f = fixture(), result = measureBuild(f.build, f.manifestPath);
    expect(result.client.jsCss.files).toBe(7);
    expect(result.client.jsCss.bytes).toBe(434);
    expect(result.client.normalFiles).toBe(8);
    expect(result.client.normalBytes).toBe(439);
    expect(result.client.initialMain).toMatchObject({ files: 6, bytes: 34 });
    expect(result.server).toEqual({ files: 2, diskBytes: 16, sourceMapBytes: 10 });
    expect(result.client.diskBytes).toBeGreaterThan(result.client.normalBytes);
    expect(result.warnings).toEqual([]);
    expect(formatBuildReport(result)).toContain('No size threshold is enforced');
  });
  it('uses real compression sidecars when available and labels calculated fallbacks', () => {
    const f = fixture();
    const report = measureBuild(f.build, f.manifestPath), page = report.client.largest.find(c => c.path === 'page.js');
    expect(page).toMatchObject({ gzip: gzipSync(Buffer.from('page')).length,
      brotli: brotliCompressSync(Buffer.from('page')).length, estimated: { gzip: false, brotli: false } });
    const lazy = report.client.largest.find(c => c.path === 'lazy.js');
    expect(lazy).toMatchObject({ gzip: gzipSync(Buffer.from('lazy'.repeat(100))).length,
      brotli: brotliCompressSync(Buffer.from('lazy'.repeat(100)), { params: { [constants.BROTLI_PARAM_QUALITY]: 6 } }).length,
      estimated: { gzip: true, brotli: true } });
    expect(report.client.estimatedCompression).toEqual({ gzip: 6, brotli: 6 });
  });
  it('reports missing/mismatched manifests without presenting a false initial-load estimate', () => {
    const f = fixture();
    const missing = measureBuild(f.build);
    expect(missing.client.initialMain).toBeNull(); expect(missing.warnings).toHaveLength(1);
    f.manifest.page.file = 'old-hash.js';
    writeFileSync(f.manifestPath, JSON.stringify(f.manifest));
    const mismatch = measureBuild(f.build, f.manifestPath);
    expect(mismatch.client.jsCss.bytes).toBe(434);
    expect(mismatch.client.initialMain).toBeNull(); expect(mismatch.warnings[0]).toContain('does not match');
  });
});
