import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { encodeAccountId } from '../src/lib/addressing/bech32m';
import { preserveSnapshotMediaRefs } from '../src/lib/chat/snapshot-media';
import { emptySessionChats, ensureConversation, saveChats } from '../src/lib/chat/session-chats';
import { addMedia, cacheMedia, emptyMediaLibrary, LIBRARY_ITEMS, libraryFileId, makePack, normalizeMediaLibrary, PACK_ITEMS, prepareMedia, pruneMedia } from '../src/lib/chat/media-library';
import { exportStickerPack, importStickerPack } from '../src/lib/chat/sticker-pack';
import { deriveChatStoreKey, inspectChatStorage, loadLocalChatData, loadLocalFileData, normalizeLocalChatData, saveLocalSessionData } from '../src/lib/chat/local-store';

const owner = encodeAccountId(new Uint8Array(20).fill(1)), peer = encodeAccountId(new Uint8Array(20).fill(2));
const gif = Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), c => c.charCodeAt(0));
const report = { node: process.version, platform: process.platform,
  scope: 'Synthetic data, Node.js and fake IndexedDB. Not a phone rendering or network benchmark.' };
beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('IDBKeyRange', IDBKeyRange);
  const values = new Map();
  vi.stubGlobal('localStorage', { getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value) });
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => {
  const path = process.env.AUTOMESH_SCALE_REPORT;
  if (path) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(report, null, 2) + '\n'); }
});
function history(count) {
  const current = ensureConversation(emptySessionChats(), peer);
  current.byPeer[peer].messages = Array.from({ length: count }, (_, i) => {
    const id = `00000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`;
    return { id, from: owner, direction: 'outgoing', text: '', timestamp: i + 1, delivery: 'queued', fileStatus: 'ready',
      file: { id, name: 'test.gif', mime: 'image/gif', size: gif.length, sha256: 'a'.repeat(64) },
      details: { media: { kind: 'sticker' } }, mediaRef: '00000000-0000-4000-8000-000000000001' };
  });
  return current;
}
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

