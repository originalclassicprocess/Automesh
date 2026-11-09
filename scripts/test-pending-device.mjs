// Isolated browser contexts and public test inputs; never uses a user's profile.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const moduleRoot = process.argv[2];
if (!moduleRoot) throw new Error('Pass Playwright node_modules directory');
const { chromium } = await import(pathToFileURL(resolve(moduleRoot, 'playwright/index.mjs')).href);
const root = resolve(import.meta.dirname, '..');
const server = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5195', '--strictPort'],
  { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let diagnostic = '', browser;
server.stderr.on('data', data => diagnostic = (diagnostic + data).slice(-2000));
try {
  const origin = 'http://127.0.0.1:5195';
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(diagnostic || 'fixture_server_failed');
    try { if ((await fetch(origin + '/dev/backups')).ok) break; } catch {}
    if (i === 99) throw new Error('fixture_server_timeout');
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  const executablePath = [chromium.executablePath(), 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
  browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext(), page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/dev/backups');
  const created = await page.evaluate(async () => {
    const { createPendingDeviceBrowser } = await import('/src/lib/devices/pending-browser.ts');
    localStorage.setItem('vault', 'public-test-sentinel-not-an-account');
    const host = createPendingDeviceBrowser({ trusted: true, isCurrent: () => true });
    const vault = await host.create('Public test device', 'Public-device-password-2026');
    const output = { id: vault.deviceId, request: vault.request }; host.close(); return output;
  });
  await page.reload();
  const resumed = await page.evaluate(async ({ id }) => {
    const { createPendingDeviceBrowser } = await import('/src/lib/devices/pending-browser.ts');
    const host = createPendingDeviceBrowser({ trusted: true, isCurrent: () => true });
    const vault = await host.open(id, 'Public-device-password-2026');
    const message = new TextEncoder().encode('Public browser proof');
    const signature = await vault.signer.sign(message);
    const output = { request: vault.request, verified: await vault.signer.verify(message, signature), expired: vault.expired };
    await vault.cancel(); host.close(); return output;
  }, created);
  assert.deepEqual(resumed.request, created.request); assert.equal(resumed.verified, true); assert.equal(resumed.expired, false);
  await page.reload();
  const final = await page.evaluate(async ({ id }) => {
    const { createPendingDeviceBrowser, clearPendingDeviceStorage } = await import('/src/lib/devices/pending-browser.ts');
    const { beginStorageReset } = await import('/src/lib/application/storage-reset.ts');
    const host = createPendingDeviceBrowser({ trusted: true, isCurrent: () => true });
    let cancelled = false;
    try { await host.open(id, 'Public-device-password-2026'); }
    catch (error) { cancelled = error.message === 'device_vault_cancelled'; }
    host.close(); beginStorageReset(); await clearPendingDeviceStorage();
    return { cancelled, rootUntouched: localStorage.getItem('vault') === 'public-test-sentinel-not-an-account' };
  }, created);
  assert.equal(final.cancelled, true); assert.equal(final.rootUntouched, true); assert.deepEqual(errors, []);
  // Owner/new-device UI in the same isolated public-fixture page. No real
  // account, browser profile, seed input, network registration or server is used.
  await page.goto(origin + '/dev/devices');
  const newcomer = page.getByRole('region', { name: 'Подключение нового устройства' });
  const manager = page.getByRole('region', { name: 'Устройства аккаунта' });
  await manager.getByRole('heading', { name: 'Устройства аккаунта' }).waitFor();
  await newcomer.getByLabel('Название устройства', { exact: true }).fill('Browser test phone');
  await newcomer.getByLabel('Пароль этого устройства', { exact: true }).fill('Public-device-password-2026');
  await newcomer.getByRole('button', { name: 'Создать новую заявку', exact: true }).click();
  await newcomer.getByLabel('Содержимое заявки', { exact: true }).waitFor();
  const request = await newcomer.getByLabel('Содержимое заявки', { exact: true }).inputValue();
  const ownerLine = await manager.locator('.address').first().textContent(), owner = ownerLine.replace('Владелец:', '').trim();
  await newcomer.getByLabel('Адрес владельца', { exact: true }).fill(owner);
  await newcomer.getByRole('button', { name: 'Показать код проверки', exact: true }).click();
  await newcomer.locator('.code').waitFor();
  const comparison = (await newcomer.locator('.code').textContent()).trim();
  await manager.getByLabel('Заявка нового устройства', { exact: true }).fill(request);
  await manager.getByRole('button', { name: 'Проверить заявку', exact: true }).click();
  await manager.locator('.code').waitFor();
  assert.equal((await manager.locator('.code').textContent()).trim(), comparison);
  await manager.getByLabel('Код с нового устройства', { exact: true }).fill(comparison);
  await manager.getByRole('button', { name: 'Подтвердить устройство', exact: true }).click();
  await manager.getByLabel('Содержимое ответа', { exact: true }).waitFor();
  const reply = await manager.getByLabel('Содержимое ответа', { exact: true }).inputValue();
  assert.equal(/mnemonic|deviceKey|privateKey|password/.test(reply), false);
  await newcomer.getByLabel('Ответ владельца', { exact: true }).fill(reply);
  await newcomer.getByRole('button', { name: 'Проверить и сохранить привязку', exact: true }).click();
  await newcomer.getByRole('status').filter({ hasText: 'Подтверждение владельца проверено и сохранено' }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.screenshot({ path: resolve(root, '.release/device-manager-mobile.png'), fullPage: true });
  await page.reload();
  await newcomer.getByLabel('Пароль этого устройства', { exact: true }).fill('Public-device-password-2026');
  await newcomer.getByRole('button', { name: 'Разблокировать устройство', exact: true }).click();
  await newcomer.getByRole('status').filter({ hasText: 'Подписанная привязка сохранена локально' }).waitFor();
  await manager.getByRole('button', { name: 'Отозвать доступ: Browser test phone', exact: true }).click();
  await manager.getByRole('button', { name: 'Да, отозвать доступ', exact: true }).click();
  await manager.getByText('Доступ отозван', { exact: true }).waitFor();
  await page.reload(); await manager.getByText('Доступ отозван', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('vault')), 'public-test-sentinel-not-an-account');
  assert.deepEqual(errors, []);
  await context.close();
  console.log('Device browser checks passed: IndexedDB/reload, signer proof, cancellation, owner approval UI, matching comparison, linked-vault reload, durable revoke UI, mobile width, root vault untouched, no page errors');
} finally { await browser?.close(); server.kill(); }
