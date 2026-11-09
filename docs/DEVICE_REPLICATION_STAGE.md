# New text replication — app 0.3.9

2026-10-24. This supplements the historical [DEVICE_LINKING.md](DEVICE_LINKING.md)
private-preview notes. Enrollment was paused during primary-delivery stabilization;
this patch enables it again with a separate copy queue. Publication is confirmed
by the release/operator report, not this document alone.

## What changes

- Owner initiates in Settings → Security → Connect new device. One short-lived
  QR/link; new device generates its own key and local password. Both screens show
  the same comparison code; explicit owner confirmation remains required. Neither
  the root recovery phrase nor its password is an enrollment payload.
- Node-backed enrollment is preferred for an existing verified binding. Without
  a node the authenticated direct mode remains available. A later owner-signed
  node binding upgrades the same device key without another enrollment QR.
- After linking, ordinary primary outgoing text and accepted incoming text get
  independent durable copy jobs. Accepted contacts discover signed device lists
  over their authenticated owner channel. Different-node routing must be learned
  before its owner disappears; this is not a new global directory.
- Root-to-root MAE/courier delivery stays independent. A child-device receipt is
  presented as “Delivered to a device”, not as the root's receipt. The primary
  queue continues until its own acknowledgement/expiry. Copy failure must not
  prevent ordinary primary sends.
- Own incoming history copies are explicitly owner-attested. Only the physical
  owner may create that wrapper; a delegated device cannot forge another
  contact's incoming message. This is not a retained original sender signature.
- UI projection is durable and idempotent before receipt. Only committed inbox
  entries and completed outbox jobs may be compacted at the 128-event boundary.
  Unconfirmed mail/receipts remain queued. Node-confirmed outer receipts can
  release local slots because the node retains their dedup tombstones.
- Backup serializers remove copy-work flags/statuses. Restored historical text
  is not retransmitted as newly authored content.

## Reliability correction found during this stage

“Saved messages” is a local conversation marked connected for presentation, not
a network peer. Periodic key publication and direct roster advertisement had also
selected it. An impossible self-handshake could hold the courier publisher actor;
subsequent inbound key processing could then block an authenticated peer receive
queue, including fresh device-policy replies after reconnect.

The UI excludes self from network publishers/online peer advertisement. Both
legacy key publishers skip self, and ChatService/SecureSessions fail immediately
on attempted self delivery. Saved-message writes remain local and unchanged.
No plaintext fallback, cached default or nonce/signature bypass was added.

## Scope and honest limits

- New ordinary TEXT only, at most 4096 UTF-8 bytes including metadata/wrappers.
  This replication path is not full history transfer, live address-book/settings merging, saved
  message synchronization, files, calls, groups, or disappearing-content sync.
- The linked workspace uses the shared chat/header components but does not have
  full feature parity. Unsupported operations remain unavailable/explained.
- A node provides independent per-device encrypted queues; it does not blindly
  broadcast a primary envelope. Each device adds ciphertext/metadata storage.
  There is no large-file deduplication or device attachment protocol in this patch.
- Node mode can operate with the first owner and sender closed, provided usable
  receiver prekeys and the required signed routing/grants were prepared. Queue
  TTL is bounded (up to seven days); exhausted prekeys require an online receiver.
- Strict direct mode requires live peers AND fresh owner proof. With no reachable
  owner, local history can open, but new delegated traffic waits. Revocation
  checking is not weakened to make offline direct mode appear successful.
- Grants expire; known revocations remain sticky. A malicious authority or
  compromised endpoint is not solved by this patch. Already decrypted history
  cannot be remotely recalled. No independent cryptographic audit is claimed.
- Journal, directory, bootstrap and certificate bounds from DEVICE_LINKING.md
  still apply. Compaction removes completed tracking, not unlimited-history
  capacity requirements or all protocol/node rate/storage limits.

## Repeatable checks

`node node_modules/vitest/vitest.mjs run src server`

`node scripts/test-device-live.mjs <playwright-node-modules> --linked-node-only`

`node scripts/test-device-live.mjs <playwright-node-modules> --direct-only`

`node scripts/test-device-live.mjs <playwright-node-modules> --primary-only`

`node scripts/test-device-live.mjs <playwright-node-modules> --primary-only --home-node`

Fixtures use synthetic accounts and isolated local queues. Run browser scenarios
serially without source edits/builds during a run. Physical iOS/Android and real
network/NAT/background acceptance are still manual; browser fixtures are not
production uptime evidence. The separate local/P2P historical-transfer stage is
documented in [DEVICE_HISTORY_TRANSFER.md](DEVICE_HISTORY_TRANSFER.md), without
exporting the root backup or putting historical rows into the live copy queue.

Local verification on 2026-10-24: 1038 application/server tests passed across
169 files; standalone node tests: 42 passed, 21 platform-dependent checks skipped
on Windows, none failed. Svelte diagnostics: zero errors/warnings; core TypeScript,
production build, generated-server checks, PWA shell and internal release gate
passed. Both linked-node/direct-upgrade browser phases and both primary baselines
(server-style and home-node addresses) passed serially after the self-loop fix.
This records local checks, not deployment or physical-device acceptance.
