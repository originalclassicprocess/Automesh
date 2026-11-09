import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { access } from 'node:fs/promises';
import { pluginRoot, dataDir, browserChannels } from './config.mjs';

export async function loadPlaywright(config = {}) {
  // An explicitly supplied package directory is useful with bundled runtimes.
  const directory = process.env.AUTOMESH_PLAYWRIGHT_DIR ?? config.playwrightDirectory;
  if (directory) return import(pathToFileURL(resolve(directory, 'index.mjs')).href);
  const entry = join(dataDir(), 'runtime/node_modules/playwright/index.mjs');
  try { await access(entry); return import(pathToFileURL(entry).href); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return import('playwright');
}
export async function startBrowserClient(config, seed) {
  const { chromium } = await loadPlaywright(config);
  let browser;
  for (const channel of browserChannels(config.browser)) {
    try {
      browser = await chromium.launch({ headless: true,
        ...(channel === 'chromium' ? {} : { channel }), timeout: 10000 });
      break;
    } catch { if (config.browser !== 'auto') throw new Error('configured_browser_unavailable'); }
  }
  if (!browser) throw new Error('browser_unavailable');
  const lifetime = setTimeout(() => { void browser.close(); }, 35000);
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    if (['localhost', '127.0.0.1', '[::1]'].includes(new URL(config.appUrl).hostname)) {
      await context.grantPermissions(['local-network-access'], { origin: new URL(config.appUrl).origin });
    }
    // An owned, isolated HTML shell at the configured application origin.
    // Never execute the website's scripts alongside the sender's secret.
    // The WebSocket still performs Automesh's signed registration challenge.
    await context.route('**/*', route => route.request().url() === config.appUrl
      ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>Automesh notifier</title>' })
      : route.abort());
    const page = await context.newPage();
    if (process.env.AUTOMESH_NOTIFIER_DEBUG === '1') {
      page.on('console', message => { if (message.type() === 'error') process.stderr.write(`browser: ${message.text()}\n`); });
      page.on('websocket', socket => socket.on('socketerror', error => process.stderr.write(`WebSocket: ${error}\n`)));
    }
    await page.goto(config.appUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.addScriptTag({ content: await readFile(join(pluginRoot, 'dist/browser.js'), 'utf8') });
    const url = new URL('signal', config.appUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const initial = await page.evaluate(async ({ bytes, signaling, recipient }) => {
      globalThis.automeshClient = await globalThis.AutomeshNotifier.openClient(bytes, signaling, recipient);
      return globalThis.automeshClient.getStatus();
    }, { bytes: [...seed], signaling: url.href, recipient: config.recipient });
    if (initial.address !== config.sender) throw new Error('sender_identity_mismatch');
    return {
      async send(entry) {
        return page.evaluate(({ text, messageId }) => globalThis.automeshClient.send(text, messageId), entry);
      },
      async close() { clearTimeout(lifetime); await browser.close(); },
      page,
    };
  } catch (error) { clearTimeout(lifetime); await browser.close(); throw error; }
}
