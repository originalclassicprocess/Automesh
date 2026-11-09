import { afterEach, describe, expect, it, vi } from 'vitest';
import { startRingtone } from './ringtone';
afterEach(() => vi.useRealTimers());
describe('local ringtone cleanup', () => {
  it('cleans up a pending autoplay permission without starting a late timer', async () => {
    let resume!: () => void;
    const context = { resume: vi.fn(() => new Promise<void>(resolve => resume = resolve)), close: vi.fn(async () => {}), createOscillator: vi.fn() };
    const stop = startRingtone(() => context as unknown as AudioContext); stop(); resume(); await Promise.resolve();
    expect(context.close).toHaveBeenCalledOnce(); expect(context.createOscillator).not.toHaveBeenCalled();
  });
  it('treats unsupported or denied audio as optional, not as a call failure', async () => {
    expect(() => startRingtone(() => { throw new Error('unsupported'); })()).not.toThrow();
    const close = vi.fn(async () => {});
    startRingtone(() => ({ resume: () => Promise.reject(new Error('denied')), close }) as unknown as AudioContext);
    await new Promise(resolve => setTimeout(resolve, 0)); expect(close).toHaveBeenCalledOnce();
  });
});
