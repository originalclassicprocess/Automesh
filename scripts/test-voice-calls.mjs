// Headless fixture QA only; no existing browser profile or user account is read.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const moduleRoot = process.argv[2];
if (!moduleRoot) throw new Error('Pass the bundled Playwright node_modules directory');
const { chromium } = await import(pathToFileURL(resolve(moduleRoot, 'playwright/index.mjs')).href);
const root = resolve(import.meta.dirname, '..'), output = resolve(root, '.release/call-check'); mkdirSync(output, { recursive: true });
const server = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5192', '--strictPort'], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let serverError = ''; server.stderr.on('data', data => { serverError = (serverError + data).slice(-3000); });
let browser;
try {
  const origin = 'http://127.0.0.1:5192';
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(serverError || 'fixture_server_failed');
    try { if ((await fetch(origin + '/dev/calls')).ok) break; } catch {}
    if (i === 99) throw new Error('fixture_server_timeout'); await new Promise(resolve => setTimeout(resolve, 200));
  }
  const executablePath = [chromium.executablePath(), 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
  browser = await chromium.launch({ executablePath, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/dev/calls?run=1');
  await page.getByTestId('call-browser-result').filter({ hasText: /cycles|FAILED/ }).waitFor({ timeout: 90000 });
  const result = await page.getByTestId('call-browser-result').textContent(); assert(!result.startsWith('FAILED'), result);
  assert.equal(JSON.parse(result).cycles, 4); assert.deepEqual(errors, []);
  for (const width of [1100, 390, 320]) {
    await page.setViewportSize({ width, height: 850 });
    await page.getByRole('button', { name: 'Входящий', exact: true }).click();
    await page.getByRole('dialog').waitFor(); await page.screenshot({ path: resolve(output, `incoming-${width}.png`) });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'horizontal_overflow');
    await page.getByRole('button', { name: 'Принять', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click();
    await page.screenshot({ path: resolve(output, `history-${width}.png`) });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'history_overflow');
    await page.getByRole('button', { name: 'Открыть звонок: Анна · пример', exact: true }).click();
    const incomingAudio = page.getByLabel('Звук собеседника', { exact: true });
    await page.getByRole('button', { name: 'Выключить звук', exact: true }).click();
    assert.equal(await incomingAudio.evaluate(element => element.muted), true, 'remote_audio_not_muted');
    assert.equal(await page.getByRole('button', { name: 'Выключить микрофон', exact: true }).getAttribute('aria-pressed'), 'false', 'speaker_control_muted_microphone');
    await page.getByRole('button', { name: 'Включить звук', exact: true }).click();
    assert.equal(await incomingAudio.evaluate(element => element.muted), false, 'remote_audio_not_unmuted');
    await page.getByRole('button', { name: /^Аудиовыход/ }).click();
    await page.screenshot({ path: resolve(output, `output-${width}.png`) });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'output_overflow');
    await page.getByRole('button', { name: /^Аудиовыход/ }).click();
    await page.getByRole('button', { name: 'Проверить звонок', exact: true }).click();
    await page.getByAltText('QR проверочного кода текущего звонка').waitFor();
    await page.screenshot({ path: resolve(output, `active-${width}.png`) });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'verification_overflow');
    await page.getByRole('button', { name: 'Завершить', exact: true }).click();
    const frozenTime = await page.getByLabel('Длительность звонка').textContent();
    await page.waitForTimeout(1200);
    assert.equal(await page.getByLabel('Длительность звонка').textContent(), frozenTime, 'ended_duration_moved');
    assert(await page.getByLabel('Запись звонка', { exact: true }).textContent().then(text => text.includes('завершён')), 'ended_history_missing');
    await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click();
  }
  assert.deepEqual(errors, []); console.log(JSON.stringify({ ...JSON.parse(result), uiWidths: [1100, 390, 320], errors: 0, output }));
} finally { await browser?.close(); server.kill(); }
