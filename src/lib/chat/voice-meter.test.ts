import { afterEach, expect, it, vi } from 'vitest';
import { createVoiceMeter } from './voice-meter';
afterEach(()=> { vi.unstubAllGlobals(); });
it('shows actual microphone energy without routing sound to speakers and closes the context',()=> {
  const disconnect=vi.fn(), connect=vi.fn(), close=vi.fn(async()=>{});
  let sample=128;
  const analyser={fftSize:0,getByteTimeDomainData:(array:Uint8Array)=>array.fill(sample),disconnect};
  const source={connect,disconnect};
  vi.stubGlobal('AudioContext',class { createMediaStreamSource(){return source;} createAnalyser(){return analyser;} resume(){return Promise.resolve();} close=close; });
  const meter=createVoiceMeter({} as MediaStream)!;
  expect(connect).toHaveBeenCalledWith(analyser); expect(meter.sample()).toBe(0); sample=160; expect(meter.sample()).toBe(1);
  meter.close(); expect(disconnect).toHaveBeenCalledTimes(2); expect(close).toHaveBeenCalledOnce();
});
it('treats unavailable level analysis as optional rather than failing recording',()=> {
  vi.stubGlobal('AudioContext',undefined); vi.stubGlobal('webkitAudioContext',undefined);
  expect(createVoiceMeter({} as MediaStream)).toBeUndefined();
});
