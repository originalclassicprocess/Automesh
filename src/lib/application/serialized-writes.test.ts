import { describe, expect, it } from 'vitest';
import { SerializedWrites } from './serialized-writes';

describe('history write queue', () => {
  it('orders snapshots and waits for outstanding writes', async () => {
    const queue = new SerializedWrites(); const order: number[] = [];
    let release!: () => void;
    const first = queue.enqueue(async () => { await new Promise<void>(resolve => { release = resolve; }); order.push(1); });
    const second = queue.enqueue(async () => { order.push(2); });
    await Promise.resolve(); await Promise.resolve();
    expect(order).toEqual([]); release();
    await queue.settled(); await first; await second;
    expect(order).toEqual([1, 2]);
  });
  it('reports failure without blocking later saves', async () => {
    const queue = new SerializedWrites();
    const first = queue.enqueue(async () => { throw new Error('quota'); });
    const second = queue.enqueue(async () => 'saved');
    await expect(first).rejects.toThrow('quota');
    await expect(second).resolves.toBe('saved'); await queue.settled();
  });
});
