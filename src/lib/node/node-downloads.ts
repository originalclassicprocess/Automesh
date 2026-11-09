import { parsePackageProvenance } from '../application/package-provenance.js';

export type NodePlatform = 'windows' | 'linux';
export const nodeDownloads = {
  windows: { manifest: '/downloads/node-release.json', url: '/downloads/Automesh-Node-Setup.exe', label: 'Windows · x64' },
  linux: { manifest: '/downloads/node-linux-release.json', url: '/downloads/Automesh-Node-Linux-x64.tar.gz', label: 'Linux · x64' }
} as const;
export type NodeDownload = { version: string; url: string; bytes: number; sha256: string; signed: boolean;
  provenance?: NonNullable<ReturnType<typeof parsePackageProvenance>> };
export function parseNodeDownload(platform: NodePlatform, raw: unknown): NodeDownload {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid_download');
  const value = raw as Record<string, unknown>;
  if (value.url !== nodeDownloads[platform].url || typeof value.version !== 'string' ||
      !/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value.version) || !Number.isSafeInteger(value.bytes) ||
      (value.bytes as number) < 1024 * 1024 || (value.bytes as number) > 256 * 1024 * 1024 ||
      typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256) || typeof value.signed !== 'boolean' ||
      platform === 'linux' && value.platform !== 'linux-x64') throw new Error('invalid_download');
  const provenance = parsePackageProvenance(platform, value.provenance);
  return { version: value.version, url: value.url as string, bytes: value.bytes as number, sha256: value.sha256, signed: value.signed,
    ...(provenance ? { provenance } : {}) };
}
export async function fetchNodeDownload(platform: NodePlatform, signal: AbortSignal, request = fetch): Promise<NodeDownload> {
  signal.throwIfAborted();
  const response = await request(nodeDownloads[platform].manifest, { signal, cache: 'no-store', redirect: 'error', credentials: 'omit' });
  if (!response.ok || !response.body) throw new Error('download_unavailable');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length; if (size > 8192) throw new Error('invalid_download'); chunks.push(value);
    }
    signal.throwIfAborted();
    const bytes = new Uint8Array(size); let offset = 0;
    for (const part of chunks) { bytes.set(part, offset); offset += part.length; }
    let raw: unknown; try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw new Error('invalid_download'); }
    return parseNodeDownload(platform, raw);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
