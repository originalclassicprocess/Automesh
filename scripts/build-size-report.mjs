import { readFileSync, readdirSync, statSync, existsSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';

const sum = (rows, field = 'bytes') => rows.reduce((total, row) => total + row[field], 0);
const slash = path => path.replaceAll('\\', '/');
function files(directory, base = directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path, base) : entry.isFile()
      ? [{ path: slash(relative(base, path)), absolute: path, bytes: statSync(path).size }] : [];
  });
}
function compressed(file, extension) {
  if (existsSync(file.absolute + extension)) return { bytes: statSync(file.absolute + extension).size, estimated: false };
  const bytes = readFileSync(file.absolute);
  return { bytes: extension === '.gz' ? gzipSync(bytes).length : brotliCompressSync(bytes, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 6 },
  }).length, estimated: true };
}

// No byte budget or deployment decision: this is an informational measurement.
export function measureBuild(buildDirectory, manifestPath) {
  const client = files(join(buildDirectory, 'client'));
  const normal = client.filter(file => !/\.(?:br|gz|map)$/.test(file.path));
  const chunks = normal.filter(file => /\.(?:js|css)$/.test(file.path)).map(file => {
    const gzip = compressed(file, '.gz'), brotli = compressed(file, '.br');
    return { path: file.path, bytes: file.bytes, gzip: gzip.bytes, brotli: brotli.bytes,
      estimated: { gzip: gzip.estimated, brotli: brotli.estimated } };
  }).sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path));
  const sizeOf = paths => {
    const rows = paths ? chunks.filter(chunk => paths.has(chunk.path)) : chunks;
    return { files: rows.length, bytes: sum(rows), gzip: sum(rows, 'gzip'), brotli: sum(rows, 'brotli') };
  };
  const warnings = [];
  let initialMain = null;
  if (manifestPath && existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      const entries = Object.entries(manifest);
      // SvelteKit's entry/app dynamically enumerates ALL routes. Include only
      // static dependencies of the entries, root layout and root page here.
      const seeds = entries.filter(([, value]) => ['entry/app', 'entry/start', 'nodes/0', 'nodes/2'].includes(value.name));
      if (seeds.length !== 4) throw Error('Root route entries not recognized');
      const visited = new Set(), paths = new Set();
      const visit = key => {
        if (visited.has(key)) return;
        visited.add(key);
        const value = manifest[key];
        if (!value) throw Error('Manifest dependency missing');
        paths.add(value.file);
        for (const css of value.css ?? []) paths.add(css);
        for (const dependency of value.imports ?? []) visit(dependency);
      };
      for (const [key] of seeds) visit(key);
      const actual = new Set(chunks.map(chunk => chunk.path));
      if ([...paths].some(path => !actual.has(path))) throw Error('Manifest does not match this client build');
      initialMain = sizeOf(paths);
    } catch (error) { warnings.push(`Initial route estimate unavailable: ${error.message}`); }
  } else warnings.push('Initial route estimate unavailable: client manifest missing');
  const build = files(buildDirectory), server = build.filter(file => !file.path.startsWith('client/'));
  return { schema: 1, client: { diskBytes: sum(client), normalFiles: normal.length, normalBytes: sum(normal),
    jsCss: sizeOf(), initialMain, largest: chunks.slice(0, 12),
    estimatedCompression: { gzip: chunks.filter(c => c.estimated.gzip).length, brotli: chunks.filter(c => c.estimated.brotli).length } },
    server: { files: server.length, diskBytes: sum(server), sourceMapBytes: sum(server.filter(file => file.path.endsWith('.map'))) },
    buildDiskBytes: sum(build), warnings };
}

const mib = bytes => (bytes / 1024 / 1024).toFixed(2) + ' MiB';
export function formatBuildReport(report) {
  const client = report.client, sizes = client.jsCss;
  const lines = ['## Build size (informational)', '', '| Scope | Raw / disk | gzip | Brotli |', '| --- | ---: | ---: | ---: |',
    `| Client JS + CSS (${sizes.files} files) | ${mib(sizes.bytes)} | ${mib(sizes.gzip)} | ${mib(sizes.brotli)} |`,
    `| Client normal files (no sidecars/maps) | ${mib(client.normalBytes)} | — | — |`,
    `| Client disk including precompressed copies/maps | ${mib(client.diskBytes)} | — | — |`,
    `| Server output including entry wrappers | ${mib(report.server.diskBytes)} | — | — |`,
    `| Server source maps (included above) | ${mib(report.server.sourceMapBytes)} | — | — |`];
  if (report.buildVersion) lines.splice(1, 0, '', `Build: ${report.buildVersion}`);
  if (client.initialMain) {
    const initial = client.initialMain;
    lines.push(`| Root route static estimate (${initial.files} files) | ${mib(initial.bytes)} | ${mib(initial.gzip)} | ${mib(initial.brotli)} |`);
  }
  if (report.archiveBytes !== undefined) lines.push(`| Supplied release archive | ${mib(report.archiveBytes)} | — | — |`);
  lines.push('', 'Largest client JS/CSS files:', '', '| File | Raw | gzip | Brotli |', '| --- | ---: | ---: | ---: |');
  for (const chunk of client.largest) lines.push(`| ${chunk.path} | ${mib(chunk.bytes)} | ${mib(chunk.gzip)} | ${mib(chunk.brotli)} |`);
  lines.push('', 'Sizes describe build files, not RAM, rendering speed or a measured network transfer. node_modules is excluded.',
    'Compression uses existing sidecars; absent sidecars are estimated locally (gzip defaults / Brotli quality 6).',
    `Estimated compression: ${client.estimatedCompression.gzip} gzip and ${client.estimatedCompression.brotli} Brotli files.`,
    'The root route estimate excludes dynamic imports. The offline service worker precaches all built assets, including lazy chunks.',
    'No size threshold is enforced.');
  for (const warning of report.warnings) lines.push(`Warning: ${warning}`);
  return lines.join('\n') + '\n';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(import.meta.dirname, '..');
  const options = new Map();
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i], value = process.argv[i + 1];
    if (!['--output', '--archive'].includes(key) || !value || options.has(key))
      throw Error('Usage: build-size-report.mjs [--output <directory>] [--archive <file>]');
    options.set(key, value);
  }
  const report = measureBuild(join(root, 'build'), join(root, '.svelte-kit/output/client/.vite/manifest.json'));
  report.buildVersion = JSON.parse(readFileSync(join(root, 'build/client/_app/version.json'), 'utf8')).version;
  if (options.has('--archive')) report.archiveBytes = statSync(resolve(options.get('--archive'))).size;
  const markdown = formatBuildReport(report), output = resolve(root, options.get('--output') ?? '.release/build-size');
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  writeFileSync(join(output, 'report.md'), markdown);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  console.log(markdown);
}
