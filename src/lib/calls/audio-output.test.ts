import { describe, expect, it, vi } from 'vitest';
import { CallAudioOutput, outputUnavailable, systemOutput } from './audio-output';
const device = (deviceId = 'headset', label = 'Гарнитура') => ({deviceId, label, kind: 'audiooutput'});
describe('call audio output', () => {
  it('reports unsupported routing without pretending to toggle the speaker', async () => {
    const control = new CallAudioOutput({active: () => true});
    expect(control.supported()).toBe(false);
    expect(await control.select()).toEqual({ok:false, message:outputUnavailable});
  });
  it('invokes the native chooser in the gesture and switches only after consent', async () => {
    let resolve!: (value: ReturnType<typeof device>) => void;
    const choose = vi.fn(() => new Promise<ReturnType<typeof device>>(done => resolve = done));
    const sink = vi.fn(async () => {});
    const control = new CallAudioOutput({active: () => true, choose, sink});
    const request = control.select();
    expect(choose).toHaveBeenCalledOnce(); expect(sink).not.toHaveBeenCalled();
    expect(await control.select()).toBeNull();
    resolve(device()); expect(await request).toEqual({ok:true, label:'Гарнитура'});
    expect(sink).toHaveBeenCalledWith('headset');
  });
  it('enumerates only output devices, bounds names, rejects arbitrary IDs and permits system default', async () => {
    const sink = vi.fn(async () => {});
    const control = new CallAudioOutput({active: () => true, sink,
      enumerate: async () => [{...device('mic'), kind:'audioinput'}, device('default'), device(), device(), device('blank', ' '), device('long', 'a'.repeat(500))]});
    const list = await control.list();
    expect(list.map(value => value.deviceId)).toEqual(['headset', 'blank', 'long']);
    expect(list[1].label).toBe('Аудиовыход 2'); expect(list[2].label.length).toBe(160);
    expect((await control.select('unknown'))?.ok).toBe(false); expect(sink).not.toHaveBeenCalled();
    expect(await control.select('headset')).toEqual({ok:true,label:'Гарнитура'});
    expect(await control.select('')).toEqual({ok:true,label:systemOutput}); expect(sink).toHaveBeenLastCalledWith('');
  });
  it('does not route late permission results after termination or disposal', async () => {
    for (const dispose of [false, true]) {
      let active = true, resolve!: (value: ReturnType<typeof device>) => void;
      const sink = vi.fn(async () => {});
      const control = new CallAudioOutput({active: () => active, sink, choose: () => new Promise(done => resolve = done)});
      const request = control.select();
      if (dispose) control.dispose(); else active = false;
      resolve(device()); expect(await request).toBeNull(); expect(sink).not.toHaveBeenCalled();
    }
  });
  it('ignores late switch completion and never exposes device details in an error', async () => {
    let done!: () => void;
    const control = new CallAudioOutput({active: () => true, sink: () => new Promise(resolve => done = resolve)});
    const request = control.select(''); control.dispose(); done(); expect(await request).toBeNull();
    const broken = new CallAudioOutput({active: () => true, sink: async () => {throw new DOMException('private-device-id', 'NotAllowedError');}});
    const result = await broken.select(''); expect(result?.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('private-device-id');
  });
  it('handles missing devices, permission cancellation and enumeration failure without breaking the call', async () => {
    const control = new CallAudioOutput({active: () => true, sink: async () => {},
      choose: async () => {throw new DOMException('details', 'NotFoundError');}, enumerate: async () => {throw Error('details');}});
    expect(await control.list()).toEqual([]);
    expect(await control.select()).toEqual({ok:false,message:'Аудиоустройство недоступно. Выберите другой выход.'});
    expect(await control.select('')).toEqual({ok:true,label:systemOutput});
  });
  it('never treats a microphone selection as a speaker', async () => {
    const sink = vi.fn(async () => {});
    const control = new CallAudioOutput({active: () => true, sink, choose: async () => ({...device(), kind:'audioinput'})});
    expect((await control.select())?.ok).toBe(false); expect(sink).not.toHaveBeenCalled();
  });
});
