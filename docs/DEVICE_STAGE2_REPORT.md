# Device stages 2b / initial delivery overlay — local, not a release

Historical local report. Superseded for the private 0.3.1 text-only release by
[DEVICE_LINKING.md](DEVICE_LINKING.md). The old five-minute prototype remains in
unit fixtures; released node directories use owner-bound 30-day statements plus
nonce-bound node checkpoints, not periodic five-minute owner signatures.

Date: 2026-10-19. The deployed 0.3.0 site/node and normal app identity/transport
flows were NOT changed. New code is experimental, not independently audited,
not a replacement for current MAE/offline/courier validators and not ready to
enable for real accounts. Public README feature claims remain unchanged.

## Implemented

- `owner-store.ts`, `owner-browser.ts`: owner-only explicit approval of exact
  signed requests with matching comparison code; a separate encrypted IndexedDB
  journal and purpose-separated HKDF key. Certificate and signed device roster
  commit atomically through CAS. Concurrent/lost-reply retries return the same
  certificate; re-signing/malleating an ECDSA request cannot bypass one-use binding.
- Durable device list with label/address/expiry/status; explicit idempotent revoke.
  Revoked records remain in snapshots and cannot be silently reactivated. No
  administrative/recovery delegation to linked device keys.
- `membership.ts`: complete owner-signed versioned snapshot, semantic digest,
  previous-snapshot binding for adjacent revisions, pinned owner, monotonic
  sequence/conflict/revocation checks. Root/primary messaging endpoint requires
  explicit signed opt-in; legacy root endpoints are not added silently.
- `approval.ts`, extended pending vault: new device pins the expected owner and
  comparison code, checks request/certificate/key/membership correspondence, then
  saves the binding atomically with its OWN encrypted private key. The owner seed,
  owner password and full backup are never onboarding inputs. Reopening a local
  vault verifies saved authority historically; this alone is NOT fresh delivery
  authorization. Delivery always obtains/checks a current roster separately.
- `DeviceManager.svelte`, `NewDevice.svelte`: text/QR/image inputs, matching code,
  explicit confirmation/revocation, readable statuses, copyable outputs. Large
  owner responses fall back to text if one QR cannot hold them. Only the public
  fixture `/dev/devices` mounts these panels; production returns 404.
- `delivery.ts`: logical-account text fan-out using independent physical device
  addresses; each device retains unchanged v1 physical-key authentication. Queue
  per target, own outgoing-history sync, encrypted local journal, atomic history
  and dedup, per-device ACK only AFTER commit. Lost ACK/restart/offline target
  retries do not duplicate history; failed storage is never acknowledged.
- `chat-bridge.ts`: overlay carried by actual authenticated MAE channels through
  ChatService, not raw signaling JSON. Both directions tested with three clients,
  including a linked device independently creating messages as its logical owner.
  A wire-capture assertion rejects visible plaintext payloads.

## Deliberate limits / work still required for the user's complete request

1. NOT wired into normal settings, login, main contact/chat/history UI or profile
   switching. Owner journal currently takes an authenticated owner signer; normal
   app integration must reauthenticate the active profile, not accidentally sign
   for the root or a different profile. Preserve old-client compatibility and
   explicit capability negotiation before routing traffic through the overlay.
2. No production discovery/distribution of signed rosters or node-side per-device
   offline mail/prekeys/fan-out. Current server node is unchanged. Existing queue
   tests simulate offline targets using LOCAL persistent outbox, not delivery by a
   real server while the sender is closed. That scenario is NOT implemented here.
3. Files, audio, calls, selected data-only history transfer and read-status merge
   are not integrated. Current overlay stores bounded text only, max 4096 UTF-8
   bytes per event, 128 inbox and 128 outbox events / 1 MiB journal. Capacity fails
   explicitly, without eviction. UI deletion/compaction design is still needed.
4. IMPORTANT: experimental signed snapshots expire in FIVE MINUTES and certificates
   in 30 days. Missing/stale policy fails closed. This demonstrates freshness,
   not an availability solution: it currently requires a fresh owner publication
   and MUST NOT be enabled as "independent of the first phone". Need reviewed
   publication/freshness, renewal and recovery authority; do not silently lengthen
   TTL or copy the root key to solve availability. Offline/global immediate revoke
   cannot be guaranteed by a cached signed certificate alone.
5. One owner issuer / fixed epoch 0; max 16 cumulative device records, including
   revoked tombstones. Reviewed admin/recovery/epoch rotation, recovery after loss
   of owner journal and bounded garbage collection are not implemented. Existing
   seed remains powerful; no claimed revocation of the seed against legacy clients.
6. Delivery anchors are encrypted local state, not rollback-resistant hardware or
   global consensus. Known stale/conflicting snapshots are rejected, but replacing
   the entire local store with an old valid copy/resetting it is a separate threat.
   A relay can withhold a newer policy until a cached roster expires. No claim of
   instant global revocation. Previously decrypted data cannot be remotely erased.
7. All new databases/keys remain OUTSIDE full backup v1. Do not imply that restoring
   that archive also restores owner revocation/membership state. Before enabling:
   define identity recovery and include appropriate authenticated public control
   metadata, never clone device private keys/live sessions as "device sync".
8. Wire every new database into panic/reset/forget-device handling with session
   invalidation before erasure; implement linked-device password/key rotation.
   Lab adapters expose clear functions, but normal app reset intentionally does
   not import unfinished device code. Independent protocol review is still required.

## Verification scope

Final local checks: **146 test files / 910 tests passed**, Svelte check zero
errors/warnings, production build passed (existing HPKE/browser externalization
and chunk-size warnings), core TypeScript passed, production/PWA checks passed,
internal gate passed with 287 source files / 92 canonical node files and unchanged
node package digests. Browser checks and actual-MAE integration passed.
The local build is not an artifact release and was not deployed.

- Device unit tests: approval/import/revocation, ECDSA semantic replay binding,
  strict owner/request/code validation, reload, concurrent CAS, quota/abort,
  expired/forged/mixed policy, wrong physical sender and per-device ACK scope.
- Delivery tests: two recipient devices plus own mirror, lost ACK, restart,
  offline target isolation, receive failure, revocation and rollback denial.
- Integration: three actual ChatServices with independent keys, real MAE ECDH/
  AES-GCM/signatures, only physical network simulated; both message directions.
- Browser script `scripts/test-pending-device.mjs`: fresh headless context,
  real IndexedDB, owner/new-device forms, compare-code equality, link/reload,
  durable revoke/reload, 390px width, root-vault sentinel unchanged, no page errors.
- Production build/checks test that `/dev/devices` is closed (404), CSP/cache/
  PWA shell and legacy signed signaling still work.

No real user data, server deploy, node rebuild, public opening or history rewrite
was performed. This report intentionally distinguishes experimental implementation
from a finished multi-device release.

## Product/security decision before normal-chat activation

Distributing owner-signed rosters through existing nodes must NOT require the
first phone to keep signing every few minutes. Separate long-lived ownership
authorization from freshness/distribution, and review the directory/checkpoint
trust model before implementing it. A node can withhold an update even if it
cannot forge an owner signature.

When no configured authority/witness can establish a current device list, there
is a real choice: fail closed for new multi-device deliveries (safer revocation,
less offline availability), or explicitly permit last-known membership (better
availability but a revoked/stolen device might still receive data until refresh).
Do not silently adopt stale membership or advertise instant global revocation.
This decision does not change the deployed v1 app's direct/offline delivery.
