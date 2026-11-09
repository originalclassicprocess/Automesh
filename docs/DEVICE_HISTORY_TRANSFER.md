# Selected-device historical transfer — app 0.3.9

2026-10-24. Complements [DEVICE_REPLICATION_STAGE.md](DEVICE_REPLICATION_STAGE.md).
This is a manual, consent-based transfer of older chat data, not a change to the
ordinary primary delivery path or a continuous history synchronization service.
It does not require a node update.

## User workflow

1. Keep both updated clients open and unlocked. On the owner open Settings →
   Security → Account devices → Transfer history and attachments for the chosen
   authorized device. No new enrollment QR is needed.
2. Select conversations from the current profile, and optionally available file
   bytes. Review the message/file/missing-file counts. The owner's recovery phrase,
   vault password, routing credentials, queued sends and device authority are not
   part of this archive.
3. On that linked device explicitly accept the offer. The archive then travels
   over the existing authenticated, encrypted direct channel. Signaling may help
   establish that channel; the archive is not deposited in a node mail queue.
4. Both screens show progress. Completion on the owner means that the recipient
   validated and committed the history and files, not merely received the bytes.
   Short connection interruptions resume within the same open session.
5. Historical copies appear in chats with a history label. Open a transferred
   attachment to verify/decrypt it, then download it. Available passive media
   previews load lazily using the main chat's format allowlist and viewer;
   documents and unrecognized formats remain download-only. This reads local
   transferred bytes, not a new live attachment delivery protocol.

По-русски: у владельца «Настройки → Безопасность → Устройства аккаунта» →
«Перенести историю и вложения» у нужного устройства → выбрать чаты → предложить
перенос. На втором устройстве — «Принять историю». Сид и пароль владельца не нужны.
До окончания оставьте оба приложения открытыми. При перезагрузке/блокировке
незавершённый перенос запускается заново; уже сохранённые сообщения не дублируются.

## Separation from live delivery

- A dedicated historical store uses the linked device's independent local storage
  key and device/owner-bound authenticated encryption. It is not the live chat
  database, device journal, prekey store or courier/device mail queue.
- The chat combines historical rows with live rows for display only. Live IDs,
  deletion tombstones, drafts, contact restrictions and delivery state take
  precedence. Imported rows never become outbound jobs or fresh read receipts.
- Repeats merge by conversation/message ID. Immutable-body/file conflicts fail;
  they do not overwrite existing history. Missing attachments may be supplied by
  a later transfer; a metadata-only repeat retains already transferred file bytes.
- History metadata and new encrypted files commit in one transaction. Failed
  verification, quota/write failure or cancellation before commit cannot report
  success or leave a partially committed archive.
- Deleting a historical message removes its unreferenced local attachment and
  retains a local tombstone against later reimport. The linked-device Security
  section can erase all transferred history/files without erasing live messages.
  The application-wide local erasure also clears this historical store.

## Security boundaries and limits

- Only the authenticated physical owner can offer history to the selected physical
  device. The owner rechecks its signed, current local device authorization before
  offering, transmitting chunks and authorizing the final commit. The recipient
  checks owner/device/account binding and its known authorization. Expired or
  known-revoked devices are not allowed. This does not remotely recall already
  decrypted data or solve a compromised owner/client.
- Explicit recipient consent precedes history chunks. A fresh random transfer
  secret encrypts the data-only archive (existing AMDATA01 AES-GCM format); it is
  sent only inside the authenticated encrypted control channel, never an enrollment
  QR, public link, log or node mailbox. No root-seed serializer is used.
- Verify archive SHA-256, authenticated decryption, expected owner, manifest and
  individual file hashes before import. After verification, a fresh owner-side
  authorization is required for commit; no cached-policy fallback is introduced.
- Stop-and-wait 16 KiB chunks, bounded pending handlers and a yield between chunks
  limit interference with live traffic. Acknowledgements allow reconnect/retry and
  completion recovery. This is a separate logical flow on the same channel, not
  separate bandwidth or a guarantee of latency under load.
- Limit: 128 MiB per encrypted transfer; retained historical attachment bytes up to
  128 MiB, metadata up to 16 MiB, 10,000 files/conversations and 100,000 messages.
  Each file also retains the application's existing file-size bound. Preparation
  and validation require additional memory; large mobile transfers may fail.
- Offers expire after 30 minutes. Unfinished bytes are not persisted for resume
  across reload/lock; restart the transfer. Loss of connection is not success.
- Disappearing content/open reports and pin-control events are excluded. Historical
  content is owner-provided data, not new proof of original sender authentication.
  Contact labels transfer for presentation; transport credentials/rights do not.
- This does not add live file/call delivery to linked devices, all-device history
  sync, background iOS transfer, Bluetooth/NFC transport, or linked-device recovery.
  The separate historical store is not automatically included in existing owner
  backup files. Keep the source and its verified backup; do not treat this transfer
  as a replacement backup or erase the owner's seed/device.
- No independent cryptographic audit or physical iOS/Android acceptance is claimed.

## Repeatable local checks

`node node_modules/vitest/vitest.mjs run src/lib/devices/history-transfer.test.ts`

`node scripts/test-device-live.mjs <playwright-node-modules> --history-only`

Run browser fixtures serially without source edits/builds during a run. They use
synthetic accounts and isolated local storage. Primary server/home-node and linked
node/direct-upgrade scenarios remain separate delivery regression checks.

## Verification record — 2026-10-24

- 1,062 application/server tests passed across 170 files. The history suite covers
  consent, close/cancel/restart, freshness at commit, revocation, expiry, corruption,
  storage rollback, wrong device/owner/key, duplicate IDs, concurrent imports,
  retention bounds, scoped erasure and protection against reimport resurrection.
- Svelte: zero errors/warnings; core TypeScript, production build, generated-server
  checks, PWA shell and internal source/artifact integrity gate passed. Build
  warnings about large chunks and upstream browser-externalized crypto remain;
  this stage does not claim to resolve them.
- Real browser P2P historical transfer passed with a 1 MiB attachment: explicit
  consent and owner-side cancellation, forced WebRTC close/reconnect, new text
  during transfer, downloaded-byte SHA-256, reload, repeated metadata-only import,
  local file deletion followed by reimport, and complete history-only erasure.
  Live messages survived erasure/reload. No root vault or history mail job was
  created. Narrow/wide layouts (320/390/1920 px) passed overflow checks.
- Ordinary primary bidirectional direct and offline courier baselines passed with
  server-style and home-node addresses. Linked-node independent offline delivery,
  reply/revocation and direct-to-node upgrade without a new QR passed separately.
- Standalone node tests: 42 passed, 21 platform-dependent checks skipped on Windows,
  none failed. Canonical node sources are unchanged.

These are local synthetic checks, not deployment, physical-device acceptance,
an independent security audit or proof that every network/NAT combination works.

## Shared presentation in 0.3.9

Main/linked chats share ordering/preview and Enter rules, composer sizing, the
delivery-status component, public Account ID QR, scroll anchoring/jump-down and media viewer. Linked login
uses the same debounced automatic password checker and form; stale attempts
cannot adopt a session after the input changes. Histories use stable chronological
display; Saved is pinned first. Historical saved status is local persistence,
not a fabricated recipient acknowledgement. Unsupported live file/call/admin
operations remain unavailable. This is incremental shared UI, not a wholesale
replacement of the two delivery runtimes or a claim of complete feature parity.
