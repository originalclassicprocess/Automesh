import { expect, it } from 'vitest';
import { tokenBucket } from './limits.js';

it('bounds bursts and replenishes gradually without accumulating unlimited credit', () => {
  let time = 0; const allow = tokenBucket(2, 3, () => time);
  expect(allow()).toBe(true); expect(allow(2)).toBe(true); expect(allow()).toBe(false);
  time = 250; expect(allow()).toBe(false);
  time = 500; expect(allow()).toBe(true);
  time = 100000; expect(allow(4)).toBe(false); expect(allow(3)).toBe(true);
});
