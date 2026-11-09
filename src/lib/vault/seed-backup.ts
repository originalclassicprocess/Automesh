const WORD_COUNTS = [12, 15, 18, 21, 24];
export const BACKUP_CHECK_WORDS = 3;

function randomBelow(limit: number): number {
  const ceiling = 0x1_0000_0000 - (0x1_0000_0000 % limit);
  const value = new Uint32Array(1);
  do { crypto.getRandomValues(value); } while (value[0] >= ceiling);
  return value[0] % limit;
}

/** Zero-based, distinct positions; never persist the words used for this check. */
export function backupWordPositions(wordCount: number): number[] {
  if (!WORD_COUNTS.includes(wordCount)) throw new Error('invalid_seed_word_count');
  const positions = Array.from({ length: wordCount }, (_, index) => index);
  for (let index = 0; index < BACKUP_CHECK_WORDS; index++) {
    const next = index + randomBelow(wordCount - index);
    [positions[index], positions[next]] = [positions[next], positions[index]];
  }
  return positions.slice(0, BACKUP_CHECK_WORDS).sort((a, b) => a - b);
}

export function verifyBackupWords(seed: Uint8Array, positions: readonly number[], answers: readonly string[]): boolean {
  const words = new TextDecoder().decode(seed).trim().split(/\s+/);
  if (!WORD_COUNTS.includes(words.length) || positions.length !== BACKUP_CHECK_WORDS ||
      answers.length !== BACKUP_CHECK_WORDS || new Set(positions).size !== BACKUP_CHECK_WORDS ||
      positions.some((position) => !Number.isInteger(position) || position < 0 || position >= words.length)) return false;
  return positions.every((position, index) => words[position] === answers[index].trim().toLowerCase());
}
