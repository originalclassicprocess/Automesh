# Independent device keys — stage 2 work in progress

Historical stage notes below. The subsequent private 0.3.1 text-only integration
is documented in [DEVICE_LINKING.md](DEVICE_LINKING.md); earlier “not enabled”
statements describe the previous local stage, not that release.

Date: 2026-10-19. This is NOT enabled in production, the ordinary app UI, signaling,
node inbox/courier, calls or MAE v1. Existing identities and wire validators
remain unchanged. Do not show users a successful device-link flow yet.

Owner approval/list/revoke, local link persistence and an initial text-delivery
overlay have since been implemented and tested in the experimental context.
The panels run only at `/dev/devices` (404 in production). Current precise status,
verification and unresolved production requirements are in
[DEVICE_STAGE2_REPORT.md](DEVICE_STAGE2_REPORT.md). Do not interpret the tests as
complete production multi-device delivery or a solved policy-freshness design.

## Implemented isolated prototype

`src/lib/devices/enrollment.ts` reuses the existing bounded signed-object codec
and P-256 primitives. A new device generates its OWN random key. A public signed
request can be represented as QR/text; it includes a label, nonce, ten-minute
expiry and proof of possession, not the owner's mnemonic/password/data.

The owner must explicitly approve the exact verified request. The returned
owner-signed certificate binds device public key/ID, request hash/ID, epoch and
expiry. This iteration grants messages only, cannot delegate, and cannot change
recovery/control policy. Copied certificates are not sufficient: a fresh proof
must be signed by the device and bind certificate digest, recipient and challenge.

Verification requires a host-pinned owner/device/epoch and determinable revocation
state. Unknown/unavailable revocation fails closed. One-use request/proof claims
use an injected atomic replay store. The included memory replay store is for
tests, not crash-safe multi-process registration.

This is a laboratory protocol, not a finalized interoperable specification,
independent review or an authorization shortcut around MAE v1 validators.

## Required before usable device linking

### Implemented next local step (2a, not shipped)

`pending-vault.ts` / `pending-browser.ts`: a new device creates its own random
P-256 key and saves that key plus the exact signed request in a separate encrypted
IndexedDB record. This flow accepts no account seed, account password, full backup
or root signer. PBKDF2-SHA256 (600000) and AES-256-GCM protect it with a new local
device password; scope, record revision and fixed format parameters are authenticated.
Reload restores the same local signer and pending request. An expired request
remains expired and cannot be approved by reloading. New expiry requires a fresh
explicit attempt (renewal UI is not implemented).

CAS prevents overwriting a concurrent local record; a successful write means IDB
transaction commit. Lock/session-reset guards stop pending operations. Local cancel
writes an encrypted no-key tombstone and closes this handle. Cancellation is NOT
remote certificate revocation and does not disable another already-unlocked handle;
remote membership/revocation remains required. Replaying a complete old encrypted
local record cannot be detected without an external trusted freshness anchor.

The adapter is intentionally not imported by live UI or reset paths yet. Before
activation every panic/erase path must invalidate sessions AND clear its database.
The subsequent local step accepts an owner certificate but does not enable normal
app login, backup device-key export, live messaging registration or server updates.

Local verification on 2026-10-19: 142 test files / 889 tests passed (including
23 enrollment/pending-vault tests), Svelte check 0 errors / 0 warnings, core
TypeScript and internal release integrity gate passed. `scripts/test-pending-device.mjs`
also passed in an isolated headless Chrome context: real IndexedDB persistence,
reload with the same signed request/key, possession proof, cancellation surviving
reload, root-vault sentinel untouched, no page errors. These are local tests,
not a cross-device/network pairing test or an independent protocol review.

### Remaining release gates

Implementation order: (2a) local key/request persistence → (2b) durable owner
admission journal + signed membership/revocation/freshness → (2c) explicit
pairing UI/safety comparison and encrypted data-only exchange → (2d) negotiated
v2 transports and per-device fan-out → compatibility/migration tests and review.
Local storage work alone must never be labelled a successfully linked device.

1. Specify and review persisted membership/revocation state, conflict/equivocation
   handling, rollback/freshness, recovery priority and administrative delegation.
   A claimed greater epoch by itself never establishes authority.
2. Encrypted local device-key vault and durable one-time claims. Atomic/idempotent
   admission with retries after a lost reply and crash. Never place root seed in
   the transferred device payload or QR.
3. Pairing UI with exact account/device confirmation and out-of-band comparison;
   a secret-free QR request is not by itself protection from scanning an
   attacker's substituted request. Expiry, cancellation and fresh attempts.
4. Authenticated encrypted pairing channel for optional selected data transfer;
   certificate distribution alone is not E2EE session establishment. The full
   recovery archive CONTAINS the mnemonic and MUST NOT be reused as a linked
   device's onboarding payload. Use a separate data-only transfer with no root
   secret, encrypted solely to the approved device.
5. Explicit v2 negotiation in server and direct registration, signed envelopes,
   receipts, contact verification, offline prekeys and node receiving grants.
   Existing v1 binds from-address to the signing public key directly and MUST
   continue rejecting unrelated device keys. No global weakening of validation.
6. Multi-device mailbox fan-out, per-device prekeys/receipts, storage keys,
   file/call addressing, deduplication and sync of both outgoing/incoming history.
   Do not clone a live session snapshot or assume a shared account ID solves it.
7. Multi-admin devices without permanent dependence on the first phone, and
   separate simple/strong recovery modes. The legacy mnemonic remains powerful
   while legacy clients accept it; no fictitious root-revocation guarantee.
8. Two-client/node integration and long-lived lock/unlock/revoke tests; independent
   protocol review before enabling the new route for real accounts.

The full-backup phase is useful independently and does not depend on pretending
this device transition is already shipped. Automatic archives and paper recovery
card generation are separately tracked follow-ups.
