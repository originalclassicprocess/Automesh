import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { buildVersion } from '../scripts/build-version.mjs';
import * as legacy from '../src/lib/node/protocol.js';
import * as shared from '../nodes/packages/protocol/src/protocol.js';
import { createSignalingServer as oldSignal } from './signaling.js';
import { createSignalingServer as sharedSignal } from '../nodes/packages/runtime/src/signaling.js';

describe('app to standalone nodes integration', () => {
  it('uses the identical protocol functions and signaling implementation, not forked copies', () => {
    expect(legacy.normalizeEnvelope).toBe(shared.normalizeEnvelope);
    expect(legacy.nodeProofBytes).toBe(shared.nodeProofBytes);
    expect(oldSignal).toBe(sharedSignal);
    for (const directory of ['../src/lib/node/', './node/']) {
      for (const name of readdirSync(new URL(directory, import.meta.url)).filter(name => name.endsWith('.js') && !name.includes('.test.') && name !== 'test-protection.fixture.js')) {
        const source = readFileSync(new URL(directory + name, import.meta.url), 'utf8');
        expect(source.length).toBeLessThan(400);
        expect(source).toContain('nodes/');
      }
    }
  });
  it('includes relocated dependencies in build-version and release packaging', () => {
    const hashing = readFileSync(new URL('../scripts/build-version.mjs', import.meta.url), 'utf8');
    expect(hashing).toContain("walk('nodes/packages/protocol/src')");
    const packaging = readFileSync(new URL('../scripts/prepare-release.mjs', import.meta.url), 'utf8');
    expect(packaging).toContain("'nodes/packages/protocol/src'");
    expect(packaging).toContain("'nodes/packages/runtime/src/signaling.js'");
    expect(buildVersion()).toBe(buildVersion());
  });
});
