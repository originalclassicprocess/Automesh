import { describe, expect, it } from 'vitest';
import { obsoleteCaches } from './cache-versions';
const names = ['other-app', 'mesh-autonomy-shell-A', 'mesh-autonomy-shell-B', 'mesh-autonomy-shell-C'];
describe('cache lifetime across multiple tabs', () => {
  it('retains live versions and future/partial installs', () => {
    expect(obsoleteCaches(names, names[2], ['A', 'B'])).toEqual([]);
    expect(obsoleteCaches(names, names[2], ['B'])).toEqual([names[1]]);
  });
  it('keeps all older copies for unknown or suspended legacy clients', () => {
    expect(obsoleteCaches(names, names[2], ['B', null])).toEqual([]);
  });
  it('removes unused old app caches, never another app or a newer install', () => {
    expect(obsoleteCaches(names, names[2], [])).toEqual([names[1]]);
    expect(obsoleteCaches(names, 'absent', [])).toEqual([]);
  });
});
