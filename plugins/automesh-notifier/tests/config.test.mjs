import { test } from 'node:test';
import assert from 'node:assert/strict';
import { senderIdentity } from '../dist/identity.mjs';
import { validateConfig, browserChannels } from '../server/config.mjs';

const first = await senderIdentity(new Uint8Array(32).fill(11));
const second = await senderIdentity(new Uint8Array(32).fill(12));
const config = { version: 1, sender: first.address, recipient: second.address,
  appUrl: 'https://messenger.example/', browser: 'auto', autoNotify: false };
first.provider.dispose(); second.provider.dispose();
test('any valid Automesh recipient and deployment origin, without a saved machine path', () => {
  const value = validateConfig(config);
  assert.equal(value.appUrl, 'https://messenger.example/');
  assert.equal(value.recipient, second.address);
  assert.equal(Object.hasOwn(value, 'playwrightDirectory'), false);
  assert.equal(value.autoNotify, false);
});
test('browser auto detection does not require one browser vendor', () => {
  assert.deepEqual(browserChannels('auto', 'win32'), ['msedge', 'chrome', 'chromium']);
  assert.deepEqual(browserChannels('chrome', 'win32'), ['chrome']);
});
test('untrusted app URLs and invalid recipient are refused', () => {
  for (const appUrl of ['http://public.example/', 'https://user:password@messenger.example/', 'file:///tmp/', 'https://messenger.example/?token=secret']) {
    assert.throws(() => validateConfig({ ...config, appUrl }));
  }
  assert.throws(() => validateConfig({ ...config, recipient: 'arbitrary-address' }));
  assert.equal(validateConfig({ ...config, appUrl: 'http://127.0.0.1:5000/' }).appUrl, 'http://127.0.0.1:5000/');
});
