import { describe, expect, it, vi } from 'vitest';
import { AutoUnlock } from './auto-unlock';
describe('automatic unlock', () => {
  it('debounces edits and does not repeat failed guesses or check empty fields', async () => {
    vi.useFakeTimers();
    try {
      const attempt = vi.fn(async (_password: string, _current: () => boolean) => {}); const auto = new AutoUnlock(attempt);
      auto.schedule('a'); await vi.advanceTimersByTimeAsync(500); auto.schedule('ab');
      await vi.advanceTimersByTimeAsync(700); expect(attempt).toHaveBeenCalledTimes(1);
      expect(attempt.mock.calls[0][0]).toBe('ab');
      await vi.advanceTimersByTimeAsync(5000); expect(attempt).toHaveBeenCalledTimes(1);
      auto.schedule(''); await vi.advanceTimersByTimeAsync(1000); expect(attempt).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
  it('serializes attempts and invalidates results after edit or leaving the screen', async () => {
    vi.useFakeTimers();
    try {
      let resolve!: () => void; let current!: () => boolean;
      const attempt = vi.fn(async (_password: string, valid: () => boolean) => {
        current = valid; await new Promise<void>(done => resolve = done);
      });
      const auto = new AutoUnlock(attempt); auto.schedule('old'); await vi.advanceTimersByTimeAsync(700);
      expect(current()).toBe(true); auto.schedule('new'); expect(current()).toBe(false);
      await vi.advanceTimersByTimeAsync(700); expect(attempt).toHaveBeenCalledTimes(1);
      resolve(); await vi.advanceTimersByTimeAsync(200); expect(attempt).toHaveBeenCalledTimes(2);
      auto.cancel(); expect(current()).toBe(false); resolve();
    } finally { vi.useRealTimers(); }
  });
});
