import { parsePackageProvenance } from '../application/package-provenance.js';
import { fetchPublicRelease, nodeRepository, type PublicRelease } from '../application/public-releases';

export type NodePlatform = 'windows' | 'linux' | 'server';
export const nodeDownloads = {
  windows: { manifest: '/downloads/node-release.json', url: '/downloads/Automesh-Node-Setup.exe', label: 'Windows · x64' },
  linux: { manifest: '/downloads/node-linux-release.json', url: '/downloads/Automesh-Node-Linux-x64.tar.gz', label: 'Linux · x64' },
  server: { manifest: '', url: '', label: 'Server · cPanel' }
} as const;
export type NodeDownload = { version: string; url: string; bytes: number; sha256: string; signed: boolean;
  fileName?:string; commit?:string; releaseUrl?:string;
  provenance?: NonNullable<ReturnType<typeof parsePackageProvenance>> };
export function parseNodeDownload(platform: NodePlatform, raw: unknown): NodeDownload {
  if(platform==='server')throw new Error('invalid_download');
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
  const release=await fetchPublicRelease(nodeRepository,signal,request);
  return nodeDownloadFromRelease(platform,release);
}
function nodeDownloadFromRelease(platform:NodePlatform,release:PublicRelease):NodeDownload {
  const fileName=platform==='windows'?'Automesh-Node-Setup.exe':platform==='linux'?'Automesh-Node-Linux-x64.tar.gz':`Automesh-Server-Node-${release.version}-cPanel.tar.gz`;
  const asset=release.assets.find(a=>a.name===fileName);
  if(!asset || asset.bytes<(platform==='server'?1024:1024*1024))throw Error('download_unavailable');
  return {version:release.version,url:asset.url,bytes:asset.bytes,sha256:asset.sha256,signed:false,
    fileName,commit:release.commit,releaseUrl:release.url};
}
export async function fetchNodeDownloads(signal:AbortSignal,request=fetch):Promise<Partial<Record<NodePlatform,NodeDownload>>> {
  const release=await fetchPublicRelease(nodeRepository,signal,request), result:Partial<Record<NodePlatform,NodeDownload>>={};
  for(const platform of ['windows','linux','server'] as const){try{result[platform]=nodeDownloadFromRelease(platform,release);}catch{/* A missing edition is unavailable, not an invented build. */}}
  return result;
}
