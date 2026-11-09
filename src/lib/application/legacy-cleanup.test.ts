import { describe, expect, it } from 'vitest';
import { removeLegacyBrowserLogs } from './legacy-cleanup';

describe('removing legacy telemetry', () => {
  it('removes only debugLogs, including corrupt data, and is idempotent', () => {
    const data = new Map([['debugLogs', '{corrupt'], ['vault', 'encrypted'], ['history', 'encrypted']]);
    const storage = () => ({ removeItem: (key: string) => { data.delete(key); } });
    removeLegacyBrowserLogs(storage); removeLegacyBrowserLogs(storage);
    expect([...data]).toEqual([['vault', 'encrypted'], ['history', 'encrypted']]);
  });
  it('does not break startup if access or deletion is denied', () => {
    expect(() => removeLegacyBrowserLogs(() => { throw new Error('denied'); })).not.toThrow();
    expect(() => removeLegacyBrowserLogs(() => ({ removeItem: () => { throw new Error('denied'); } }))).not.toThrow();
  });
});
