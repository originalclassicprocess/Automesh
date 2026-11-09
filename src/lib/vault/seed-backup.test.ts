import { describe, expect, it } from 'vitest';
import { backupWordPositions, verifyBackupWords } from './seed-backup';

// A disposable public fixture, not an account used by this application.
const words = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const seed = new TextEncoder().encode(words);

describe('manual seed backup verification', () => {
  it('chooses three distinct, in-range positions for supported phrase lengths', () => {
    const seen = new Set<string>();
    for (const count of [12, 15, 18, 21, 24]) {
      for (let attempt = 0; attempt < 30; attempt++) {
        const positions = backupWordPositions(count);
        expect(positions).toHaveLength(3);
        expect(new Set(positions).size).toBe(3);
        expect(positions.every((position) => position >= 0 && position < count)).toBe(true);
        seen.add(positions.join(','));
      }
    }
    expect(seen.size).toBeGreaterThan(1);
    expect(() => backupWordPositions(0)).toThrow();
    expect(() => backupWordPositions(11)).toThrow();
  });

  it('requires all requested words, tolerating only case and surrounding whitespace', () => {
    expect(verifyBackupWords(seed, [0, 5, 11], [' ABANDON ', 'abandon', 'about'])).toBe(true);
    for (const answers of [['abandon', 'abandon', 'wrong'], ['abandon', '', 'about'], ['abandon']]) {
      expect(verifyBackupWords(seed, [0, 5, 11], answers)).toBe(false);
    }
    expect(new TextDecoder().decode(seed)).toBe(words);
  });

  it('rejects malformed, duplicate, missing or out-of-range positions', () => {
    for (const positions of [[], [0, 0, 11], [0, 5, 12], [-1, 5, 11], [0, 1.5, 11]]) {
      expect(verifyBackupWords(seed, positions, ['abandon', 'abandon', 'about'])).toBe(false);
    }
    expect(verifyBackupWords(new Uint8Array(), [0, 5, 11], ['abandon', 'abandon', 'about'])).toBe(false);
  });
});
