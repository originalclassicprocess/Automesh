import { mediaName, pruneMedia, type MediaLibrary } from './media-library';
import { sha256Hex } from './file-transfer';
// Rebuild immutable pack identities without reading/re-encoding their files.
// Shared assets survive as long as another pack or the GIF collection uses them.
export async function removeMediaSelection(library: MediaLibrary, hashes: string[], tab: 'gifs' | 'stickers', packId = ''): Promise<MediaLibrary> {
  const selected = new Set(hashes);
  if (!selected.size) return library;
  if (tab === 'gifs') return pruneMedia({...library, gifs:library.gifs.filter(hash => !selected.has(hash))});
  const packs = [];
  const seen = new Set<string>();
  for (const pack of library.packs) {
    const assets = packId && pack.id !== packId ? pack.assets : pack.assets.filter(hash => !selected.has(hash));
    if (!assets.length) continue;
    const id = assets.length === pack.assets.length ? pack.id : await sha256Hex(new TextEncoder().encode(JSON.stringify({name:mediaName(pack.name), assets})));
    if (seen.has(id)) continue;
    seen.add(id); packs.push({...pack,id,assets});
  }
  return pruneMedia({...library,packs});
}
