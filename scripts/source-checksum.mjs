import { createHash } from 'node:crypto';
/** @param {string | Uint8Array} value */
const hash = value => createHash('sha256').update(value).digest('hex');
/** Hash textual source as canonical LF; never use for binaries/artifacts. @param {Uint8Array} bytes */
export function canonicalSourceChecksum(bytes) {
  return hash(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes).replaceAll('\r\n', '\n'));
}
// Source snapshots are text. A Windows CRLF checkout may represent the same
// canonical LF source; artifacts and all other hashes remain byte-exact.
/** @param {Uint8Array} bytes @param {string} expected */
export function sourceChecksumMatches(bytes, expected) {
  if (hash(bytes) === expected) return true;
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    return text.includes('\r\n') && hash(text.replaceAll('\r\n', '\n')) === expected;
  } catch { return false; }
}
