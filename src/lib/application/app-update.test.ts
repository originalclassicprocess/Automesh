import { describe, expect, it, vi } from 'vitest';
import { AppUpdater, type UpdatePort } from './app-update';

function fixture() {
  const port: UpdatePort<string> = { currentVersion: 'A', latestVersion: vi.fn(async () => 'B'),
    prepare: vi.fn(async version => ({ version, complete: true, reloadNeeded: true, target: 'worker-B' })),
    activate: vi.fn(async () => {}), reload: vi.fn() };
  return { port, updater: new AppUpdater(port, vi.fn()) };
}
describe('explicit application updates', () => {
  it('does not activate or reload during a check; applies after session preparation', async () => {
    const { port, updater } = fixture(); await updater.check();
    expect(updater.state.phase).toBe('available'); expect(port.activate).not.toHaveBeenCalled(); expect(port.reload).not.toHaveBeenCalled();
    const order: string[] = [];
    port.activate = vi.fn(async () => { order.push('activate'); }); port.reload = () => { order.push('reload'); };
    await updater.apply(async () => { order.push('save-and-lock'); return null; });
    expect(order).toEqual(['save-and-lock', 'activate', 'reload']);
  });
  it('reports a matching ready version without asking to reload', async () => {
    const { port, updater } = fixture(); port.latestVersion = async () => 'A';
    port.prepare = async () => ({ version: 'A', complete: true, reloadNeeded: false, target: 'worker-A' });
    await updater.check(); expect(updater.state.phase).toBe('current');
  });
  it('rejects incomplete or mismatched copies without removing or activating anything', async () => {
    for (const prepared of [{ version: 'B', complete: false }, { version: 'A', complete: true }]) {
      const { port, updater } = fixture(); port.prepare = async () => ({ ...prepared, reloadNeeded: true, target: 'worker' });
      await updater.check(); expect(updater.state.phase).toBe('error');
      await updater.apply(async () => null); expect(port.activate).not.toHaveBeenCalled(); expect(port.reload).not.toHaveBeenCalled();
    }
  });
  it('keeps the update available if transfers, drafts or saving block the reload', async () => {
    const { port, updater } = fixture(); await updater.check();
    await updater.apply(async () => 'Дождитесь сохранения');
    expect(updater.state.phase).toBe('available'); expect(port.reload).not.toHaveBeenCalled();
    await updater.apply(async () => null); expect(port.reload).toHaveBeenCalledOnce();
  });
  it('leaves the existing app running after network or activation errors', async () => {
    const { port, updater } = fixture(); port.latestVersion = async () => { throw new Error('offline'); };
    await updater.check(); expect(updater.state.phase).toBe('error'); expect(port.prepare).not.toHaveBeenCalled();
    port.latestVersion = async () => 'B'; await updater.check(); port.activate = async () => { throw new Error('timeout'); };
    await updater.apply(async () => null); expect(updater.state.phase).toBe('error'); expect(port.reload).not.toHaveBeenCalled();
  });
  it('does not apply after disposal or run concurrent checks', async () => {
    const { port, updater } = fixture(); let resolve!: (value: string) => void;
    port.latestVersion = vi.fn(() => new Promise<string>(done => { resolve = done; }));
    const check = updater.check(); await updater.check(); expect(port.latestVersion).toHaveBeenCalledOnce();
    updater.dispose(); resolve('B'); await check; expect(port.prepare).not.toHaveBeenCalled();
  });
});
