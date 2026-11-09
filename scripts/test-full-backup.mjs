// Fresh browser contexts and public fixtures only; no user browser profile.
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const moduleRoot = process.argv[2]; if (!moduleRoot) throw new Error('Pass Playwright node_modules directory');
const { chromium } = await import(pathToFileURL(resolve(moduleRoot,'playwright/index.mjs')).href);
const root = resolve(import.meta.dirname,'..'), output = resolve(root,'.release/full-backup-check'); mkdirSync(output,{recursive:true});
const server = spawn(process.execPath,[resolve(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','5194','--strictPort'],
  {cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
let diagnostic = ''; server.stderr.on('data',data => diagnostic = (diagnostic + data).slice(-3000));
let browser;
try {
  const origin = 'http://127.0.0.1:5194';
  for (let i=0;i<100;i++) {
    if (server.exitCode !== null) throw new Error(diagnostic || 'fixture_server_failed');
    try { if ((await fetch(origin+'/dev/backups')).ok) break; } catch {}
    if (i===99) throw new Error('fixture_server_timeout'); await new Promise(resolve=>setTimeout(resolve,200));
  }
  const executablePath = [chromium.executablePath(),'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
  browser = await chromium.launch({executablePath,headless:true});
  const page = await browser.newPage({viewport:{width:390,height:844},acceptDownloads:true});
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/dev/backups');
  await page.getByLabel('Текущий пароль',{exact:true}).fill('Public-fixture-password-2026');
  await page.getByRole('button',{name:'Создать полную копию',exact:true}).click();
  const link = page.getByRole('link',{name:'Скачать полную копию',exact:true}); await link.waitFor({timeout:30000});
  await page.evaluate(() => {
    Object.defineProperty(document,'hidden',{configurable:true,value:true}); document.dispatchEvent(new Event('visibilitychange'));
    Reflect.deleteProperty(document,'hidden'); document.dispatchEvent(new Event('visibilitychange'));
  });
  await link.waitFor();
  const [download] = await Promise.all([page.waitForEvent('download'),link.click()]);
  const path = resolve(output,'fixture.automesh-backup'); await download.saveAs(path);
  await page.getByLabel('Файл резервной копии').setInputFiles(path);
  await page.getByLabel('Пароль файла').fill('Public-fixture-password-2026');
  await page.getByRole('button',{name:'Проверить скачанную копию',exact:true}).click();
  await page.getByRole('heading',{name:'Полная копия проверена',exact:true}).waitFor();
  await page.getByRole('button',{name:'Проверить скачанную копию',exact:true}).last().click();
  await page.getByText('Копия расшифрована и проверена, включая содержимое файлов.',{exact:true}).waitFor();
  for (const width of [320,390,1100]) {
    await page.setViewportSize({width,height:844});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'backup_horizontal_overflow');
    await page.screenshot({path:resolve(output,`verified-${width}.png`),fullPage:true});
  }
  // Exercise the normal entry screen, password setup, IndexedDB commit and
  // subsequent unlock in an entirely separate destination browser context.
  const destination = await browser.newContext({viewport:{width:1100,height:850}});
  const restore = await destination.newPage(); restore.on('pageerror',e=>errors.push(e.message));
  await restore.goto(origin+'/');
  await restore.getByRole('button',{name:'Восстановить аккаунт',exact:true}).click();
  await restore.getByRole('button',{name:'Зашифрованный файл',exact:true}).click();
  await restore.getByLabel('Файл резервной копии').setInputFiles(path);
  await restore.getByLabel('Пароль файла').fill('Public-fixture-password-2026');
  await restore.getByRole('button',{name:'Восстановить аккаунт из файла',exact:true}).click();
  await restore.getByRole('heading',{name:'Полная копия проверена',exact:true}).waitFor();
  await restore.getByRole('button',{name:'Восстановить аккаунт из файла',exact:true}).last().click();
  await restore.getByLabel('Пароль',{exact:true}).fill('Destination-strong-password-2026');
  await restore.getByRole('button',{name:'Сохранить',exact:true}).click();
  try { await restore.getByText(/Fixture friend/).first().waitFor({timeout:30000}); }
  catch (error) { await restore.screenshot({path:resolve(output,'restore-failure.png'),fullPage:true}); console.error((await restore.locator('body').innerText()).slice(-4000)); throw error; }
  await restore.getByText(/Fixture friend/).first().click();
  await restore.getByText(/fixture.bin/).first().waitFor();
  await restore.getByText(/Из резервной копии/).first().waitFor();
  await restore.screenshot({path:resolve(output,'restored-normal-entry.png'),fullPage:true});
  await restore.reload();
  await restore.getByLabel('Пароль',{exact:true}).fill('Destination-strong-password-2026');
  await restore.getByRole('button',{name:'Войти',exact:true}).click();
  await restore.getByText(/Fixture friend/).first().waitFor({timeout:30000});
  await destination.close();
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({export:true,download:true,readback:true,normalEntryRestore:true,reloadUnlock:true,viewportWidths:[320,390,1100],pageErrors:0,output}));
} finally { await browser?.close(); server.kill(); }
