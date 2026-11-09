import { afterEach, describe, expect, it, vi } from 'vitest';
import { VoiceRecorder, audioExtension, recordingFormat, MAX_VOICE_BYTES, MAX_VOICE_SECONDS, type RecordingPort } from './voice-recorder';
function fixture() {
  const stop = vi.fn(); const track = { stop, onended: null as (()=>void)|null }; const stream = { getTracks: () => [track] } as unknown as MediaStream;
  let recordingState: RecordingState = 'inactive';
  const recorder = { get state() { return recordingState; }, mimeType: 'audio/mp4', start: vi.fn(() => { recordingState = 'recording'; }),
    stop: vi.fn(() => { recordingState = 'inactive'; }), ondataavailable: null, onstop: null, onerror: null } as unknown as MediaRecorder;
  const port: RecordingPort = { getStream: vi.fn(async () => stream), supported: mime => mime === 'audio/mp4', recorder: () => recorder };
  const changed = vi.fn(); const clip = vi.fn(async()=>true); const voice = new VoiceRecorder(port, changed, clip);
  const data = (blob = new Blob(['audio'])) => recorder.ondataavailable?.({ data: blob } as BlobEvent);
  const finish = () => recorder.onstop?.(new Event('stop'));
  return { voice, port, stream, recorder, changed, clip, stop, track, data, finish };
}
afterEach(() => vi.useRealTimers());
describe('voice recording lifecycle', () => {
  it('prefers broadly playable MP4, falls back to supported formats, and rejects unknown extensions', () => {
    expect(recordingFormat(() => true)).toBe('audio/mp4');
    expect(recordingFormat(m => m.startsWith('audio/webm'))).toBe('audio/webm;codecs=opus');
    expect(recordingFormat(() => false)).toBe('');
    expect(audioExtension('audio/webm;codecs=opus')).toBe('webm');
    expect(audioExtension('text/html')).toBe('');
  });
  it('waits for the final chunk, releases the microphone, and sends only after preview confirmation', async () => {
    const f = fixture(); await f.voice.start(); f.data(); f.voice.stopForReview();
    expect(f.voice.state.phase).toBe('stopping'); expect(f.clip).not.toHaveBeenCalled();
    f.data(new Blob(['last'])); f.finish(); expect(f.voice.state.phase).toBe('review'); expect(f.clip).not.toHaveBeenCalled();
    expect(await f.voice.state.blob!.text()).toBe('audiolast'); expect(f.stop).toHaveBeenCalled();
    await f.voice.sendPreview(); expect(await (f.clip.mock.calls[0] as unknown as [Blob])[0].text()).toBe('audiolast');
    expect((f.clip.mock.calls[0] as unknown as [Blob,string])[1]).toBe('m4a'); expect(f.voice.state.phase).toBe('idle'); f.voice.dispose();
  });
  it('cancels without sending and cleans tracks/timers on disposal', async () => {
    const f = fixture(); await f.voice.start(); f.data(); f.voice.cancel(); f.finish();
    expect(f.clip).not.toHaveBeenCalled(); expect(f.stop).toHaveBeenCalledOnce();
    await f.voice.start(); f.voice.dispose(); expect(f.stop).toHaveBeenCalledTimes(2);
  });
  it('releases a late permission response after cancellation, without starting a recorder', async () => {
    const f = fixture(); let resolve!: (stream: MediaStream) => void;
    f.port.getStream = () => new Promise(done => resolve = done);
    const pending = f.voice.start(); f.voice.cancel(); resolve(f.stream); await pending;
    expect(f.recorder.start).not.toHaveBeenCalled(); expect(f.stop).toHaveBeenCalledOnce(); expect(f.clip).not.toHaveBeenCalled();
  });
  it('reports denial, empty recordings and oversized data without sending', async () => {
    const f = fixture(); f.port.getStream = async () => { throw new Error('denied'); };
    await f.voice.start(); expect(f.voice.state.notice?.message).toContain('Микрофон'); f.voice.dispose();
    const empty = fixture(); await empty.voice.start(); empty.voice.stopForReview(); empty.finish();
    expect(empty.voice.state.notice?.message).toContain('пустая'); expect(empty.clip).not.toHaveBeenCalled(); empty.voice.dispose();
    const big = fixture(); await big.voice.start(); big.data(new Blob([new Uint8Array(MAX_VOICE_BYTES + 1)])); big.finish();
    expect(big.clip).not.toHaveBeenCalled(); expect(big.stop).toHaveBeenCalledOnce(); expect(big.voice.state.notice?.message).toContain('большая'); big.voice.dispose();
  });
  it('bounds recording time and opens review, never automatically sends at the limit', async () => {
    vi.useFakeTimers(); const f = fixture(); await f.voice.start(); f.data();
    vi.advanceTimersByTime(MAX_VOICE_SECONDS * 1000); expect(f.voice.state.phase).toBe('stopping');
    f.finish(); expect(f.clip).not.toHaveBeenCalled(); expect(f.voice.state.phase).toBe('review'); expect(vi.getTimerCount()).toBe(0); f.voice.dispose();
  });
  it('keeps the preview after persistence failure and prevents duplicate confirmation',async()=> {
    const f=fixture(); await f.voice.start(); f.data(); f.voice.stopForReview(); f.finish();
    const blob=f.voice.state.blob; let resolve!:(value:boolean)=>void;
    f.clip.mockImplementation(()=>new Promise(done=>resolve=done));
    const pending=f.voice.sendPreview(); expect(await f.voice.sendPreview()).toBe(false); expect(f.clip).toHaveBeenCalledOnce();
    resolve(false); expect(await pending).toBe(false); expect(f.voice.state.blob).toBe(blob); expect(f.voice.state.phase).toBe('review'); expect(f.voice.state.notice?.durationMs).toBe(0);
    f.clip.mockResolvedValue(true); expect(await f.voice.sendPreview()).toBe(true); expect(f.voice.state.blob).toBeNull(); f.voice.dispose();
  });
  it('does not revive a preview after disposal during a pending queue write',async()=> {
    const f=fixture(); await f.voice.start(); f.data(); f.voice.stopForReview(); f.finish();
    let resolve!:(value:boolean)=>void; f.clip.mockImplementation(()=>new Promise(done=>resolve=done));
    const pending=f.voice.sendPreview(); f.voice.dispose(); const count=f.changed.mock.calls.length;
    resolve(false); await pending; expect(f.changed.mock.calls.length).toBe(count); expect(f.voice.state.blob).toBeNull();
  });
  it('reports track loss and unexpected stopping as persistent failures',async()=> {
    const f=fixture(); await f.voice.start(); f.data(); f.track.onended?.();
    expect(f.voice.state.phase).toBe('idle'); expect(f.voice.state.notice?.durationMs).toBe(0); expect(f.clip).not.toHaveBeenCalled(); f.voice.dispose();
    const unexpected=fixture(); await unexpected.voice.start(); unexpected.data(); unexpected.finish();
    expect(unexpected.voice.state.notice?.message).toContain('прервалась'); expect(unexpected.clip).not.toHaveBeenCalled(); unexpected.voice.dispose();
  });
  it('cleans up an optional real level meter and a stalled recorder stop',async()=> {
    vi.useFakeTimers(); const f=fixture(), close=vi.fn(); f.port.meter=()=>({sample:()=>0.4,close});
    await f.voice.start(); vi.advanceTimersByTime(250); expect(f.voice.state.level).toBe(0.4);
    f.data(); f.voice.stopForReview(); expect(close).toHaveBeenCalledOnce(); vi.advanceTimersByTime(10000);
    expect(f.voice.state.phase).toBe('idle'); expect(f.voice.state.notice?.durationMs).toBe(0); f.finish(); expect(f.clip).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0); f.voice.dispose();
  });
});
