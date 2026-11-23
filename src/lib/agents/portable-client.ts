import { portableCacheName, portableCacheComplete, portableWeightsUrl, type PortableModelId, type PortableDevice, type PortableProgress, type PortableRequest, type PortableResponse } from './portable-models';
import type { AgentTurn } from './local-chat';
import { get, readonly, writable } from 'svelte/store';
import type { LocalModelRuntime } from './model-storage';

let worker: Worker | undefined;
let workerDevice: PortableDevice | undefined;
let pending: { reject: (error: Error) => void } | undefined;
let sequence = 0;
const runtime = writable<LocalModelRuntime | null>(null);
export const portableModelRuntime = readonly(runtime);
export function portableSupported(): boolean { return typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined' && typeof caches !== 'undefined' && typeof location !== 'undefined'; }

export async function portableDownloaded(model: PortableModelId): Promise<boolean> {
  if (!portableSupported()) return false;
  try { return (await caches.has(portableCacheName(model))) && await portableCacheComplete(await caches.open(portableCacheName(model)), model, location.origin); }
  catch { return false; }
}

export async function portableWeightsSaved(model: PortableModelId): Promise<boolean> {
  if (!portableSupported()) return false;
  try {
    if (!await caches.has(portableCacheName(model))) return false;
    const response = await (await caches.open(portableCacheName(model))).match(portableWeightsUrl(model));
    void response?.body?.cancel().catch(() => {});
    return !!response;
  } catch { return false; }
}

export function stopPortableModel(): void {
  const active = pending; pending = undefined;
  worker?.terminate(); worker = undefined; workerDevice = undefined;
  runtime.set(null);
  active?.reject(new Error('agent_model_cancelled'));
}

export async function deletePortableModel(model: PortableModelId): Promise<void> {
  if (get(runtime)?.id === model) stopPortableModel();
  if (portableSupported()) await caches.delete(portableCacheName(model));
}

function requestModel(value: Omit<PortableRequest, 'id'>, signal: AbortSignal, progress?: (value: PortableProgress) => void): Promise<string> {
  signal.throwIfAborted();
  if (!portableSupported()) return Promise.reject(new Error('agent_browser_unavailable'));
  if (pending) return Promise.reject(new Error('agent_model_busy'));
  // ONNX Runtime initializes its WASM binary once per worker.
  if (worker && workerDevice !== value.device) stopPortableModel();
  const active = worker ??= new Worker(new URL('./portable-worker.ts', import.meta.url), { type: 'module' });
  workerDevice = value.device;
  if (get(runtime)?.id !== value.model) runtime.set({ id: value.model, device: value.device, phase: 'loading' });
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const finish = (error?: Error, result = '') => {
      signal.removeEventListener('abort', cancel); active.onmessage = null; active.onerror = null; pending = undefined;
      if (error) reject(error); else resolve(result);
    };
    const cancel = () => stopPortableModel();
    pending = { reject: error => finish(error) };
    signal.addEventListener('abort', cancel, { once: true });
    active.onmessage = (event: MessageEvent<PortableResponse>) => {
      const message = event.data;
      if (message.id !== id) return;
      if (message.type === 'progress') { progress?.(message.progress); return; }
      if (message.type === 'error') { finish(new Error(message.code)); stopPortableModel(); }
      else {
        runtime.set({ id: value.model, device: value.device, phase: 'loaded' });
        finish(undefined, message.text);
      }
    };
    active.onerror = () => { finish(new Error('agent_model_load_failed')); stopPortableModel(); };
    try { active.postMessage({ ...value, id }); } catch { finish(new Error('agent_model_load_failed')); stopPortableModel(); }
  });
}

export async function preparePortableModel(model: PortableModelId, device: PortableDevice, signal: AbortSignal,
  progress?: (value: PortableProgress) => void, options: { weights?: File; offline?: boolean } = {}): Promise<void> {
  await requestModel({ action: 'prepare', model, device, ...options }, signal, progress);
}
export async function generatePortableReply(model: PortableModelId, device: PortableDevice, system: string, prompt: string, signal: AbortSignal, history?: AgentTurn[]): Promise<string> {
  if (!await portableDownloaded(model)) throw new Error('agent_model_not_downloaded');
  return requestModel({ action: 'generate', model, device, system, prompt, ...(history?.length ? { history } : {}) }, signal);
}
