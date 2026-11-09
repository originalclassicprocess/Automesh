import { describe, expect, it } from 'vitest';
import { isAppEscape } from './back-key';
const escape = { key: 'Escape', repeat:false, isComposing:false, defaultPrevented:false, altKey:false, ctrlKey:false, metaKey:false };
describe('desktop Escape navigation', () => {
  it('handles only an unmodified initial Escape', () => {
    expect(isAppEscape(escape)).toBe(true);
    expect(isAppEscape({ ...escape, key:'ArrowLeft' })).toBe(false);
    for (const property of ['repeat', 'isComposing', 'defaultPrevented', 'altKey', 'ctrlKey', 'metaKey'] as const)
      expect(isAppEscape({ ...escape, [property]:true })).toBe(false);
  });
});
