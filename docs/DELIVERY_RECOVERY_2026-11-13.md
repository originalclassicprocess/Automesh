# Existing-path recovery · stage 1

Built on 0.5.7. This stage improves recovery of existing paths; it adds no relay,
TURN, federation, Reticulum, new default server, or protocol/storage migration.
The canonical node source and the embedded compatibility snapshot are unchanged.

## Behavior

- `RecoveryController` coalesces a burst of lifecycle hints over 200 ms. Each
  named lane runs independently; a busy lane retains the latest trailing hint.
  Reset cancels scheduled work and detaches old account operations. UI closures
  also check account generation, chat and transport after awaits.
- Queue workers wake independently of signaling and delegated-device recovery.
  The legacy mailbox worker now has an idempotent start and coalesced wake, too.
  Wakes received during a failed courier poll are no longer discarded.
- Existing connected peers resume their text outbox, pending file offers and
  read receipts. Accepted peers refresh existing signed key bundles. Offline
  peers retry the existing connect/introduction mechanism. The existing periodic
  key exchange retry and its throttle remain in place. Contact consent is kept.
- Shared eligibility excludes imported/restored history, delegated/radio work,
  calls, unsaved messages/files and node cancellation/terminal outcomes from
  primary sends. Files are marked `saving` until the account write succeeds;
  the existing storage codec restores committed `saving` entries as `queued`.
- Local inbox pagination advances after processing, and never past a failed
  account save. No recipient receipt is sent for an uncommitted entry; earlier
  saved receipts allow safe deduplication on retry. Invalid envelopes remain
  unacknowledged and are revisited on later scans without trapping all subsequent
  local pages. Reserved/consumed one-time keys are not reset.
- Late node health failures do not relabel radio work, canceled jobs, restored
  history or confirmed deliveries. A completed file ignores stale failure,
  cancellation and progress updates while still permitting local file deletion.
- The contact header/list no longer equates lack of direct connection with
  offline presence. Existing independent signaling, node, radio and quota
  indicators are retained. A selected node with no fresh verified queue snapshot
  shows `?` in the header instead of claiming an empty queue; known local work
  remains available separately.

## Automated coverage

| Scenario | Coverage |
| --- | --- |
| Focus/visibility/network burst; independent slow/failing lanes | `src/lib/application/recovery.test.ts` |
| Another network hint during recovery; lock/unlock with late old completion | Same recovery tests |
| Exclude history, cancellation, delegated/radio work and unsaved files | `delivery-work.test.ts`, `outbox.test.ts` |
| Missing direct receipt; receipt wins over old send failure; reconnect backoff | `outbox.test.ts` |
| Node page save failure followed by retry, deduplication and key consumption | `src/lib/node/courier-controller.test.ts` |
| Wake during failed polling; no competing poll; stop prevents restart | Courier and legacy mailbox controller tests |
| Completed file survives old cancellation/failure/progress | `src/lib/chat/node-transfer.test.ts` |
| Lost signed HTTP receipt; fresh unlocked sender; signaling recovery fails independently | `server/node/courier-delivery.test.ts` |
| Existing file resume, sender/node restart, direct-copy cleanup, cancellation, different nodes | Existing courier delivery/routing integration suites |
| Online introduction, mutual requests, key exchange and actual wire validation | Existing introduction/contact suites |

Integration fixtures use disposable identities, temporary node directories and
real signed node requests over local test HTTP. They do not use production
accounts or demonstrate production TLS/certificate installation on a tablet.

Validation on Windows, 2026-11-13:

- Full app/server suite: 203 files, 1,321 tests passed with four workers. An
  earlier run alongside a production build hit the 45-second timeout of the
  existing 128-message journal-compaction test; it passed alone and in the full
  run with bounded load, without increasing its timeout or changing that test.
- Final header/queue rendering checks: 4 files, 14 tests passed, including the
  additional unknown-count regression added after the full run.
- Embedded node suite: 78 passed; 22 platform-specific tests skipped on Windows.
- Svelte check: no errors or warnings. Core types and translation checks passed.
- The 144 embedded node source files matched the pinned public source revision.
- Production build, PWA shell and actual local production server checks passed.
- Physical sleep, VPN toggles and iPad suspension remain manual acceptance cases.

## Manual acceptance on real devices

1. With accepted contacts and pending text/file work, put a PC to sleep, wake it
   and return to the app. Confirm the original IDs/history remain and delivery
   resumes without deleting or blocking contacts.
2. Switch Wi-Fi or toggle a VPN while both clients are open. Confirm available
   node delivery continues even when a direct connection cannot be established.
3. Lock the app, restart the node, then unlock. Check receipt recovery, pending
   cancellation and file completion, including clients using different nodes.
4. Repeat on iPad/mobile after browser suspension. Check the status text and
   unchanged node counts/“not checked” state until a fresh response arrives.

Browsers can suspend background work entirely. Recovery resumes when execution
returns; this is not an always-running mobile service. Network-change events
depend on browser support. A VPN that blocks LAN, missing LAN permission,
untrusted certificate, unavailable destination or a full node still requires
restoring access/capacity. No security policy is bypassed to obtain delivery.

Rollback: deploy the previous app artifact if necessary. There is no node update
or durable format migration to reverse; committed message IDs and consumed keys
must be retained. Never roll back account data to reuse encryption keys.
