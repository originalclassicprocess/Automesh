import { describe, expect, it } from 'vitest';
import {
  FILE_CHUNK_BYTES, MAX_FILE_BYTES, decodeFileChunk, encodeFileChunk, normalizeFileOffer,
  safeFileName, sha256Hex,
} from './file-transfer';

const id = '12345678-1234-4234-8234-123456789abc';

describe('bounded file frames', () => {
  it('round-trips binary chunks and rejects malformed frames', () => {
    const bytes = crypto.getRandomValues(new Uint8Array(FILE_CHUNK_BYTES));
    expect(decodeFileChunk(encodeFileChunk(id, 5, bytes))).toEqual({ id, index: 5, bytes });
    expect(() => encodeFileChunk(id, 0, new Uint8Array(FILE_CHUNK_BYTES + 1))).toThrow();
    expect(() => decodeFileChunk(encodeFileChunk(id, 0, bytes).slice(0, 30))).toThrow();
    expect(decodeFileChunk(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it('bounds and sanitizes incoming metadata', () => {
    const base = { id, name: 'photo.png', size: MAX_FILE_BYTES, mime: 'image/png', sha256: 'a'.repeat(64) };
    expect(normalizeFileOffer(base)).toEqual(base);
    expect(normalizeFileOffer({ ...base, size: MAX_FILE_BYTES + 1 })).toBeNull();
    expect(normalizeFileOffer({ ...base, name: '../../evil.html' })).toBeNull();
    expect(safeFileName('../../evil.html')).toBe('.._.._evil.html');
    expect(normalizeFileOffer({ ...base, sha256: 'wrong' })).toBeNull();
  });

  it('calculates the full-file SHA-256 including empty files', async () => {
    expect(await sha256Hex(new Uint8Array())).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
