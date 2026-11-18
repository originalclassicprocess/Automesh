# Locked sessions: memory protection and recovery

This change hardens the existing local lock. It does not change network
encryption, packet formats, delivery receipts, node protocols or the on-disk
history schema. A successful lock keeps only encrypted recovery records in
`lockedSession`, with no history objects, file plaintext or `CryptoKey` handle.
Unlock derives the profile's storage key again through the existing password
vault and verified profile-context flow.
Account/file routing IDs remain local record metadata; message and file contents
are encrypted. No cache inventory or locked-session record is sent to a node.

## Session boundary

1. Reject new account actions and invalidate pending network restarts. Already
   admitted attachment batches finish staging their files and accompanying text.
2. Detach the chat, stop direct/node/device transports and settle their work.
   Wait for file handlers, serialized sticker/library writes and history writes.
3. Close radio work, pause incomplete transfers and capture the latest history.
   Interrupted sends remain queued. Partial receives remain offers for retry;
   neither becomes a delivered/received file merely because the app locked.
4. Seal history and in-memory files using the existing authenticated local-store
   encryption, bound to the profile and each file ID. Trusted sessions also save
   history and pending in-memory files atomically to IndexedDB. Temporary sessions
   make no new persistent history/file write during lock.
5. Only after a recovery copy exists, discard open state, zero owned file buffers,
   revoke previews/download object URLs and dispose the open identity/key handles.

An encryption failure leaves the original session data available for retry and
reports failure instead of presenting a completed lock. A trusted disk-write
failure still allows an encrypted memory-only lock, with an explicit warning to
keep the tab open and unlock/retry saving before closing it.

Unlock stages decrypted files before adopting the profile. Wrong keys, mismatched
profiles, modified records, canceled attempts and storage-reset races cannot
replace the live session. Partially decrypted file buffers are cleared on failure;
the sealed copy remains available for another valid attempt. Old encrypted copies
are discarded after successful adoption, logout or emergency reset.

Temporary sessions retain their existing lifetime: closing the tab loses volatile
data. Lock does not silently promote them into persistent sessions. Drafts and
attachments not yet submitted to the send/import workflow are not given a new
durability guarantee by this change.

## Memory limits

JavaScript strings, garbage-collected objects, browser internals and OS memory
cannot be reliably zeroized from page code. The guarantee is about the state and
buffers the application deliberately retains, not forensic erasure or protection
against code already running with the unlocked user's privileges. Buffer cleanup
must preserve borrowed/shared views while an active file cache still owns them.

## Validation

`src/lib/application/session-lock.test.ts` covers trusted/temporary recovery,
atomic persistence, quota failure, encryption failure, wrong keys/profile/file
IDs, ciphertext tampering, cancellation and storage reset, queued late writes,
sticker imports committed while lock waits, interrupted text retry with the same
ID, partial file reception and shared-buffer ownership. Related storage, cache,
outbox, courier/device delivery and receipt tests run in the full suite.

```sh
npx vitest run src/lib/application/session-lock.test.ts
npm run check
npm run i18n:check
npm run build
node scripts/test-pwa-shell.mjs
npm run test:production
```

The local automated browser interaction could not be confirmed: the test shell
was visible but the browser session did not show a response to actions, in both
the development and production fixtures. No real account or hosting configuration
was used. Do not count that attempt as a passed manual/UI acceptance test.

Local verification on 2026-11-18: 215 app/server suites passed, 1,424 tests passed,
one explicit old-algorithm performance benchmark skipped in the ordinary run.
The lock-specific suite contains 13 passing cases. Node compatibility tests:
84 passed, 22 existing platform-dependent skips. Type checks, core checks,
translations, production build, PWA shell and local production/CSP/signaling
checks passed. Logs are in `.release/lock-*.log`; no delivery assertion or audit
exception was relaxed.

Manual acceptance before a public release should use disposable trusted and
temporary profiles: lock/unlock saved text and files, lock during send/receive
and sticker import, retry interrupted transfers, enter a wrong password first,
then check correct recovery. Check auto-lock and a profile switch as well.

Included in app release 0.5.12; no node update or node configuration change is
required. The owner chose to proceed with automated validation without another
manual local acceptance round. Native phone/browser acceptance is not claimed.
