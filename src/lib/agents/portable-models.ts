// Public, quantized ONNX model data pinned to reviewed Hub revisions.
// The sizes are approximate downloads (weights + tokenizer/config), not RAM.
export const PORTABLE_MODELS = {
  'smollm2-135m': { title: 'SmolLM2 135M', repo: 'onnx-community/SmolLM2-135M-Instruct-ONNX', revision: 'b8a5c0f183b78c55955a5364f610c36668b5e681', downloadMB: 145, maxTokens: 64 },
  'qwen2.5-0.5b': { title: 'Qwen2.5 0.5B', repo: 'onnx-community/Qwen2.5-0.5B-Instruct', revision: '516c8d04add8a80c5228f32102b57953b8d421a9', downloadMB: 525, maxTokens: 96 },
} as const;
export type PortableModelId = keyof typeof PORTABLE_MODELS;
export type PortableDevice = 'wasm' | 'webgpu';
export const PORTABLE_WEIGHTS_FILE = 'onnx/model_quantized.onnx';
export const PORTABLE_WEIGHTS: Record<PortableModelId, { size: number; sha256: string }> = {
  'smollm2-135m': { size: 135658354, sha256: '0fab87142e3eb1fcacb881f8282e7473e62ad66920c347b81f088da6fda2da37' },
  'qwen2.5-0.5b': { size: 512096557, sha256: '41834041ab1b29eff9fc592f1a29a1844133aea35832ea9fa91682be13016100' },
};
export const DEFAULT_PORTABLE_MODEL: PortableModelId = 'qwen2.5-0.5b';
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
function portableAssetBase(id: PortableModelId): string {
  const model = PORTABLE_MODELS[id];
  return `https://huggingface.co/${model.repo}/resolve/${model.revision}/`;
}
export function portableRequiredFiles(id: PortableModelId): string[] {
  const base = portableAssetBase(id);
  return ['config.json', 'tokenizer.json', 'tokenizer_config.json', PORTABLE_WEIGHTS_FILE].map(file => base + file);
}
export function portableWeightsUrl(id: PortableModelId): string {
  return portableAssetBase(id) + PORTABLE_WEIGHTS_FILE;
}
export async function portableCacheComplete(cache: Pick<Cache, 'match'>, id: PortableModelId, origin: string, marker = true): Promise<boolean> {
  const urls = [...portableRequiredFiles(id), ...(marker ? [portableMarker(id, origin)] : [])];
  return (await Promise.all(urls.map(url => cache.match(url)))).every(Boolean);
}
export function modelAssetUrlAllowed(id: PortableModelId, url: URL): boolean {
  const model = PORTABLE_MODELS[id];
  return url.origin === 'https://huggingface.co' && url.pathname.startsWith(`/${model.repo}/resolve/${model.revision}/`);
}
export type PortableProgress = { file: string; loaded: number; total: number; importing?: boolean };
export type PortableRequest = {
  id: number; model: PortableModelId; device: PortableDevice; action: 'prepare' | 'generate';
  system?: string; prompt?: string; weights?: File; offline?: boolean;
};
export type PortableResponse = { id: number; type: 'progress'; progress: PortableProgress } | { id: number; type: 'result'; text: string } | { id: number; type: 'error'; code: string };
