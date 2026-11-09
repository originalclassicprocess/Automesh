import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { openProfileBrowserCheck, profileCheckFactory } from './browser-check';
import { PROFILE_DATABASE_NAME } from './browser';
let factory: IDBFactory;
const run = '12345678-1234-4234-8234-123456789abc';
beforeEach(() => {
  factory = new IDBFactory(); vi.stubGlobal('indexedDB', factory);
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() { throw new Error('must_not_write_user_settings'); } });
});
afterEach(() => vi.unstubAllGlobals());
describe('disposable profile UI fixture', () => {
  it('only permits the profile database call and maps all writes/clears to one disposable run', async () => {
    const spy = vi.spyOn(factory, 'open'), check = await openProfileBrowserCheck(run);
    await check.bundle.initialize('Проверка'); await check.bundle.create('incoming', 'Входящий');
    await check.clear(); check.close();
    expect(spy.mock.calls.every(([name]) => name === 'automesh-profile-check-v1-' + run || name === 'automesh-profile-check-v1-' + run + '-selection')).toBe(true);
    expect(() => profileCheckFactory(factory, run).open('vault')).toThrow();
    expect(() => profileCheckFactory(factory, 'unsafe')).toThrow();
    const mapped = profileCheckFactory(factory, run); expect(() => mapped.open(PROFILE_DATABASE_NAME, 1)).not.toThrow();
  });
});
