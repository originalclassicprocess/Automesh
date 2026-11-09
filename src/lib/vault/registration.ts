import { generateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { SEED_WORD_COUNTS } from './seed-words';
import { passwordPolicyError } from './password-policy';
export const DEFAULT_SEED_WORD_COUNT = 24;

// No entropy is requested until the submitted password and word count are valid.
export function generateRegistrationMnemonic(password: string, wordCount: number): string {
  const error = passwordPolicyError(password);
  if (error) throw new Error(error);
  if (!SEED_WORD_COUNTS.includes(wordCount)) throw new Error('Недопустимая длина seed-фразы.');
  return generateMnemonic(wordlist, wordCount / 3 * 32);
}
