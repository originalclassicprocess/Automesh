import { readFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isValidAccountId } from '../dist/identity.mjs';

export const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_APP_URL = 'https://automesh.space/';
export function defaultBrowser() { return 'auto'; }
export function browserChannels(browser, platform = process.platform) {
  if (browser !== 'auto') return [browser];
  return platform === 'win32' ? ['msedge', 'chrome', 'chromium'] : ['chrome', 'chromium'];
}
// Stable across plugin upgrades. PLUGIN_DATA is host-specific and can differ
// between command hooks and MCP; use one explicit shared directory instead.
export function dataDir() {
  if (process.env.AUTOMESH_NOTIFIER_DATA_DIR) return resolve(process.env.AUTOMESH_NOTIFIER_DATA_DIR);
  if (!process.env.LOCALAPPDATA) throw new Error('notifier_data_dir_required');
  return join(process.env.LOCALAPPDATA, 'AutomeshNotifier');
}
export function validateConfig(config) {
  if (!config || config.version !== 1 || !isValidAccountId(config.recipient) || !isValidAccountId(config.sender))
    throw new Error('invalid_notifier_config');
  const url = new URL(config.appUrl);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && loopback)) ||
      url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('invalid_app_url');
  if (!['auto', 'msedge', 'chrome', 'chromium'].includes(config.browser)) throw new Error('invalid_browser');
  if (config.playwrightDirectory !== undefined && typeof config.playwrightDirectory !== 'string') throw new Error('invalid_runtime_directory');
  return Object.freeze({ version: 1, recipient: config.recipient, sender: config.sender,
    appUrl: url.href, browser: config.browser, autoNotify: config.autoNotify === true,
    ...(config.playwrightDirectory ? { playwrightDirectory: resolve(config.playwrightDirectory) } : {}) });
}
export async function readConfig(directory = dataDir()) {
  try { return validateConfig(JSON.parse(await readFile(join(directory, 'config.json'), 'utf8'))); }
  catch (error) { if (error.code === 'ENOENT') throw new Error('notifier_not_configured'); throw error; }
}
