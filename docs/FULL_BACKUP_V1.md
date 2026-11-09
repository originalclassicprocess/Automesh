# Full local backup v1 — app release 0.3.0

Future independent identity/data encryption modes are tracked in
[BACKUP_MODES_NEXT.md](BACKUP_MODES_NEXT.md); they do not change this format.

Date: 2026-10-19. Existing account-only `.automesh` v1/v2 files remain readable.
The new `.automesh-backup` file is a separate format, not a changed meaning of
the old account backup. Target release: app 0.3.0. Actual deployment is verified
separately. No identity migration or node update is required.

## User workflow

Settings → Security → Full backup → enter current account password → create →
download → choose the downloaded file and decrypt it to verify it.

Restore from the entry screen: Restore account → Encrypted file → select file →
enter its password → inspect counts/missing attachments → explicitly confirm →
choose the destination account's new local password. Use an empty browser
profile; imported profile histories are never merged over existing histories.

The file contains the recovery phrase, registry, contacts, accepted/blocked
states, contact names/known public keys, messages, deletion tombstones, local
call records, profile settings, avatars, media library/pack metadata and locally
available complete attachment/library bytes for all saved profiles in the
current root bundle (including archived profiles). Other independent root
accounts on the same origin are excluded.

Unavailable/unreceived/deleted attachment bytes cannot be reconstructed. The
preview reports missing nondeleted referenced files. Existing corrupt bytes
cause export to fail, rather than producing a misleading successful copy.

This first implementation is password-protected. Its password is the local
password AT EXPORT TIME. Changing the app password does not re-encrypt existing
downloads. A paper mnemonic alone restores the identity, NOT this file without
its password. An offline recovery-key-wrapped archive and automatic scheduled
backup are follow-up work, not silently claimed here.

## Format and limits

- Header: ASCII `AMFULL01` (8 bytes), random salt (16), random IV (12).
- Remaining bytes: AES-256-GCM ciphertext, 128-bit authentication tag.
- Key: PBKDF2-HMAC-SHA256, fixed 600,000 iterations; password is not normalized.
- AAD: `Automesh full backup v1:PBKDF2-SHA256-600000:AES-256-GCM`.
- Plaintext: big-endian uint32 metadata byte length, UTF-8 JSON manifest,
  concatenated file bytes in manifest order. No ZIP, compression, paths or code.
- Manifest includes format/version, random backup UUID, created time, existing
  encrypted identity backup, profiles/data/file descriptions, optional selected
  profile and UI language. Each file is checked against both manifest SHA-256 and its history
  or media-library reference (size and digest).
- Whole file <=128 MiB, metadata <=16 MiB, <=257 profile records, <=10,000 files,
  <=100,000 messages. Exceeding a limit FAILS the export, never truncates it.
- WebCrypto currently processes the bounded file in memory, so this is not an
  unbounded streaming archive. Large/mobile collections need a future chunked
  design and memory testing before raising these limits.

## Snapshot and restore boundaries

The host pauses transports, waits for pending history/file writes, saves the
current profile, and reads account/file records in one IndexedDB transaction.
Only profiles cryptographically belonging to the authenticated root are read.
There is no network upload. Preparing the portable archive resumes the current
network session after capture. Cancel/lock/profile generation guards reject
late results; file byte buffers are cleared on completion/cancel where possible.
JavaScript strings/garbage collection do not permit guaranteed memory erasure.

Import verifies identity/profile derivations, peer key/address binding, profile
scope, attachment references/hashes and complete authenticated payload before
inserting data. All histories/attachments are inserted in one IndexedDB
readwrite transaction using add(), checking destination records inside that
same transaction. An abort/quota failure leaves none of those records inserted.
Profile registry and vault are separate stores; the complete onboarding workflow
is NOT a single cross-database transaction. If later setup fails, imported
encrypted history is retained, not deleted. A local archive-ID marker allows
resuming the exact same committed archive after a crash without rewriting its
records. A normal subsequent history save drops that marker, preventing a later
archive import from silently replacing newer data. The marker is not a remote
authorization or integrity proof. Different/mixed histories remain refused.

Portable recovery intentionally does NOT resume old transport state:

- Offline/courier prekeys, credentials, jobs, receipts and partial courier files
  are not exported. Public node references are retained as address-book entries.
- Restored network settings start with signaling/nodes disabled; enable/check
  them explicitly. No import-driven arbitrary endpoint connection.
- Device authority pins and public policy hints are retained, but device
  networking and cached-policy mode are disabled on restore too. Device HTTP
  does not depend on signaling, so disabling only signaling is insufficient.
  Explicitly enable device checks in Connection → Recovery (or Security →
  Devices); the saved node identity is checked, never silently replaced.
- Previously pending outgoing messages/files are not automatically resent.
- Pending incoming read receipts are suppressed. Restored messages are labelled
  as restored history, not falsely presented as a newly delivered file/message.
- Root/device browser credentials, cookies, node master keys, active media,
  browser permission grants and live secure sessions are not copied.
- Profile inbox-sharing permissions are subject to existing restore rules;
  imported registry grants are not silently activated.

An old backup can restore old local state, including previously deleted data.
This is not deletion from all copies, a proof of latest state, or a defense
against a compromised exporter/reader/OS. Retain independent backup versions;
never clear the only copy to make space without another verified copy.

## Verification

Unit tests cover roundtrip, incorrect passwords/accounts, ciphertext/header
tampering, truncation/trailing bytes, corrupt and missing files, scope isolation,
duplicate profiles, cancellation, transaction rollback, refusal to overwrite,
and suppression of old sending/receipt/network operations.

`scripts/test-full-backup.mjs` uses a public fixture in fresh headless contexts:
download/readback, narrow and wide layouts, normal entry-screen restore and
subsequent reload/unlock. It does not use a user's browser/account or server.

Manual iOS/Android import/export and large-file memory tests remain necessary;
desktop automation is not proof of coverage of every device/browser.

Verified local candidate on 2026-10-19:

- Full application suite: 140 test files / 874 tests passed.
- Svelte/TypeScript: zero errors and warnings; core TypeScript check passed.
- Production build passed (existing large-chunk/HPKE browser externalization
  warnings remain; they are not counted as Svelte diagnostics).
- Production checks passed: matching shell/version, CSP/cache headers,
  closed development fixtures including `/dev/backups`, signed signaling.
- Isolated Chrome automation: export/download/readback, encrypted link survives
  a visibility change, widths 320/390/1100, normal entry restore and reload/unlock.
- No new runtime dependency or root-key migration. Deployment/publication is a
  separate operator step. This paragraph records the 0.3.0 backup checks; the
  subsequent 0.3.1 text-device release is described in `DEVICE_LINKING.md`.
