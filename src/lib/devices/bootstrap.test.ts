import { beforeAll, describe, expect, it } from 'vitest';
import { deviceBootstrapPackets, readDeviceBootstrap } from './bootstrap';
import { WebCryptoIdentity } from '../identity/webcrypto';
import { accountIdFromPublicKey } from '../addressing/account-id.js';
import type { DeviceEvent } from './delivery';
import { emptyDeviceSettings, normalizeDeviceSettings } from './settings';
let owner: string, other: string;
beforeAll(async () => {
  const a = new WebCryptoIdentity(), b = new WebCryptoIdentity();
  try { await a.create(); await b.create(); owner = await accountIdFromPublicKey(await a.getPublicKeyBytes()); other = await accountIdFromPublicKey(await b.getPublicKeyBytes()); }
  finally { a.dispose(); b.dispose(); }
});
const event = (text: string): DeviceEvent => ({ id: crypto.randomUUID(), from: owner, to: owner, authorDevice: owner, timestamp: Date.now(), text });
describe('encrypted owner-only initial profile and contacts', () => {
  it('imports only an authenticated owner self-message, never another linked device', () => {
    const text = deviceBootstrapPackets({ nickname: 'Profile', contacts: [{ address: other, name: 'Contact' }] })[0];
    expect(readDeviceBootstrap(event(text), owner)).toEqual({ nickname: 'Profile', contacts: [{ address: other, name: 'Contact' }] });
    expect(() => readDeviceBootstrap({ ...event(text), authorDevice: other }, owner)).toThrow('denied');
    expect(() => readDeviceBootstrap({ ...event(text), from: other }, owner)).toThrow('denied');
    expect(() => readDeviceBootstrap({ ...event(text), to: other }, owner)).toThrow('denied');
    expect(readDeviceBootstrap(event('Normal text'), owner)).toBeNull();
  });
  it('bounds packets and rejects duplicate contacts and control-character names', () => {
    const packet = deviceBootstrapPackets({ nickname: 'Profile', contacts: [{ address: other, name: 'Contact' }, { address: other, name: 'Again' }] })[0];
    expect(() => readDeviceBootstrap(event(packet), owner)).toThrow('denied');
    const bad = deviceBootstrapPackets({ nickname: 'Bad\nname', contacts: [] })[0];
    expect(() => readDeviceBootstrap(event(bad), owner)).toThrow('denied');
    for (const text of deviceBootstrapPackets({ nickname: 'p', contacts: Array.from({ length: 50 }, () => ({ address: other, name: 'Я'.repeat(32) })) }))
      expect(new TextEncoder().encode(text).length).toBeLessThan(4096);
  });
  it('retains bounded durable import markers so reload does not overwrite local contacts again', () => {
    const id = crypto.randomUUID();
    expect(normalizeDeviceSettings({ ...emptyDeviceSettings(), bootstrapSeen: [id] }).bootstrapSeen).toEqual([id]);
    expect(() => normalizeDeviceSettings({ ...emptyDeviceSettings(), bootstrapSeen: [id, id] })).toThrow();
    expect(() => normalizeDeviceSettings({ ...emptyDeviceSettings(), bootstrapSeen: ['invalid'] })).toThrow();
  });
});
