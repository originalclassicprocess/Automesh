export const APP_CACHE_PREFIX = 'mesh-autonomy-shell-';

export function isOptionalAiAsset(path: string, base = ''): boolean {
  const prefix = `${base}/_app/immutable/`;
  if (!path.startsWith(prefix)) return false;
  return /^(?:workers\/)?(?:assets\/)?(?:ort-wasm-simd-threaded(?:\.asyncify)?-[\w-]+\.(?:wasm|mjs)|wllama-[\w-]+\.wasm|(?:file-model|portable)-worker[.-][\w-]+\.js)$/.test(path.slice(prefix.length));
}

export type AppCacheUsage = { scripts: number; styles: number; shell: number; ai: number };

export async function cachedResponseBytes(response: Response): Promise<number> {
  const length = response.headers.get('Content-Length');
  const encoding = response.headers.get('Content-Encoding');
  if (length !== null && /^\d+$/.test(length) && Number.isSafeInteger(Number(length)) && (!encoding || encoding === 'identity')) {
    void response.body?.cancel().catch(() => {});
    return Number(length);
  }
  // Encoded responses expose decoded bodies. Count chunks without buffering the file.
  const reader = response.body?.getReader();
  if (!reader) return 0;
  let bytes = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) return bytes;
    bytes += part.value.byteLength;
  }
}

async function appCaches(storage: CacheStorage): Promise<Cache[]> {
  return Promise.all((await storage.keys()).filter(name => name.startsWith(APP_CACHE_PREFIX)).map(name => storage.open(name)));
}

export async function measureAppCache(storage: CacheStorage, base: string): Promise<AppCacheUsage> {
  const bytes: AppCacheUsage = { scripts: 0, styles: 0, shell: 0, ai: 0 };
  for (const cache of await appCaches(storage)) for (const request of await cache.keys()) {
    const response = await cache.match(request);
    if (!response) continue;
    const path = new URL(request.url).pathname;
    const group = isOptionalAiAsset(path, base) ? 'ai' : /\.(?:m?js|wasm)$/.test(path) ? 'scripts'
      : path.endsWith('.css') ? 'styles' : 'shell';
    bytes[group] += await cachedResponseBytes(response);
  }
  return bytes;
}

export async function clearAiRuntimeCache(storage: CacheStorage, base: string): Promise<void> {
  for (const cache of await appCaches(storage)) for (const request of await cache.keys()) {
    if (isOptionalAiAsset(new URL(request.url).pathname, base)) await cache.delete(request);
  }
}