describe('large histories and sticker libraries', () => {
  // The old quadratic algorithm is a manual benchmark only. Do not spend CI
  // time running a deliberately slow baseline alongside delivery tests.
  it.runIf(!!process.env.AUTOMESH_SCALE_REPORT)('compares the real reconciliation helper with the previous search without timing thresholds', () => {
    const rows = [];
    for (const count of [1000, 5000, 10_000]) {
      const current = history(count), indexed = [], previous = [];
      for (let round = 0; round < 4; round++) {
        const a = saveChats(current), b = saveChats(current);
        for (const m of [...a.byPeer[peer].messages, ...b.byPeer[peer].messages]) delete m.mediaRef;
        let start = performance.now();
        preserveSnapshotMediaRefs(a, current);
        const indexMs = performance.now() - start;
        start = performance.now();
        for (const m of b.byPeer[peer].messages) {
          const live = current.byPeer[peer].messages.find(row => row.id === m.id);
          if (!m.fileDeleted && live?.mediaRef && live.file?.sha256 === m.file?.sha256) m.mediaRef = live.mediaRef;
        }
        const searchMs = performance.now() - start;
        expect(a).toEqual(b);
        if (round) { indexed.push(indexMs); previous.push(searchMs); }
      }
      rows.push({ messages: count, indexedMedianMs: median(indexed), previousMedianMs: median(previous) });
    }
    report.reconciliation = rows;
  }, 30_000);

  it('round-trips 10,000 messages, 32 full packs and 1,000 unique encrypted assets with shared references', async () => {
    // Valid one-pixel GIFs distinguished by a harmless GIF comment extension.
    const files = await Promise.all(Array.from({ length: LIBRARY_ITEMS }, (_, i) => prepareMedia(
      new Uint8Array([...gif.slice(0, -1), 0x21, 0xfe, 2, i & 255, i >>> 8, 0, 0x3b]), `${i}.gif`)));
    let library = emptyMediaLibrary();
    let start = performance.now();
    for (let p = 0; p < 32; p++) {
      const selected = Array.from({ length: PACK_ITEMS }, (_, i) => files[(p * PACK_ITEMS + i) % files.length]);
      library = addMedia(library, selected, await makePack(`Pack ${p}`, selected));
    }
    const libraryMs = performance.now() - start;
    expect(library.assets).toHaveLength(LIBRARY_ITEMS);
    expect(library.packs).toHaveLength(32);
    expect(library.packs.reduce((n, p) => n + p.assets.length, 0)).toBe(3200);
    start = performance.now();
    const normalized = normalizeMediaLibrary(library), normalizeMs = performance.now() - start;
    expect(normalized).toEqual(library);
    const tooMany = await makePack('33rd pack', files.slice(0, PACK_ITEMS));
    expect(() => addMedia(library, files.slice(0, PACK_ITEMS), tooMany)).toThrow();
    await expect(makePack('101 stickers', files.slice(0, PACK_ITEMS + 1))).rejects.toThrow();
    // Round-trip a maximum-sized pack, preserving its immutable ID and hashes.
    start = performance.now();
    const archive = exportStickerPack(library.packs[0], files);
    const imported = await importStickerPack(archive, library.packs[0].id);
    const archiveMs = performance.now() - start;
    expect(imported.pack).toEqual(library.packs[0]);
    const merged = addMedia(library, imported.files, imported.pack);
    expect(merged.assets).toHaveLength(LIBRARY_ITEMS);
    expect(merged.assets.map(a => a.id)).toEqual(library.assets.map(a => a.id));
    expect(merged.packs).toHaveLength(32);
    expect(cacheMedia(library, imported.files[0]).assets).toHaveLength(LIBRARY_ITEMS);
    expect(pruneMedia({ ...library, packs: library.packs.slice(10) }).assets).toHaveLength(LIBRARY_ITEMS);

    const current = history(10_000);
    current.byPeer[peer].messages.forEach((message, i) => {
      const asset = files[i % files.length].asset;
      message.mediaRef = asset.id;
      message.file = { ...message.file, sha256: asset.hash, size: asset.size };
    });
    const snapshot = saveChats(current);
    for (const m of snapshot.byPeer[peer].messages) delete m.mediaRef;
    preserveSnapshotMediaRefs(snapshot, current);
    const key = await deriveChatStoreKey(new Uint8Array(32).fill(5), owner);
    const data = normalizeLocalChatData({ chats: snapshot, mediaLibrary: library });
    const blobs = new Map(files.map(file => [libraryFileId(file.asset.id), file.bytes]));
    start = performance.now();
    await saveLocalSessionData(key, owner, data, blobs);
    const saveMs = performance.now() - start;
    start = performance.now();
    const reloaded = await loadLocalChatData(key, owner), loadMs = performance.now() - start;
    expect(reloaded?.chats.byPeer[peer].messages).toHaveLength(10_000);
    expect(reloaded?.chats.byPeer[peer].messages.every(m => m.delivery === 'queued')).toBe(true);
    expect(reloaded?.mediaLibrary?.assets).toHaveLength(LIBRARY_ITEMS);
    expect(reloaded?.mediaLibrary?.packs).toEqual(library.packs);
    expect((await inspectChatStorage(owner)).files).toHaveLength(LIBRARY_ITEMS);
    for (const i of [0, 999, 9999]) {
      const message = reloaded.chats.byPeer[peer].messages[i];
      expect(await loadLocalFileData(key, owner, `${peer}:${message.id}`)).toEqual(files[i % files.length].bytes);
    }
    report.storage = { messages: 10_000, packs: 32, packReferences: 3200, uniqueAssets: LIBRARY_ITEMS,
      assetBytes: files.reduce((n, f) => n + f.bytes.length, 0), jsonBytes: new TextEncoder().encode(JSON.stringify(data)).length,
      libraryMs, normalizeMs, maxPackArchiveBytes: archive.length, maxPackRoundTripMs: archiveMs,
      encryptedSaveMs: saveMs, encryptedLoadMs: loadMs };

    if (process.env.AUTOMESH_SCALE_REPORT) {
      // Also exercise byte volume, without huge decoded images. GIF comments
      // allow a valid tiny image to carry a deterministic 128 KiB fixture.
      const large = await Promise.all(Array.from({ length: PACK_ITEMS }, (_, index) => {
        const payload = 128 * 1024;
        const bytes = new Uint8Array(gif.length - 1 + 2 + Math.ceil(payload / 255) + payload + 2);
        bytes.set(gif.subarray(0, -1));
        let at = gif.length - 1; bytes[at++] = 0x21; bytes[at++] = 0xfe;
        for (let remaining = payload; remaining > 0;) {
          const length = Math.min(255, remaining); bytes[at++] = length;
          bytes.fill(index, at, at + length); at += length; remaining -= length;
        }
        bytes[at++] = 0; bytes[at] = 0x3b;
        return prepareMedia(bytes, `large-${index}.gif`);
      }));
      const pack = await makePack('Large byte fixture', large);
      start = performance.now();
      const zip = exportStickerPack(pack, large), decoded = await importStickerPack(zip, pack.id);
      const roundTripMs = performance.now() - start;
      expect(zip.length).toBeGreaterThan(12 * 1024 * 1024);
      expect(decoded.pack).toEqual(pack);
      expect(decoded.files.map(f => f.asset.hash)).toEqual(large.map(f => f.asset.hash));
      report.largePack = { stickers: PACK_ITEMS, archiveBytes: zip.length,
        assetBytes: large.reduce((n, f) => n + f.bytes.length, 0), roundTripMs };
    }
  }, 30_000);
});
