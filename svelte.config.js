import adapter from '@sveltejs/adapter-node';
import { buildVersion } from './scripts/build-version.mjs';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		// This application uses its own signed APIs, not SvelteKit remote functions.
		experimental: { remoteFunctions: false },
		adapter: adapter(),
		version: { name: buildVersion() },
		csp: {
			mode: 'nonce',
			directives: {
				'default-src': ['self'],
				'script-src': ['self'],
				'style-src': ['self', 'unsafe-inline'],
				'img-src': ['self', 'data:', 'blob:'],
				'media-src': ['self', 'blob:'],
				'worker-src': ['self'],
				// User-approved home nodes need HTTPS for their authenticated API
				// as well as WSS for signaling. Plain HTTP is scoped to loopback
				// for explicitly configured local model engines such as Ollama.
				'connect-src': ['self', 'https:', 'wss:', 'http://127.0.0.1:*', 'http://localhost:*', 'http://[::1]:*', 'ws://127.0.0.1:*', 'ws://localhost:*'],
				'object-src': ['none'],
				'base-uri': ['none'],
				'frame-ancestors': ['none'],
				'form-action': ['self']
			}
		}
	}
};

export default config;
