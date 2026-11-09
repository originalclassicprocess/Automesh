import type { VoiceMeter } from './voice-recorder';
export function createVoiceMeter(stream: MediaStream): VoiceMeter | undefined {
  const Audio = globalThis.AudioContext ?? (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Audio) return;
  const context = new Audio();
  try {
    const source = context.createMediaStreamSource(stream), analyser = context.createAnalyser(); analyser.fftSize = 256;
    source.connect(analyser); // Never connect microphone to speakers.
    void context.resume().catch(()=>{});
    const samples = new Uint8Array(analyser.fftSize);
    return { sample() { analyser.getByteTimeDomainData(samples); let sum = 0; for (const value of samples) sum += ((value-128)/128)**2; return Math.min(1,Math.sqrt(sum/samples.length)*4); },
      close() { source.disconnect(); analyser.disconnect(); void context.close().catch(()=>{}); } };
  } catch { void context.close().catch(()=>{}); return; }
}
