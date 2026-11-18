import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const report = resolve(root, '.release/performance/history-scale.json');
const run = spawnSync(process.execPath, [resolve(root, 'node_modules/vitest/vitest.mjs'), 'run',
  'server/history-scale.test.js'], {
  cwd: root, stdio: 'inherit', windowsHide: true, env: { ...process.env, AUTOMESH_SCALE_REPORT: report },
});
if (run.error) throw run.error;
if (run.status === 0) console.log(`Scale check report: ${report}`);
process.exitCode = run.status ?? 1;
