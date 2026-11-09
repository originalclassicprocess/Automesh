import { describe, expect, it } from 'vitest';
import { normalizeSeedWord, seedWordIsValid } from './seed-words';
describe('seed word hints', () => {
  it('normalizes case and surrounding whitespace, not misspellings', () => {
    expect(normalizeSeedWord(' ABOUT ')).toBe('about');
    expect(seedWordIsValid(' ABOUT ')).toBe(true);
    expect(seedWordIsValid('abotu')).toBe(false);
    expect(seedWordIsValid('abandon about')).toBe(false);
    expect(seedWordIsValid('')).toBe(false);
  });
});
