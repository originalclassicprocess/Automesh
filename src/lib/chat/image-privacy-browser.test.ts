import { afterEach, describe, expect, it, vi } from 'vitest';
import { zlibSync } from 'fflate';
import { preparePrivateImage } from './image-privacy-browser';
function png(): Uint8Array {
  function chunk(kind: string, data: Uint8Array) {
    const out = new Uint8Array(data.length + 12), view = new DataView(out.buffer);
    view.setUint32(0, data.length); out.set(new TextEncoder().encode(kind), 4); out.set(data, 8);
    let crc = 0xffffffff; for (const byte of out.subarray(4, out.length - 4)) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    view.setUint32(out.length - 4, (crc ^ 0xffffffff) >>> 0); return out;
  }
  const header = new Uint8Array(13); new DataView(header.buffer).setUint32(0, 1); new DataView(header.buffer).setUint32(4, 1); header[8] = 8; header[9] = 6;
  return Uint8Array.from([...[137, 80, 78, 71, 13, 10, 26, 10], ...chunk('IHDR', header), ...chunk('IDAT', zlibSync(new Uint8Array([0, 1, 2, 3, 255]))), ...chunk('IEND', new Uint8Array())]);
}
function browser(fail = false, width = 1, height = 1) {
  const draw = vi.fn(), canvas = { width: 0, height: 0, getContext: () => ({ drawImage: draw }),
    toBlob: (callback: (blob: Blob | null) => void) => callback(new Blob([png().buffer as ArrayBuffer], { type: 'image/png' })) };
  vi.stubGlobal('document', { createElement: vi.fn(() => canvas) });
  vi.stubGlobal('Image', class {
    naturalWidth = width; naturalHeight = height; onload: (() => void) | null = null; onerror: (() => void) | null = null;
    set src(value: string) { if (value) queueMicrotask(() => fail ? this.onerror?.() : this.onload?.()); }
  });
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:local-test');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  return { canvas, draw, create, revoke };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('local image decoder fallback', () => {
  it('converts HEIC on a capable browser to PNG without a remote service or source mutation', async () => {
    const b = browser(), source = new TextEncoder().encode('local heic bytes'), original = source.slice();
    const result = await preparePrivateImage(source, '', 'photo.heic');
    expect(result.mime).toBe('image/png'); expect(result.name).toBe('photo.png'); expect(result.bytes).toEqual(png());
    expect(source).toEqual(original); expect(b.create).toHaveBeenCalledOnce(); expect(b.draw).toHaveBeenCalledOnce();
    expect(b.revoke).toHaveBeenCalledWith('blob:local-test'); expect(b.canvas.width).toBe(0);
  });
  it('does not silently send the original when a decoder is unavailable', async () => {
    const b = browser(true); await expect(preparePrivateImage(new Uint8Array([1]), 'image/avif', 'a.avif')).rejects.toThrow('очистить');
    expect(b.draw).not.toHaveBeenCalled(); expect(b.revoke).toHaveBeenCalledOnce();
  });
  it('bounds canvas allocation and refuses active or animated fallback formats', async () => {
    const b = browser(false, 9000, 9000);
    await expect(preparePrivateImage(new Uint8Array([1]), 'image/heic', 'photo.heic')).rejects.toThrow('слишком большое');
    expect(b.draw).not.toHaveBeenCalled();
    await expect(preparePrivateImage(new TextEncoder().encode('<svg/>'), 'image/svg+xml', 'a.svg')).rejects.toThrow();
    const animated = new Uint8Array(16); animated.set(new TextEncoder().encode('avis'), 8);
    await expect(preparePrivateImage(animated, 'image/avif', 'a.avif')).rejects.toThrow();
    expect(b.create).toHaveBeenCalledOnce();
  });
});
