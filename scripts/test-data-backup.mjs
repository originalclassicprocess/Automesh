// Disposable Chromium contexts and a published BIP39 fixture only. Never opens
// a real account, production node or the user's browser profile.
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const moduleRoot = process.argv[2]; if (!moduleRoot) throw new Error('Pass Playwright node_modules directory');
const { chromium } = await import(pathToFileURL(resolve(moduleRoot, 'playwright/index.mjs')).href);
const root = resolve(import.meta.dirname, '..'), output = resolve(root, '.release/data-backup-check');
mkdirSync(output, { recursive: true });
const server = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5194', '--strictPort'],
  { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let diagnostic = '', browser, page;
const errors = [];
server.stderr.on('data', data => diagnostic = (diagnostic + data).slice(-3000));
const ownerPassword = 'Public-fixture-password-2026', dataPassword = 'Independent-data-copy-2026';
try {
  const origin = 'http://127.0.0.1:5194';
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(diagnostic || 'fixture_server_failed');
    try { if ((await fetch(origin + '/dev/backups')).ok) break; } catch {}
    if (i === 99) throw new Error('fixture_server_timeout'); await new Promise(resolve => setTimeout(resolve, 200));
  }
  const executablePath = [chromium.executablePath(), 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
  browser = await chromium.launch({ executablePath, headless: true });
  page = await browser.newPage({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/dev/backups');
  await page.getByLabel('Что сохранить', { exact: true }).selectOption('data');
  await page.getByLabel('Текущий пароль', { exact: true }).fill(ownerPassword);
  await page.getByLabel('Использовать отдельный пароль для этой копии', { exact: true }).check();
  await page.getByLabel('Пароль новой копии', { exact: true }).fill(dataPassword);
  await page.getByLabel('Повторите пароль копии', { exact: true }).fill(dataPassword);
  await page.getByRole('button', { name: 'Создать копию данных без сида', exact: true }).click();
  const link = page.getByRole('link', { name: 'Скачать копию данных', exact: true }); await link.waitFor({ timeout: 30000 });
  const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
  const path = resolve(output, 'fixture.automesh-data'); await download.saveAs(path);
  await page.getByLabel('Файл копии данных', { exact: true }).first().setInputFiles(path);
  await page.getByLabel('Пароль копии данных', { exact: true }).first().fill(ownerPassword);
  await page.getByRole('button', { name: 'Проверить копию данных', exact: true }).first().click();
  await page.getByText('Не удалось открыть копию данных. Проверьте пароль и целостность файла.', { exact: true }).waitFor();
  await page.getByLabel('Пароль копии данных', { exact: true }).first().fill(dataPassword);
  await page.getByRole('button', { name: 'Проверить копию данных', exact: true }).first().click();
  await page.getByRole('button', { name: 'Подтвердить проверку копии данных', exact: true }).click();
  await page.getByText('Копия расшифрована и проверена, включая содержимое файлов.', { exact: true }).waitFor();
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    for (const width of [320, 390, 1920]) {
      await page.setViewportSize({ width, height: 844 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'backup_horizontal_overflow');
      await page.screenshot({ path: resolve(output, `${theme}-${width}.png`), fullPage: true });
    }
  }
  await page.getByText('Восстановить данные из файла', { exact: true }).click();
  const restore = page.locator('details').filter({ has: page.getByText('Восстановить данные из файла', { exact: true }) });
  await restore.getByLabel('Файл копии данных', { exact: true }).setInputFiles(path);
  await restore.getByLabel('Пароль копии данных', { exact: true }).fill(dataPassword);
  await restore.getByRole('button', { name: 'Проверить копию данных', exact: true }).click();
  await restore.getByRole('button', { name: 'Восстановить данные', exact: true }).click();
  await page.getByText('Данные восстановлены в текущем профиле. Сид и права устройств не изменены.', { exact: true }).waitFor();
  const recovered = await page.evaluate(async () => {
    const { accountFromMnemonic } = await import('/src/lib/application/account.ts');
    const { deriveChatStoreKey, loadLocalChatData, loadLocalFileData } = await import('/src/lib/chat/local-store.ts');
    const account = await accountFromMnemonic('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
    try {
      const key = await deriveChatStoreKey(account.identitySeed, account.accountId), data = await loadLocalChatData(key, account.accountId);
      const peer = data.chats.order[0], message = data.chats.byPeer[peer].messages[0];
      const file = await loadLocalFileData(key, account.accountId, `${peer}:${message.file.id}`);
      return { restored: message.restoredFromBackup, bytes: [...file], alias: data.aliases[peer] };
    } finally { account.identitySeed.fill(0); account.provider.dispose(); }
  });
  assert.deepEqual(recovered, { restored: true, bytes: [1, 2, 3, 4], alias: 'Fixture friend' });
  await restore.getByLabel('Файл копии данных', { exact: true }).setInputFiles(path);
  await restore.getByLabel('Пароль копии данных', { exact: true }).fill(dataPassword);
  await restore.getByRole('button', { name: 'Проверить копию данных', exact: true }).click();
  await restore.getByRole('button', { name: 'Восстановить данные', exact: true }).click();
  await restore.getByText('В этом профиле уже есть переписка, контакты или медиа. Эта версия не объединяет истории и не перезаписывает их.', { exact: true }).waitFor();
  const entry = await browser.newPage(); entry.on('pageerror', error => errors.push(error.message));
  await entry.goto(origin + '/'); await entry.getByRole('button', { name: 'Восстановить аккаунт', exact: true }).click();
  await entry.getByRole('button', { name: 'Зашифрованный файл', exact: true }).click();
  await entry.getByLabel('Файл резервной копии', { exact: true }).setInputFiles(path);
  await entry.getByLabel('Пароль файла', { exact: true }).fill(dataPassword);
  await entry.getByRole('button', { name: 'Восстановить аккаунт из файла', exact: true }).click();
  await entry.getByText(/В этой копии нет сида/).waitFor();
  await page.getByLabel('Что сохранить', { exact: true }).selectOption('identity');
  await page.getByLabel('Текущий пароль', { exact: true }).fill(ownerPassword);
  await page.getByLabel('Отдельный пароль файла доступа', { exact: true }).check();
  await page.getByLabel('Пароль файла доступа', { exact: true }).fill('Independent-identity-copy-2026');
  await page.getByLabel('Повторите пароль файла доступа', { exact: true }).fill('Independent-identity-copy-2026');
  await page.getByRole('button', { name: 'Создать зашифрованный файл', exact: true }).click();
  const identityLink = page.getByRole('link', { name: /^Скачать файл/ }); await identityLink.waitFor({ timeout: 30000 });
  const [identityDownload] = await Promise.all([page.waitForEvent('download'), identityLink.click()]);
  const identityPath = resolve(output, 'identity.automesh'); await identityDownload.saveAs(identityPath);
  await page.getByLabel('Файл резервной копии', { exact: true }).setInputFiles(identityPath);
  await page.getByLabel('Пароль файла', { exact: true }).fill('Independent-identity-copy-2026');
  await page.getByRole('button', { name: 'Проверить сохранённый файл', exact: true }).click();
  await page.getByText(/Файл расшифрован, seed корректна/).waitFor();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ dataExport: true, separatePassword: true, readback: true, dataRestore: true, noOverwrite: true,
    identityExport: true, dataCannotLogIn: true, exactFileBytes: true, themes: ['light', 'dark'], widths: [320, 390, 1920], pageErrors: 0 }));
} catch (error) {
  console.error(JSON.stringify({ pageErrors: errors, server: diagnostic, body: page ? (await page.locator('body').innerText().catch(() => '')).slice(-4000) : '' }));
  if (page) await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true }).catch(() => {});
  throw error;
} finally { await browser?.close(); server.kill(); }
