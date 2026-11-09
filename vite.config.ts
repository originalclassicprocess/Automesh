import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import { createDevicePairingRelay } from './server/device-pairing.js';
import { buildInformationPlugin } from './scripts/build-info.mjs';

export default defineConfig({
  plugins: [buildInformationPlugin(), sveltekit(), { name: 'local-device-pairing', apply: 'serve', configureServer(server) {
    const origin = `http://127.0.0.1:${server.config.server.port}`;
    const pairing = createDevicePairingRelay({ origin }); server.httpServer?.once('close', () => pairing.close());
    server.middlewares.use((request, response, next) => {
      const pathname = new URL((request as unknown as { url?: string }).url ?? '/', origin).pathname;
      if (!pathname.startsWith('/api/device-pair/')) { next(); return; }
      void pairing.handle(request, response, pathname).catch(() => { response.statusCode = 400; response.end(); });
    });
  } }],
  // node:test suites have their own runner; never load them into Vitest.
  test: { include: ['src/**/*.test.{ts,js}', 'server/**/*.test.{ts,js}'], setupFiles:['src/lib/i18n/test-setup.ts'] },
  // Browser-only crypto/password tools are bundled into SSR as well: do not
  // add their build-time dependencies to the hosting runtime dependency set.
  ssr: { noExternal: ['fflate', '@hpke/core', '@hpke/common', '@zxcvbn-ts/core',
    '@zxcvbn-ts/language-common', '@zxcvbn-ts/language-en', '@zxcvbn-ts/language-ru',
    '@zxcvbn-ts/dictionary-compression', 'fastest-levenshtein'] },
  server: {
    host: '127.0.0.1',
    // Builds/installers are output, not dev sources. Watching a freshly copied
    // Windows executable can stop the dev server with EBUSY during a build.
    watch: { ignored: ['**/build/**', '**/.release/**', '**/nodes/downloads/**', '**/nodes/node_modules/**'] },
    proxy: { '/signal': { target: 'ws://127.0.0.1:3001', ws: true } }
  },
  preview: {
    proxy: { '/signal': { target: 'ws://127.0.0.1:3001', ws: true } }
  }
});
