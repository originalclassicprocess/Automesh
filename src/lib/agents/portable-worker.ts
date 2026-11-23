/// <reference lib="webworker" />
import { env, pipeline, type TextGenerationPipeline } from '@huggingface/transformers';
import { portableModelEnvironment } from './portable-policy';
import { preparePortableWeights } from './portable-weights';
import cpuWasm from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import cpuFactory from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url';
import gpuWasm from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import gpuFactory from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import { PORTABLE_MODELS, PORTABLE_WEIGHTS, PORTABLE_WEIGHTS_FILE, portableCacheName, portableMarker,
  portableCacheComplete, portableWeightsUrl, type PortableRequest, type PortableResponse } from './portable-models';

declare const self: DedicatedWorkerGlobalScope;
const send = (message: PortableResponse) => self.postMessage(message);
let current: { key: string; generator: TextGenerationPipeline } | undefined;
let busy = false;

async function requireWebGpu(): Promise<void> {
  const { gpu } = self.navigator as WorkerNavigator & {
    gpu?: { requestAdapter(options?: { powerPreference: 'high-performance' }): Promise<unknown> };
  };
  const adapter = await gpu?.requestAdapter({ powerPreference: 'high-performance' }).catch(() => null);
  if (!adapter) throw new Error('agent_webgpu_unavailable');
}

async function load(request: PortableRequest): Promise<TextGenerationPipeline> {
  const preset = PORTABLE_MODELS[request.model], key = `${request.model}:${request.device}`;
  const prepare = request.action === 'prepare', download = prepare && !request.offline;
  const cache = await caches.open(portableCacheName(request.model));
  const marker = portableMarker(request.model, self.location.origin);
  const complete = await portableCacheComplete(cache, request.model, self.location.origin);
  if (!prepare && !complete) throw new Error('agent_model_not_downloaded');
  const policy = portableModelEnvironment(request.model, download);
  if (prepare && (request.weights || download && !complete)) {
    const weights = PORTABLE_WEIGHTS[request.model];
    const url = portableWeightsUrl(request.model);
    const copy = () => preparePortableWeights(cache, url, weights, policy.fetch, loaded => {
      send({ id: request.id, type: 'progress', progress: { file: PORTABLE_WEIGHTS_FILE, loaded, total: weights.size, importing: !!request.weights } });
    }, request.weights);
    if (self.navigator.locks) await self.navigator.locks.request(portableCacheName(request.model), copy);
    else await copy();
  }
  if (prepare && !download && !await portableCacheComplete(cache, request.model, self.location.origin, false)) {
    const weights = await cache.match(portableWeightsUrl(request.model));
    void weights?.body?.cancel().catch(() => {});
    throw new Error(weights ? 'agent_model_configuration_needed' : 'agent_model_not_downloaded');
  }
  Object.assign(env, policy);
  if (current?.key === key && complete) return current.generator;
  if (current) { await current.generator.dispose(); current = undefined; }
  if (request.device === 'webgpu') await requireWebGpu();
  env.useBrowserCache = false;
  env.useFSCache = false;
  env.useCustomCache = true;
  env.customCache = cache;
  // All executable WASM/factory assets are bundled with the app, never from CDN.
  env.useWasmCache = false;
  env.backends.onnx.wasm!.numThreads = 1;
  env.backends.onnx.wasm!.proxy = false;
  env.backends.onnx.wasm!.wasmPaths = {
    wasm: new URL(request.device === 'webgpu' ? gpuWasm : cpuWasm, self.location.href).href,
    mjs: new URL(request.device === 'webgpu' ? gpuFactory : cpuFactory, self.location.href).href,
  };
  const generator = await pipeline('text-generation', preset.repo, {
    revision: preset.revision, dtype: 'q8', device: request.device, local_files_only: !download,
    progress_callback: progress => {
      if (progress.status === 'progress') send({ id: request.id, type: 'progress', progress: { file: progress.file, loaded: progress.loaded, total: progress.total } });
    },
  });
  try {
    if (prepare) {
      // The library may tolerate a quota failure; check actual weights were saved.
      if (!await portableCacheComplete(cache, request.model, self.location.origin, false)) throw new Error('agent_model_cache_failed');
      await cache.put(marker, new Response('ready', { headers: { 'Content-Type': 'text/plain' } }));
    }
    current = { key, generator };
    return generator;
  } catch (error) { await generator.dispose(); throw error; }
}

self.onmessage = async (event: MessageEvent<PortableRequest>) => {
  const request = event.data;
  if (busy) { send({ id: request.id, type: 'error', code: 'agent_model_busy' }); return; }
  busy = true;
  try {
    const generator = await load(request);
    if (request.action === 'prepare') { send({ id: request.id, type: 'result', text: '' }); return; }
    const result = await generator([
      { role: 'system', content: request.system?.slice(0, 1400) ?? '' },
      ...(request.history ?? []),
      { role: 'user', content: request.prompt?.slice(0, 4000) ?? '' },
    ], { max_new_tokens: PORTABLE_MODELS[request.model].maxTokens, do_sample: false, repetition_penalty: 1.1, no_repeat_ngram_size: 4 });
    const messages = result[0]?.generated_text;
    const text = Array.isArray(messages) ? messages.at(-1)?.content : messages;
    if (typeof text !== 'string' || !text.trim()) throw new Error('agent_response_invalid');
    send({ id: request.id, type: 'result', text: text.trim().slice(0, 1200) });
  } catch (error) {
    if (import.meta.env.DEV) console.warn('Local model error:', error);
    const code = error instanceof Error && /^agent_[a-z_]+$/.test(error.message) ? error.message
      : request.device === 'webgpu' ? 'agent_webgpu_failed' : 'agent_model_load_failed';
    send({ id: request.id, type: 'error', code });
  } finally { busy = false; }
};
