import { afterEach, expect, it, vi } from 'vitest';
vi.mock('$app/environment', () => ({ version:'current-build' }));
import { offlineReadiness } from './offline-readiness';

class TestChannel {
  port1 = { onmessage: null as null | ((event: { data:unknown }) => void), close:vi.fn() };
  port2 = { close:vi.fn(), reply:(data:unknown) => this.port1.onmessage?.({ data }) };
}
function worker(complete: boolean, version: string) {
  vi.stubGlobal('MessageChannel', TestChannel);
  vi.stubGlobal('navigator', { serviceWorker:{ controller:{ postMessage:(_:unknown, ports:TestChannel['port2'][]) =>
    ports[0].reply({ type:'mesh-offline-status', complete, version }) } } });
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it('requires a complete cache matching the currently open client', async () => {
  worker(true, 'current-build'); expect(await offlineReadiness()).toBe('ready');
  worker(false, 'current-build'); expect(await offlineReadiness()).toBe('missing');
});
it('distinguishes a complete older copy from a missing copy', async () => {
  worker(true, 'old-build'); expect(await offlineReadiness()).toBe('outdated');
  worker(false, 'old-build'); expect(await offlineReadiness()).toBe('missing');
});
it('does not report readiness without a controller or on an unanswered probe', async () => {
  vi.stubGlobal('navigator', { serviceWorker:{} }); expect(await offlineReadiness()).toBe('missing');
  vi.useFakeTimers(); vi.stubGlobal('MessageChannel', TestChannel);
  vi.stubGlobal('navigator', { serviceWorker:{ controller:{ postMessage:vi.fn() } } });
  const pending = offlineReadiness(); await vi.advanceTimersByTimeAsync(2001);
  expect(await pending).toBe('unknown');
});
