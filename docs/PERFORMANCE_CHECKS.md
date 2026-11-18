# History and build measurements

These checks use synthetic messages and media, never real profiles or exports.
They do not require hosting credentials or publish a release.

## Build sizes

```sh
npm run build
npm run build:report
```

The report is written to `.release/build-size/report.md` and `report.json`.
For a prepared release archive, add `-- --archive <path-to-archive>`.
`--output <directory>` selects another report directory.

It separates normal browser files from compression sidecars/source maps and
server output. JS/CSS totals include raw, gzip and Brotli sizes, the largest
chunks and an estimate of the root route's static import closure. The closure
uses the matching build manifest, including CSS, but excludes dynamic imports.
Missing/mismatched manifests produce an explicit warning and no route estimate.
Absent compression sidecars are calculated locally and marked as estimates.

The offline service worker precaches all built assets, including lazy chunks.
These numbers are not measured network traffic, runtime RAM or rendering time.
Local `node_modules` is not part of the browser download. The archive size is
reported only when an archive is supplied, not guessed from build output.

CI and the release workflow append the report to the GitHub job summary after
building. Both steps are informational (`continue-on-error`); there is no byte
budget or additional deployment approval. A failed step remains visible.

## Large histories and sticker libraries

```sh
npm run test:scale
```

This runs `server/history-scale.test.js` and writes machine-readable measurements
to `.release/performance/history-scale.json`. It compares the old repeated search
with the production reconciliation helper at 1,000 / 5,000 / 10,000 messages,
using one warmup and the median of three runs. Timing is informational, never a
pass/fail threshold. Run it without a concurrent build for comparable results.
The intentionally slow old algorithm runs only in this explicit command. This
command also round-trips a pack of 100 GIFs carrying 128 KiB of valid comment
data each (over 12 MiB total), verifying the pack ID and every content hash.

The functional large-data check also runs in normal CI. It verifies:

- 10,000 outgoing messages survive encrypted save and reload, preserving queued
  delivery state and canonical sticker references;
- 32 packs of 100 stickers reference only 1,000 unique assets;
- importing a maximum-count pack preserves its ID and reuses existing assets;
- shared assets survive deletion of overlapping collections;
- the 33rd pack and 101st unique sticker in a pack are rejected;
- encrypted storage holds one blob per unique asset and logical message reads
  resolve to the correct verified bytes.

The GIF fixtures are valid one-pixel images with distinct comment extensions.
The 1,000 files total 48,000 bytes: this stresses counts, metadata and references,
not large image decoding or radio/network transfer. The separate byte-volume
pack also remains one-pixel images, avoiding a misleading decoder benchmark.
IndexedDB is simulated in
Node.js. No claim about Android/iOS frame rate follows from these checks.

`snapshot-media.test.ts` additionally checks a linear number of message-ID reads
at 20,000 messages, peer isolation, changed/deleted files and duplicate-ID
first-match behavior. `media-cache.test.ts` covers the race where a cache commit
deletes duplicate logical files before an older queued snapshot is saved: the
canonical references must survive that save and an encrypted reload.

## Scope of the optimization

Only the media-reference join in `persistLocalChats` changed from repeated
`Array.find` to one per-peer `Map`. The index is temporary and costs O(messages)
memory for one peer at a time. Profile/generation checks, serialized writes,
storage-reset guards, file hash/deletion checks, encryption, ACK ordering and
network delivery protocols retain their existing behavior.

The full history is still serialized and encrypted on save. Incremental storage
and windowed rendering of long chat timelines are separate future work. The
sticker chooser already renders 60 entries initially, with additional entries
on request; the shared library's existing count/byte limits remain in force.

## Local result, 2026-11-18

Windows, Node 24.21.0, synthetic data. Timings vary with machine load; compare
scaling and correctness rather than treating these as device guarantees.

| Messages | Previous repeated search, median | Indexed join, median |
| ---: | ---: | ---: |
| 1,000 | 22.58 ms | 0.64 ms |
| 5,000 | 429.94 ms | 2.40 ms |
| 10,000 | 2,325.31 ms | 5.31 ms |

The 10,000-message metadata fixture occupies 4,980,789 serialized JSON bytes.
Encrypted save with 1,000 unique small blobs took 140 ms and history reload took
260 ms in fake IndexedDB. The separate 100-sticker archive was 13,183,566 bytes
(12.57 MiB); export plus validated import took 119 ms. Every asset hash survived.
These are local operations, not upload/download durations.

The local production build contains 5,334,102 bytes of JS/CSS (5.09 MiB), with
1,855,001 bytes of existing Brotli sidecars (1.77 MiB). Normal browser files total
5,884,956 bytes; client disk usage including compression copies is 9,972,062
bytes. The static root-route estimate is 635,331 bytes in Brotli (0.61 MiB);
offline installation includes additional lazy assets. The generated report
contains the full gzip/server/chunk breakdown and exact build identifier.

Validation: 214 app/server suites passed (1,411 tests; the explicit old-algorithm
benchmark skipped in the ordinary run and passed separately). Node compatibility
tests: 84 passed, 22 existing platform-dependent skips. Svelte/type checks,
translation checks, core checks, production build, PWA shell and local production
server checks passed. Two initial timeouts during simultaneous build/test load
were resolved by keeping the old baseline out of normal CI and running the full
local suite with four workers. No delivery assertion was relaxed.

Included in app release 0.5.12. No node protocol update, dependency update or new
security-audit exception is introduced. The report remains informational.
