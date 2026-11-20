import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PORTABLE_MODEL, PORTABLE_MODELS, modelAssetUrlAllowed, portableCacheName, portableMarker, portableModelId, type PortableRequest, type PortableResponse } from './portable-models';
import { deletePortableModel, generatePortableReply, portableDownloaded, preparePortableModel, stopPortableModel } from './portable-client';

const origin = 'https://mesh.example';
const model = DEFAULT_PORTABLE_MODEL;
class MockWorker {
  static instances: MockWorker[] = [];
  onmessage: ((event: { data: PortableResponse }) => void) | null = null;
  onerror: (() => void) | null = null;
  postMessage = vi.fn<(value: PortableRequest) => void>();
  terminate = vi.fn();
  constructor() { MockWorker.instances.push(this); }
  reply(value: PortableResponse) { this.onmessage?.({ data: value }); }
}
function setup(ready: boolean) {
  MockWorker.instances = [];
  const storage = { has: vi.fn(async () => ready), open: vi.fn(async () => ({ match: vi.fn(async () => ready ? new Response('ready') : undefined) })), delete: vi.fn(async () => true) };
  vi.stubGlobal('Worker', MockWorker); vi.stubGlobal('caches', storage); vi.stubGlobal('location', { origin });
  return storage;
}
afterEach(() => { stopPortableModel(); vi.unstubAllGlobals(); });

describe('portable model lifecycle', () => {
  it('pins downloads to reviewed public model URLs, not arbitrary addresses', () => {
    const preset = PORTABLE_MODELS[model];
    expect(modelAssetUrlAllowed(model, new URL(`https://huggingface.co/${preset.repo}/resolve/${preset.revision}/config.json`))).toBe(true);
    expect(modelAssetUrlAllowed(model, new URL(`https://huggingface.co/${preset.repo}/resolve/main/config.json`))).toBe(false);
    expect(modelAssetUrlAllowed(model, new URL('https://other.example/model.onnx'))).toBe(false);
    expect(portableModelId('https://other.example/model.onnx')).toBe(model);
  });
  it('never launches inference or starts a download before an explicit preparation', async () => {
    setup(false);
    expect(await portableDownloaded(model)).toBe(false);
    await expect(generatePortableReply(model, 'wasm', 'system', 'chat', new AbortController().signal)).rejects.toThrow('agent_model_not_downloaded');
    expect(MockWorker.instances).toHaveLength(0);
  });
  it('prepares without exposing chat text, reports progress and reuses the worker', async () => {
    setup(true); const progress = vi.fn(), controller = new AbortController();
    const loading = preparePortableModel(model, 'wasm', controller.signal, progress);
    const worker = MockWorker.instances[0], request = worker.postMessage.mock.calls[0][0];
    expect(request).toEqual({ id: request.id, model, device: 'wasm', action: 'prepare' });
    worker.reply({ id: request.id, type: 'progress', progress: { file: 'weights', loaded: 5, total: 10 } });
    expect(progress).toHaveBeenCalledWith({ file: 'weights', loaded: 5, total: 10 });
    worker.reply({ id: request.id, type: 'result', text: '' }); await loading;
    const inference = generatePortableReply(model, 'wasm', 'system', 'chat', controller.signal);
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(2));
    const generation = worker.postMessage.mock.calls[1][0];
    expect(generation.action).toBe('generate');
    expect(MockWorker.instances).toHaveLength(1);
    worker.reply({ id: generation.id, type: 'result', text: 'reply' });
    expect(await inference).toBe('reply');
  });
  it('terminates inference on cancellation and deletes only the selected model cache', async () => {
    const storage = setup(true), controller = new AbortController();
    const loading = preparePortableModel(model, 'webgpu', controller.signal);
    const rejected = expect(loading).rejects.toThrow('agent_model_cancelled');
    controller.abort(); await rejected;
    expect(MockWorker.instances[0].terminate).toHaveBeenCalledOnce();
    await deletePortableModel(model);
    expect(storage.delete).toHaveBeenCalledWith(portableCacheName(model));
    expect(portableMarker(model, origin)).toContain(PORTABLE_MODELS[model].revision);
  });
});
