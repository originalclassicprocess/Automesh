import { afterEach, expect, it, vi } from 'vitest';
import { RecoveryController } from './recovery';

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

it('coalesces focus/visibility/network bursts and keeps independent lanes running', async () => {
  vi.useFakeTimers();
  const recovery = new RecoveryController();
  let release!: () => void;
  const signaling = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
  const queue = vi.fn(), device = vi.fn(() => { throw Error('device_offline'); });
  const tasks = Array.from({length: 8}, () => recovery.request('signaling', signaling));
  tasks.push(recovery.request('queue', queue), recovery.request('devices', device));
  await vi.advanceTimersByTimeAsync(200);
  expect(signaling).toHaveBeenCalledTimes(1);
  expect(queue).toHaveBeenCalledTimes(1);
  expect(device).toHaveBeenCalledTimes(1);
  release(); await Promise.all(tasks);
  recovery.reset();
});

it('retains one trailing network hint when a check is already running, even after failure', async () => {
  vi.useFakeTimers(); const recovery = new RecoveryController();
  let reject!: (error: Error) => void;
  const old = vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
  const latest = vi.fn();
  const done = recovery.request('signaling', old);
  await vi.advanceTimersByTimeAsync(200);
  for (let i = 0; i < 10; i++) void recovery.request('signaling', latest);
  reject(Error('network_changed')); await vi.advanceTimersByTimeAsync(200); await done;
  expect(old).toHaveBeenCalledTimes(1); expect(latest).toHaveBeenCalledTimes(1);
  recovery.reset();
});

it('does not let old account work delay or finish a new account recovery', async () => {
  vi.useFakeTimers(); const recovery = new RecoveryController();
  let release!: () => void;
  const old = recovery.request('signaling', () => new Promise<void>(resolve => { release = resolve; }));
  await vi.advanceTimersByTimeAsync(200);
  const stale = vi.fn(); void recovery.request('signaling', stale);
  recovery.reset(); await old;
  const fresh = vi.fn(), done = recovery.request('signaling', fresh);
  release(); await vi.advanceTimersByTimeAsync(200); await done;
  expect(stale).not.toHaveBeenCalled(); expect(fresh).toHaveBeenCalledTimes(1);
  const canceled = vi.fn(), canceledDone = recovery.request('queue', canceled);
  recovery.reset(); await canceledDone; await vi.advanceTimersByTimeAsync(200);
  expect(canceled).not.toHaveBeenCalled();
});
