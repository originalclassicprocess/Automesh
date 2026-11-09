import { describe, expect, it } from 'vitest';
import { textFitsLimit } from './text-limits';

describe('chat text size limits', () => {
  it('uses the same UTF-8 byte boundary for outgoing and incoming first requests', () => {
    expect(textFitsLimit('я'.repeat(2048), true)).toBe(true);
    expect(textFitsLimit('я'.repeat(2049), true)).toBe(false);
    expect(textFitsLimit('a'.repeat(64 * 1024), false)).toBe(true);
    expect(textFitsLimit('a'.repeat(64 * 1024 + 1), false)).toBe(false);
  });
});
