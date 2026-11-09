// Deterministic installed dependency inventory; never reads account/node data.
import { readFile, readdir, lstat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = fileURLToPath(new URL('../', import.meta.url));
const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
const supplements = JSON.parse(await readFile(join(root, 'docs/third-party-licenses/sources.json'), 'utf8'));
const rows = [], notices = [];
for (const [path, entry] of Object.entries(lock.packages).sort(([a], [b]) => a.localeCompare(b))) {
  if (!path) continue;
  const directory = join(root, path), name = entry.name || path.slice(path.lastIndexOf('node_modules/') + 13);
  const row = { name, version: entry.version, license: entry.license || 'UNDECLARED', development: entry.dev === true, installed: false, notices: [] };
  try {
    const stat = await lstat(directory); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('dependency_directory');
    const installed = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
    if (installed.version !== row.version) throw new Error(`Dependency version mismatch: ${name}; run npm ci before inventory`);
    row.installed = true;
    for (const file of (await readdir(directory)).sort()) {
      if (!/^(?:(?:third[._-]party[._-])?licen[cs]e|copying|copyright|notice)(?:[._-].*)?$/i.test(file)) continue;
      const info = await lstat(join(directory, file)); if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) throw new Error('dependency_notice');
      const text = await readFile(join(directory, file), 'utf8'); row.notices.push(file);
      notices.push(`\n===== ${name} ${entry.version} / ${file} =====\n${text}\n`);
    }
    // Native packages omit notices included in their same-version JS package.
    const parent = name.startsWith('@rolldown/binding-') ? 'rolldown' : name.startsWith('@rollup/rollup-') ? 'rollup' : null;
    if (!row.notices.length && parent && lock.packages['node_modules/' + parent]?.version === row.version) {
      const parentDir = join(root, 'node_modules', parent);
      if (JSON.parse(await readFile(join(parentDir, 'package.json'), 'utf8')).version !== row.version) throw new Error('native_parent_version');
      for (const file of (await readdir(parentDir)).sort()) {
        if (!/^(?:(?:third[._-]party[._-])?licen[cs]e)(?:[._-].*)?$/i.test(file)) continue;
        const text = await readFile(join(parentDir, file), 'utf8');
        row.notices.push(`${parent}/${file}`);
        notices.push(`\n===== ${name} ${entry.version} / ${parent}/${file} (same-version package) =====\n${text}\n`);
      }
    }
    // Some packages include the complete license only in their README.
    if (!row.notices.length && name === 'is-module' && row.version === '1.0.0') {
      const text = await readFile(join(directory, 'README.md'), 'utf8');
      const section = text.match(/## License\s+([\s\S]+)$/)?.[1];
      if (section?.includes('Permission is hereby granted') && section.includes('SOFTWARE.')) {
        row.notices.push('README.md#license');
        notices.push(`\n===== ${name} ${entry.version} / README.md#license =====\n${section}\n`);
      }
    }
    const supplement = supplements.find(item => item.name === name && item.version === row.version);
    if (!row.notices.length && supplement) {
      if (!/^[a-z0-9-]+\.txt$/.test(supplement.file)) throw new Error('supplement_path');
      const bytes = await readFile(join(root, 'docs/third-party-licenses', supplement.file));
      if (createHash('sha256').update(bytes).digest('hex') !== supplement.sha256) throw new Error('supplement_hash');
      row.notices.push('upstream:' + supplement.file); row.noticeSource = supplement.url;
      notices.push(`\n===== ${name} ${entry.version} / ${supplement.url} =====\n${bytes.toString('utf8')}\n`);
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  rows.push(row);
}
// Absent optional OS variants are recorded, not claimed audited from local bytes.
const output = resolve(root, 'static/DEPENDENCY_NOTICES.txt');
const noticeText = 'Automesh third-party dependency notices\nProject code: MIT. Dependencies retain their own licenses.\nGenerated from installed locked dependencies; includes development/build tools.\n' + notices.join('');
await writeFile(output, noticeText.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trimEnd() + '\n');
await writeFile(join(root, 'docs/DEPENDENCY_LICENSES.json'), JSON.stringify({ lockfileVersion: lock.lockfileVersion, packages: rows }, null, 2) + '\n');
const missing = rows.filter(row => row.installed && (!row.notices.length || row.license === 'UNDECLARED'));
process.stdout.write(JSON.stringify({ packages: rows.length, installed: rows.filter(row => row.installed).length, missingNotices: missing.map(row => row.name), noticeBytes: (await lstat(output)).size }) + '\n');
if (missing.length) process.exitCode = 1;
