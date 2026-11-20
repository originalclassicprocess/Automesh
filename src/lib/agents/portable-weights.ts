import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '$lib/message/encoding';

type CachePort = Pick<Cache, 'match' | 'put' | 'delete'>;
type Weights = { size: number; sha256: string };
const PART_SIZE = 8 * 1024 * 1024;
const contentHeaders = (size: number) => ({ 'Content-Length': String(size), 'Content-Type': 'application/octet-stream' });

async function storeStream(cache: CachePort, key: string, body: ReadableStream<Uint8Array>, size: number,
  progress: (bytes: number) => void, expectedHash?: string): Promise<void> {
  const digest = expectedHash ? sha256.create() : undefined;
  let loaded = 0, reported = 0;
  const checked = body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, stream) {
      loaded += chunk.length;
      if (loaded > size) throw new Error('agent_model_weights_invalid');
      digest?.update(chunk);
      if (loaded - reported >= 256 * 1024) { reported = loaded; progress(loaded); }
      stream.enqueue(chunk);
    },
    flush() {
      if (loaded !== size || digest && bytesToHex(digest.digest()) !== expectedHash) throw new Error('agent_model_weights_invalid');
    },
  }));
  await cache.put(key, new Response(checked, { headers: contentHeaders(size) }));
  progress(size);
}

function joinParts(cache: CachePort, parts: readonly string[]): ReadableStream<Uint8Array> {
  let index = 0;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  return new ReadableStream({
    async pull(stream) {
      while (reader || index < parts.length) {
        if (!reader) {
          const part = await cache.match(parts[index++]);
          if (!part?.body) throw new Error('agent_model_download_interrupted');
          reader = part.body.getReader();
        }
        const next = await reader.read();
        if (!next.done) { stream.enqueue(next.value); return; }
        reader.releaseLock();
        reader = undefined;
      }
      stream.close();
    },
    async cancel(reason) {
      try { await reader?.cancel(reason); } finally { reader?.releaseLock(); }
    },
  });
}

export async function preparePortableWeights(cache: CachePort, url: string, metadata: Weights, request: typeof fetch,
  report: (loaded: number) => void, file?: File, partSize = PART_SIZE): Promise<void> {
  const { size, sha256: hash } = metadata;
  const parts = Array.from({ length: Math.ceil(size / partSize) }, (_, index) => `${url}?automesh-part=${index}`);
  const clearParts = () => Promise.all(parts.map(key => cache.delete(key)));
  if (file) {
    if (file.size !== size) throw new Error('agent_model_weights_invalid');
    try { await storeStream(cache, url, file.stream(), size, report, hash); }
    catch (error) {
      if (error instanceof DOMException && error.name === 'QuotaExceededError') throw new Error('agent_model_cache_failed');
      throw new Error('agent_model_weights_invalid', { cause: error });
    }
    await clearParts();
    return;
  }
  const complete = await cache.match(url);
  if (complete) {
    void complete.body?.cancel().catch(() => {});
    await clearParts();
    return;
  }
  for (const [index, key] of parts.entries()) {
    const start = index * partSize, end = Math.min(start + partSize, size) - 1;
    const length = end - start + 1;
    const cached = await cache.match(key);
    if (cached?.headers.get('Content-Length') === String(length)) {
      void cached.body?.cancel().catch(() => {});
      report(end + 1);
      continue;
    }
    const range = { Range: `bytes=${start}-${end}` };
    try {
      const response = await request(`${url}?download=true`, { headers: range, signal: AbortSignal.timeout(120_000) });
      if (response.status === 200 && start === 0 && response.body) {
        await storeStream(cache, url, response.body, size, report, hash);
        await clearParts();
        return;
      }
      const contentRange = response.headers.get('Content-Range');
      if (response.status !== 206 || !response.body || contentRange !== `bytes ${start}-${end}/${size}`) {
        await response.body?.cancel();
        throw new Error('agent_model_download_interrupted');
      }
      // CacheStorage rejects native 206 responses; each checked part is stored as a local 200.
      await storeStream(cache, key, response.body, length, bytes => report(start + bytes));
    } catch (error) {
      if (error instanceof DOMException && error.name === 'QuotaExceededError') throw new Error('agent_model_cache_failed');
      throw new Error('agent_model_download_interrupted', { cause: error });
    }
  }
  try {
    await storeStream(cache, url, joinParts(cache, parts), size, () => {}, hash);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'QuotaExceededError') throw new Error('agent_model_cache_failed');
    await clearParts();
    throw new Error('agent_model_download_interrupted', { cause: error });
  }
  await clearParts();
}
