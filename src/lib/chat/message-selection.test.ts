import { describe, expect, it } from 'vitest';
import { selectEveryMessage, toggleSelection, selectionSummary } from './message-selection';
describe('message selection', () => {
  it('reports all, partial and empty states without counting stale or duplicate IDs', () => {
    const rows = [{ id: 'one' }, { id: 'two' }, { id: 'two' }];
    expect(selectionSummary(rows, ['one', 'one', 'stale'])).toEqual({ count: 1, total: 2, all: false, partial: true });
    expect(selectionSummary(rows, ['one', 'two'])).toEqual({ count: 2, total: 2, all: true, partial: false });
    expect(selectionSummary([], ['stale'])).toEqual({ count: 0, total: 0, all: false, partial: false });
  });
  it('selects the whole history, including over fifty messages, without duplicates', () => {
    const messages = Array.from({ length: 125 }, (_, i) => ({ id: `${i}` }));
    expect(selectEveryMessage([...messages, messages[0]])).toEqual(messages.map(m => m.id));
    expect(selectEveryMessage([])).toEqual([]);
  });
  it('toggles a message without mutating the previous selection', () => {
    const before = ['one', 'two']; expect(toggleSelection(before, 'one')).toEqual(['two']);
    expect(toggleSelection(before, 'three')).toEqual(['one', 'two', 'three']); expect(before).toEqual(['one', 'two']);
  });
});
