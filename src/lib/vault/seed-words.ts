import { wordlist } from '@scure/bip39/wordlists/english.js';
const dictionary = new Set(wordlist);
export const SEED_WORD_COUNTS = [12, 15, 18, 21, 24];
export function normalizeSeedWord(value: string): string { return value.trim().toLowerCase(); }
export function seedWordIsValid(value: string): boolean { return dictionary.has(normalizeSeedWord(value)); }
