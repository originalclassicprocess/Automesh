// Best-effort local ring, never microphone access. Browser autoplay policy may
// suppress it; the incoming UI remains usable. Cleanup also cancels late resume.
export function startRingtone(factory = () => new AudioContext()): () => void {
  let context: AudioContext | undefined, timer: ReturnType<typeof setInterval> | undefined, stopped = false;
  const stop = () => { if (stopped) return; stopped = true; clearInterval(timer); if (context) void context.close().catch(() => {}); };
  try {
    context = factory();
    const beep = () => {
      if (stopped || !context || context.state !== 'running') return;
      const oscillator = context.createOscillator(), gain = context.createGain(), now = context.currentTime;
      oscillator.frequency.value = 660; gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(.035, now + .025);
      gain.gain.linearRampToValueAtTime(0, now + .3); oscillator.connect(gain); gain.connect(context.destination);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      oscillator.start(now); oscillator.stop(now + .35);
    };
    void context.resume().then(() => { if (stopped) return; beep(); timer = setInterval(beep, 2500); }).catch(stop);
  } catch { stop(); }
  return stop;
}
