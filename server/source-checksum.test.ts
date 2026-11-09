import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { canonicalSourceChecksum, sourceChecksumMatches } from '../scripts/source-checksum.mjs';
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
describe('canonical source checksum', () => {
  it('records the same inventory on Windows and Linux while retaining BOM/content distinctions', () => {
    const encode = (text: string) => new TextEncoder().encode(text);
    expect(canonicalSourceChecksum(encode('a\r\nb\r\n'))).toBe(sha('a\nb\n'));
    expect(canonicalSourceChecksum(encode('\ufeffa\n'))).not.toBe(sha('a\n'));
    expect(() => canonicalSourceChecksum(new Uint8Array([0xff]))).toThrow();
  });
  it('accepts exact bytes and Windows checkout CRLF, not content changes', () => {
    const source = 'const value = 1;\n';
    expect(sourceChecksumMatches(new TextEncoder().encode(source),sha(source))).toBe(true);
    expect(sourceChecksumMatches(new TextEncoder().encode(source.replaceAll('\n','\r\n')),sha(source))).toBe(true);
    expect(sourceChecksumMatches(new TextEncoder().encode('const value = 2;\r\n'),sha(source))).toBe(false);
    expect(sourceChecksumMatches(new TextEncoder().encode('\ufeff'+source),sha(source))).toBe(false);
    expect(sourceChecksumMatches(new Uint8Array([0xff,13,10]),sha(source))).toBe(false);
  });
});
