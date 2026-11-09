import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('stdio startup, initialization, discovery, status and invalid input', { timeout: 15000 }, async t => {
  const root = fileURLToPath(new URL('../.test-data/', import.meta.url));
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'mcp-'));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../server/mcp.mjs', import.meta.url))],
    { env: { ...process.env, AUTOMESH_NOTIFIER_DATA_DIR: directory }, windowsHide: true });
  t.after(async () => { child.kill(); await rm(directory, { recursive: true, force: true }); });
  let errors = ''; child.stderr.on('data', chunk => { errors += chunk; });
  const readers = createInterface({ input: child.stdout });
  const pending = new Map();
  readers.on('line', line => { const value = JSON.parse(line); pending.get(value.id)?.(value); });
  let id = 0;
  const call = (method, params) => new Promise(resolve => {
    const current = ++id; pending.set(current, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: current, method, params }) + '\n');
  });
  const initialized = await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(initialized.result.protocolVersion, '2025-11-25');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const list = await call('tools/list', {});
  assert.equal(list.result.tools.length, 3);
  const current = await call('tools/call', { name: 'get_notification_status', arguments: {} });
  assert.equal(JSON.parse(current.result.content[0].text).configured, false);
  const invalid = await call('tools/call', { name: 'notify_task_completed', arguments: { seed: 'must-never-be-used' } });
  assert.equal(JSON.parse(invalid.result.content[0].text).error, 'invalid_notification');
  assert.equal(errors, '');
});
