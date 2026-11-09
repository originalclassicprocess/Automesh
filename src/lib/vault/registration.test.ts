import { describe, expect, it, vi } from 'vitest';
import { mnemonicToEntropy, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { DEFAULT_SEED_WORD_COUNT, generateRegistrationMnemonic } from './registration';
import { SEED_WORD_COUNTS } from './seed-words';

describe('registration creates entropy only after valid form submission', () => {
  it('defaults to 24 words', () => { expect(DEFAULT_SEED_WORD_COUNT).toBe(24); });
  it('rejects short passwords and invalid word counts without requesting entropy', () => {
    const random = vi.spyOn(crypto, 'getRandomValues');
    try {
      expect(() => generateRegistrationMnemonic('', 24)).toThrow('10');
      expect(() => generateRegistrationMnemonic('123456789', 24)).toThrow('10');
      for (const count of [20, 0, 13, 25, NaN, Infinity]) expect(() => generateRegistrationMnemonic('1234567890', count)).toThrow();
      expect(random).not.toHaveBeenCalled();
    } finally { random.mockRestore(); }
  });
  it.each(SEED_WORD_COUNTS)('generates a valid BIP39 phrase with %s words', count => {
    const phrase = generateRegistrationMnemonic('test-password-only', count);
    expect(phrase.split(' ')).toHaveLength(count);
    expect(validateMnemonic(phrase, wordlist)).toBe(true);
    expect(mnemonicToEntropy(phrase, wordlist)).toHaveLength(count / 3 * 4);
  });
});
