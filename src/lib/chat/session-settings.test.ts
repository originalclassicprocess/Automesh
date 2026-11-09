import { describe, expect, it } from 'vitest';
import { autoLockIsDue, DEFAULT_AUTO_LOCK_MINUTES, normalizeAutoLockMinutes, readReceiptsForMode } from './session-settings';

describe('session settings', () => {
  it('locks at the selected deadline and respects renewed activity', () => {
    const started = 1000;
    expect(autoLockIsDue(started, started + 59_999, 1)).toBe(false);
    expect(autoLockIsDue(started, started + 60_000, 1)).toBe(true);
    expect(autoLockIsDue(started + 30_000, started + 60_000, 1)).toBe(false);
    expect(autoLockIsDue(started, started + 15 * 60_000, 15)).toBe(true);
    expect(autoLockIsDue(started, started + 15 * 60_000, 60)).toBe(false);
  });

  it('keeps automatic locking disabled even after a long absence', () => {
    expect(normalizeAutoLockMinutes(0)).toBe(0);
    expect(autoLockIsDue(0, 7 * 24 * 60 * 60_000, 0)).toBe(false);
  });

  it('defaults missing or invalid archive settings to 15 minutes', () => {
    for (const value of [undefined, null, '0', -1, 1.5, NaN, Infinity, 1441]) {
      expect(normalizeAutoLockMinutes(value)).toBe(DEFAULT_AUTO_LOCK_MINUTES);
    }
  });

  it('enables receipts by default only for trusted sessions and honors opting out', () => {
    expect(readReceiptsForMode(true)).toBe(true);
    expect(readReceiptsForMode(false)).toBe(false);
    expect(readReceiptsForMode(true, false)).toBe(false);
    expect(readReceiptsForMode(false, true)).toBe(false);
  });
});
