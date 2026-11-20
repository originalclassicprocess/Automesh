// Public, quantized ONNX model data pinned to reviewed Hub revisions.
// The sizes are approximate downloads (weights + tokenizer/config), not RAM.
export const PORTABLE_MODELS = {
  'smollm2-135m': { title: 'SmolLM2 135M', repo: 'onnx-community/SmolLM2-135M-Instruct-ONNX', revision: 'b8a5c0f183b78c55955a5364f610c36668b5e681', downloadMB: 145, maxTokens: 64 },
  'qwen2.5-0.5b': { title: 'Qwen2.5 0.5B', repo: 'onnx-community/Qwen2.5-0.5B-Instruct', revision: '516c8d04add8a80c5228f32102b57953b8d421a9', downloadMB: 525, maxTokens: 96 },
} as const;
export type PortableModelId = keyof typeof PORTABLE_MODELS;
export type PortableDevice = 'wasm' | 'webgpu';
export const DEFAULT_PORTABLE_MODEL: PortableModelId = 'smollm2-135m';
export const PORTABLE_CACHE_PREFIX = 'mesh-autonomy-model-v1-';
export function portableModelId(value: unknown): PortableModelId {
  return typeof value === 'string' && Object.hasOwn(PORTABLE_MODELS, value) ? value as PortableModelId : DEFAULT_PORTABLE_MODEL;
}
export function portableCacheName(id: PortableModelId): string {
  return `${PORTABLE_CACHE_PREFIX}${id}-${PORTABLE_MODELS[id].revision}`;
}
export function portableMarker(id: PortableModelId, origin: string): string {
  return new URL(`/__automesh-model-ready/${id}/${PORTABLE_MODELS[id].revision}`, origin).href;
}
export function portableRequiredFiles(id: PortableModelId): string[] {
  const model = PORTABLE_MODELS[id];
  const base = `https://huggingface.co/${model.repo}/resolve/${model.revision}/`;
  return ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx'].map(file => base + file);
}
export async function portableCacheComplete(cache: Pick<Cache, 'match'>, id: PortableModelId, origin: string, marker = true): Promise<boolean> {
  const urls = [...portableRequiredFiles(id), ...(marker ? [portableMarker(id, origin)] : [])];
  return (await Promise.all(urls.map(url => cache.match(url)))).every(Boolean);
}
export function modelAssetUrlAllowed(id: PortableModelId, url: URL): boolean {
  const model = PORTABLE_MODELS[id];
  return url.origin === 'https://huggingface.co' && url.pathname.startsWith(`/${model.repo}/resolve/${model.revision}/`);
}
export type PortableProgress = { file: string; loaded: number; total: number };
export type PortableRequest = { id: number; model: PortableModelId; device: PortableDevice; action: 'prepare' | 'generate'; system?: string; prompt?: string };
export type PortableResponse = { id: number; type: 'progress'; progress: PortableProgress } | { id: number; type: 'result'; text: string } | { id: number; type: 'error'; code: string };
