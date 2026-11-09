import { describe, expect, it, vi } from 'vitest';
import { eraseApplicationData } from './emergency-storage';
describe('emergency deletion lifecycle', () => {
  it('attempts profile deletion and reports partial failure without skipping other data', async () => {
    const vault = vi.fn(), profiles = vi.fn(async () => { throw new Error('blocked'); });
    expect(await eraseApplicationData({ announce() {}, stop() {}, drain: async () => {}, clearHistory: async () => {},
      clearProfiles: profiles, clearVault: vault, clearCache: async () => {} })).toEqual(['профили']);
    expect(profiles).toHaveBeenCalledOnce(); expect(vault).toHaveBeenCalledOnce();
  });
  it('stops sessions synchronously and waits for old writes before clearing storage', async () => {
    const order: string[] = []; let resolve!: () => void;
    const result = eraseApplicationData({ announce: () => { order.push('announce'); }, stop: () => { order.push('stop'); },
      drain: () => new Promise<void>(done => resolve = done), clearHistory: async () => { order.push('history'); },
      clearVault: () => { order.push('vault'); }, clearCache: async () => { order.push('cache'); } });
    expect(order).toEqual(['announce', 'stop']); resolve(); expect(await result).toEqual([]);
    expect(order).toEqual(['announce', 'stop', 'history', 'vault', 'cache']);
  });
  it('reports partial deletion instead of success and still tries every remaining category', async () => {
    const vault = vi.fn(); const cache = vi.fn(async () => { throw new Error('cache blocked'); });
    expect(await eraseApplicationData({ announce() { throw new Error('storage blocked'); }, stop() {}, drain: async () => {},
      clearHistory: async () => { throw new Error('IDB blocked'); }, clearVault: vault, clearCache: cache }))
      .toEqual(['координация вкладок', 'история и вложения', 'офлайн-кэш']);
    expect(vault).toHaveBeenCalledOnce(); expect(cache).toHaveBeenCalledOnce();
  });
  it('clears core state and reports its failure without skipping the vault or cache', async () => {
    const vault = vi.fn(), cache = vi.fn(async () => {}), clear = vi.fn(async () => { throw new Error('disk blocked'); });
    expect(await eraseApplicationData({ announce() {}, stop() {}, drain: async () => {}, clearHistory: async () => {},
      clearCoreState: clear, clearVault: vault, clearCache: cache })).toEqual(['состояние ядра']);
    expect(clear).toHaveBeenCalledOnce(); expect(vault).toHaveBeenCalledOnce(); expect(cache).toHaveBeenCalledOnce();
  });
});
