import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { preparePortableWeights } from './portable-weights';

const url = 'https://example.test/model_quantized.onnx';
const weights = 'example model data';
const metadata = { size: weights.length, sha256: createHash('sha256').update(weights).digest('hex') };

function modelCache() {
  const entries = new Map<string, Response>();
  return {
    async match(key: string) { return entries.get(key)?.clone(); },
    async put(key: string, response: Response) {
      const bytes = await response.arrayBuffer();
      entries.set(key, new Response(bytes, { headers: response.headers }));
    },
    async delete(key: string) { return entries.delete(key); },
  };
}

describe('portable model weights', () => {
  it('preserves complete parts when the connection drops during the next part and resumes from there', async () => {
    const cache = modelCache();
    let drop = true;
    const request = vi.fn<typeof fetch>(async (_input, init) => {
      const range = new Headers(init?.headers).get('Range')!;
      const [start, end] = range.slice(6).split('-').map(Number);
      if (drop && start === 8) throw new TypeError('lost connection');
      return new Response(weights.slice(start, end + 1), { status: 206, headers: { 'Content-Range': `bytes ${start}-${end}/${weights.length}` } });
    });
    const prepare = () => preparePortableWeights(cache, url, metadata, request, () => {}, undefined, 8);
    await expect(prepare()).rejects.toThrow('agent_model_download_interrupted');
    expect(await cache.match(url)).toBeUndefined();
    expect(await (await cache.match(url + '?automesh-part=0'))?.text()).toBe(weights.slice(0, 8));
    request.mockClear();
    drop = false;
    await prepare();
    expect(request.mock.calls.map(([, init]) => new Headers(init?.headers).get('Range'))).toEqual(['bytes=8-15', 'bytes=16-17']);
    expect(await (await cache.match(url))?.text()).toBe(weights);
    expect(await cache.match(url + '?automesh-part=0')).toBeUndefined();
  });

  it('imports matching weights without calling the network and refuses same-size corrupt files', async () => {
    const cache = modelCache(), request = vi.fn<typeof fetch>();
    const prepare = (text: string) => preparePortableWeights(cache, url, metadata, request, () => {}, new File([text], 'model.onnx'));
    await expect(prepare('x'.repeat(weights.length))).rejects.toThrow('agent_model_weights_invalid');
    expect(await cache.match(url)).toBeUndefined();
    await prepare(weights);
    expect(await (await cache.match(url))?.text()).toBe(weights);
    await expect(prepare('x'.repeat(weights.length))).rejects.toThrow('agent_model_weights_invalid');
    expect(await (await cache.match(url))?.text()).toBe(weights);
    expect(request).not.toHaveBeenCalled();
  });

  it('accepts a complete checked file from a server that ignores the first Range request', async () => {
    const cache = modelCache(), request = vi.fn<typeof fetch>(async () => new Response(weights));
    await preparePortableWeights(cache, url, metadata, request, () => {}, undefined, 8);
    expect(await (await cache.match(url))?.text()).toBe(weights);
    expect(request).toHaveBeenCalledOnce();
  });
});
