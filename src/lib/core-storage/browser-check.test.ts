import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { openBrowserCoreCheck, testCoreFactory } from './browser-check';
import { CORE_DATABASE_NAME } from './indexeddb';

const runId = '12345678-1234-4234-8234-123456789abc';
let factory: IDBFactory;
beforeEach(() => {
  factory = new IDBFactory(); vi.stubGlobal('indexedDB', factory);
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { throw new Error('must_not_change_user_settings'); } });
});
afterEach(() => vi.unstubAllGlobals());

describe('disposable browser fixture safety', () => {
  it('allows only the known database call and remaps it to its own test namespace', () => {
    const open = vi.spyOn(factory, 'open'), mapped = testCoreFactory(factory, runId);
    mapped.open(CORE_DATABASE_NAME, 1);
    expect(open).toHaveBeenCalledExactlyOnceWith('automesh-core-browser-check-v1-' + runId, 1);
    expect(() => mapped.open('user-history', 1)).toThrow('unexpected_browser_check_database');
    expect(() => testCoreFactory(factory, '../unsafe')).toThrow('invalid_browser_check_id');
  });
  it('round-trips the fixture, catches a concurrent repeat, and checks corruption without touching user storage', async () => {
    const opened = vi.spyOn(factory, 'open');
    const first = await openBrowserCoreCheck(runId), output: string[] = [];
    await first.prepare(message => output.push(message)); first.close();
    const a = await openBrowserCoreCheck(runId), b = await openBrowserCoreCheck(runId);
    await a.verify(message => output.push(message)); await b.verify(message => output.push(message));
    const races: string[] = [];
    await Promise.all([a.race(m => races.push(m)), b.race(m => races.push(m))]);
    expect(races.filter(m => m === 'ГОНКА: операция принята этой вкладкой.')).toHaveLength(1);
    expect(races.filter(m => m === 'ГОНКА: повтор отклонён этой вкладкой.')).toHaveLength(1);
    await a.regress(message => output.push(message)); b.close();
    expect(output.filter(m => m.startsWith('ПРОШЛО:'))).toHaveLength(6);
    expect(opened.mock.calls.every(([name]) => name === 'automesh-core-browser-check-v1-' + runId)).toBe(true);
  });
  it('fails when no prepared persisted fixture exists instead of giving a false success', async () => {
    const fixture = await openBrowserCoreCheck(runId);
    await expect(fixture.verify(() => {})).rejects.toThrow('policy_unavailable'); fixture.close();
  });
});
