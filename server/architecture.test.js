import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = path => readFileSync(new URL(`../src/lib/${path}`, import.meta.url), 'utf8');
describe('core boundaries and telemetry regression guard', () => {
  it('keeps the portable core free of UI, implicit storage, network and secret export', () => {
    const root = new URL('../src/lib/core/', import.meta.url);
    for (const file of readdirSync(root).filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts'))) {
      const text = readFileSync(new URL(file, root), 'utf8');
      expect(text).not.toMatch(/from ['"]\$lib|from ['"]svelte|localStorage|sessionStorage|indexedDB|fetch\(|new WebSocket|document\.|window\.|console\.(log|info|warn|error)|exportKey\(/);
    }
    expect(source('chat/ChatService.ts')).toContain('await verifySignedEnvelope(');
    const config = readFileSync(new URL('../tsconfig.core.json', import.meta.url), 'utf8');
    expect(config).not.toContain('.svelte-kit');
    expect(config).not.toContain('"paths"');
  });
  it('ships the stateless courier protocol and keeps crypto free of UI and storage', () => {
    const packaging = readFileSync(new URL('../scripts/prepare-release.mjs', import.meta.url), 'utf8');
    expect(packaging).toContain("'src/lib/node/courier-protocol.js'");
    const crypto = source('node/courier-crypto.ts');
    expect(crypto).not.toMatch(/localStorage|sessionStorage|indexedDB|svelte|fetch\(|new WebSocket|\.seed/);
    const courier = readFileSync(new URL('../nodes/packages/runtime/src/courier.js', import.meta.url), 'utf8');
    expect(courier).not.toMatch(/console\.(log|info|warn|error)|fromSeed\s*\(|mnemonicToSeed\s*\(/);
  });
  it('keeps chat independent from concrete transports, UI and browser storage', () => {
    const chat = source('chat/ChatService.ts');
    expect(chat).not.toMatch(/import[^;]*WebRTCTransport/s);
    expect(chat).not.toMatch(/localStorage|sessionStorage|indexedDB|svelte/);
    expect(chat).toContain('constructor(transport: Transport)');
    expect(source('transport/DirectWebRTCTransport.ts')).not.toMatch(/from ['"].*\/WebRTCTransport/);
  });
  it('does not retain old account/message diagnostics in runtime code', () => {
    for (const path of ['chat/ChatService.ts', 'transport/WebRTCTransport.ts', 'transport/DirectWebRTCTransport.ts']) {
      expect(source(path)).not.toMatch(/console\.(log|info|warn|error)|debug\/logger|debugLogs/);
    }
    const page = readFileSync(new URL('../src/routes/+page.svelte', import.meta.url), 'utf8');
    expect(page).not.toMatch(/console\.(log|info|warn|error)|debug\/logger|debug\/store/);
    const server = readFileSync(new URL('./signaling.js', import.meta.url), 'utf8');
    expect(server).not.toMatch(/debugRouting|MESH_SIGNAL_DEBUG|\[route\]|\[\+\]|\[-\]/);
  });
});
