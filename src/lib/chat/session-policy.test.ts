import { describe, expect, it } from 'vitest';
import { defaultDeleteHistory, historyAction } from './session-policy';

describe('trusted and untrusted session exit policy', () => {
  it('never deletes history on manual or automatic lock', () => {
    expect(defaultDeleteHistory('lock', false)).toBe(false);
    expect(historyAction('lock', false, true)).toBe('keep-in-memory');
    expect(historyAction('lock', true, true)).toBe('save');
  });

  it('defaults to deleting all local history only on untrusted logout', () => {
    expect(defaultDeleteHistory('logout', false)).toBe(true);
    expect(defaultDeleteHistory('logout', true)).toBe(false);
    expect(historyAction('logout', false, true)).toBe('delete');
    expect(historyAction('logout', false, false)).toBe('save');
  });
});
