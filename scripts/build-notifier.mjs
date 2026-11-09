import { build } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const plugin = resolve(root, 'plugins/automesh-notifier');
const common = {
  configFile: false, root, publicDir: false,
  resolve: { alias: { $lib: resolve(root, 'src/lib') } },
  define: { 'import.meta.env': '{}' },
};
await build({ ...common, build: {
  outDir: resolve(plugin, 'dist'), emptyOutDir: false, minify: true,
  lib: { entry: resolve(plugin, 'browser/client.ts'), name: 'AutomeshNotifier', formats: ['iife'], fileName: () => 'browser.js' },
} });
await build({ ...common, build: {
  outDir: resolve(plugin, 'dist'), emptyOutDir: false, minify: true,
  lib: { entry: resolve(plugin, 'browser/identity.ts'), formats: ['es'], fileName: () => 'identity.mjs' },
} });
