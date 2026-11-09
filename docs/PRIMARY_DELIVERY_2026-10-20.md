# Primary delivery stabilization — 0.3.6

This patch deliberately restores one baseline before expanding multi-device
delivery: two seed-backed accounts exchange ordinary encrypted text directly;
an accepted, offline recipient can receive via the sender's chosen courier.
The node protocol and downloadable node packages are unchanged.

## Route contract

1. Record a stable message ID in the encrypted local history before enabling
   any network worker. A `saving` row is ineligible for transmission. Once a
   snapshot commits, a crash/reload recovers it as `queued`.
2. Prefer the authenticated primary-to-primary channel. A directory pin,
   expired routing advertisement, or empty device directory does not require
   a delegated-device transaction for an ordinary root message.
3. Retain locally known, signature-verified primary-disabled restrictions.
   Invalid signed routing hints fail closed with an explicit reason. This
   historical hint check does not authorize device certificates or replace
   the fresh policy checks required for delegated messages.
4. Retry with the same ID. After a failed direct send or missing delivery
   receipt, permit a courier attempt even if the direct channel still reports
   connected. Node storage is not recipient delivery and cannot be downgraded
   by a concurrent direct retry. Incoming retries remain deduplicated.
5. Reserve ciphertext and an unused recipient key durably before node upload.
   Missing, expired, or exhausted keys wait for a new live key exchange; no
   rights, contact consent, or recipient keys are invented.

The receiver can exchange prekeys over its existing authenticated channel
without selecting its own sending node. Already accepted contacts reassert
acceptance after restoration; ACKs do not echo indefinitely. New or blocked
contacts are not automatically accepted.

## Home, server, and multiple connections

Home and server nodes use the same courier client. The browser fixture covers
HTTPS node access via both a public-style hostname and a private LAN address.
Independent home and server signaling registries can hold this primary
account simultaneously. Concurrent registration through aliases of one
registry is serialized and reuses the open listener. This does not evict a
different live session or bypass a rejected registration proof.

Multiple signaling connections are not multiple replicated outboxes. One
courier is selected for new outgoing envelopes. Existing legacy LAN mailbox
settings are retained separately. Pending envelopes are not automatically
moved to another node. Internet reserves follow the reserve setting; LAN and
required receiving listeners are maintained independently. Explicit LAN-only
policy and disabled endpoints still apply.

`signaling_address_busy` means the server rejected registration as occupied;
it alone does not distinguish an old sleeping socket, a second tab, another
device, or a client registration race. The interface no longer claims to
have established which explanation is true.

## Device boundary

New enrollment from the owner interface is paused in this candidate. New
ordinary primary messages are not fanned out or mirrored to linked devices.
Existing device certificates, pinned authorities, queues and revocation
controls are retained, not reset. Existing delegated jobs still use their
strict original authorization checks. Only not-yet-stored, primary-authored
queued text can migrate to the ordinary queue after the primary restriction
check. Imported archives, foreign sync history, and already stored jobs do
not migrate or replay.

This intentionally does not claim production-ready multi-device operation.
The legacy enrollment browser scenario in `test-device-live.mjs` is not the
acceptance test for this candidate; use `--primary-only` (and `--home-node`
for LAN-addressed courier access).

## Diagnostics and limitations

Per-message reasons distinguish direct failure/receipt wait, contact consent,
missing/expired/exhausted prekeys, node timeout/denial/quota/rate limit,
local persistence and network policy. Only allowlisted diagnostic codes
enter the UI/history, not arbitrary exceptions, URLs, response bodies or
secrets. Confirmed storage/delivery/read states take precedence over an old
attempt's diagnostic.

- A first contact cannot receive offline before consent and key exchange.
- Restoring just a seed does not recover old one-time decryption keys.
  Imported historical messages are not silently re-sent as new messages.
- No automatic migration, replication, or cross-node federation is added.
- Browser suspension, certificate trust, NAT/VPN and physical LAN reachability
  remain deployment conditions. The isolated LAN fixture is not a physical
  Windows/phone network test and does not establish iOS background delivery.
- The test results are not a guarantee that every historical failure is fixed
  or an external security audit. Live deployment is verified separately.

## Verification commands

Use the installed Node runtime and dependency paths for this workstation:

```text
node node_modules/vitest/vitest.mjs run src server
node node_modules/svelte-check/bin/svelte-check --tsconfig ./tsconfig.json
node node_modules/typescript/bin/tsc --project tsconfig.core.json
node scripts/test-device-live.mjs <playwright-node-modules> --primary-only
node scripts/test-device-live.mjs <playwright-node-modules> --primary-only --home-node
node node_modules/vite/bin/vite.js build
node scripts/test-production.mjs
node scripts/test-pwa-shell.mjs
node scripts/security-release-check.mjs
```

Fixtures use public test mnemonics, temporary node state and fresh browser
contexts. They do not open user accounts or send messages to real contacts.

### Results for this candidate

- 975 tests passed across 158 application/server test files.
- Svelte check: zero errors and zero warnings; core TypeScript check passed.
- Isolated browser baseline passed for both node address variants: direct
  traffic in both directions without a node, then with a node pin, and
  courier delivery to the returning recipient after the sender is closed.
  Ordinary primary fixtures made no `/devices/*` HTTP requests.
- Separate real-WebSocket tests cover independent home/server registrations;
  a controlled concurrency test covers simultaneous alias registration.
- Production build, production-server smoke and PWA-shell checks passed.
  Existing browser-crypto externalization and large-chunk build warnings remain.
- Internal release gate passed: 315 production sources scanned, 95 canonical
  node files matched; both node package hashes and Linux payload checked.
- One browser run alongside other tooling was interrupted by navigation back
  to the lock screen. The final baseline was re-run separately and passed.
  Run browser fixtures without concurrent builds or generated-file tooling.

These results describe local candidate checks. The application release has
separate deployment verification. The server node is not upgraded by this patch.
