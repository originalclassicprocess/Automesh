import { listFileModels, type FileModel } from './file-models';
import { PORTABLE_MODELS, portableCacheName, portableMarker, type PortableDevice, type PortableModelId } from './portable-models';
import { cachedResponseBytes } from '$lib/application/app-cache';

export type LocalModelRuntime = { id: string; device: PortableDevice; phase: 'loading' | 'loaded' };
export type StoredAgentModel = (FileModel & { kind: 'gguf' }) |
  { kind: 'onnx'; id: PortableModelId; name: string; bytes: number | null };

export async function listCachedOnnxModels(): Promise<Extract<StoredAgentModel, { kind: 'onnx' }>[]> {
  if (typeof caches === 'undefined') return [];
  const names = new Set(await caches.keys());
  const models = await Promise.all((Object.keys(PORTABLE_MODELS) as PortableModelId[]).map(async id => {
    const name = portableCacheName(id);
    if (!names.has(name)) return null;
    const cache = await caches.open(name);
    const marker = portableMarker(id, location.origin);
    const requests = await cache.keys();
    if (!requests.some(request => request.url !== marker)) return null;
    let bytes: number | null = 0;
    for (const request of requests) {
      const response = await cache.match(request);
      if (!response || response.type === 'opaque') { bytes = null; break; }
      bytes += await cachedResponseBytes(response);
    }
    return { kind: 'onnx' as const, id, name: PORTABLE_MODELS[id].title, bytes };
  }));
  return models.filter(model => model !== null);
}

export async function listStoredGgufModels(): Promise<Extract<StoredAgentModel, { kind: 'gguf' }>[]> {
  return (await listFileModels()).map(file => ({ ...file, kind: 'gguf' }));
}

export async function readStoredAgentModels() {
  const results = await Promise.allSettled([listStoredGgufModels(), listCachedOnnxModels()]);
  return {
    models: results.flatMap<StoredAgentModel>(result => result.status === 'fulfilled' ? result.value : []),
    incomplete: results.some(result => result.status === 'rejected'),
  };
}
