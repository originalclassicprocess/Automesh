# Delivery reliability work · 2026-10-25

Internal implementation notes. Public protocol extraction is deferred. These
changes retain existing account addresses, MAE, courier signatures and node APIs.
They do not implement federation or guarantee delivery through network partitions.

## Delivery boundaries

- Primary-to-primary text uses authenticated primary identities. Device
  replication is a separate task and must not gate the primary route. A signed
  primary-disabled policy remains binding; no cached-device authorization bypass.
- Save an outgoing message before transmitting it. Reuse its message ID on
  retries, but encrypt each direct attempt within the current secure session.
- A successful transport send is not recipient acceptance. Node storage is not
  recipient acceptance either. Only a validated recipient receipt marks delivery.
- Receiver acceptance includes saving local history. Duplicate attempts retain
  one visible entry and may elicit another receipt if the original receipt was lost.
- Restore/import must distinguish live outgoing work from historical copies.
  Restored history must not be sent as new messages.
- One-time courier keys remain consumed after reservation, including when a
  competing direct receipt makes uploading unnecessary. Never recycle them.
- LAN-only policy, node identity pins, contact consent and revocations must not
  be weakened to obtain a working route.

## Implemented in this step

1. Each primary text message keeps its own retry schedule (12, 24, 48, 96,
   then at most 120 seconds between attempts). New messages and ordinary queue
   wakeups do not retransmit all earlier messages or reset their schedules.
2. A due attempt waits for an in-flight send in the same conversation without
   increasing backoff merely because the actor is busy. Confirmed/deleted work
   is checked again after asynchronous authorization and transport completion.
3. A freshly authenticated peer connection wakes pending primary text
   immediately. A reconnect notification during an old send is retained.
4. A recipient receipt wins over a late send failure. Such failure cannot add
   a misleading error or another retry to the confirmed message.
5. Before uploading a courier job, re-read current contact/message state after
   authorization and file preparation. Do not start uploading a deleted,
   confirmed text, restored, delegated, blocked or canceled-file job.
   Requests already dispatched cannot be recalled by this local check.

These are client changes shared by home and server courier usage; no node
upgrade is required for this step. Skipping an obsolete reservation does not
recall already stored remote envelopes or refund its reserved prekey.

## Verification boundaries

Regression tests cover independent retry deadlines, simultaneous timers,
receipts racing send failures, reconnection while sending, queued work changing
ownership, and courier state changes while checking authorization. Existing
MAE, routing, files, persistence, revocation and node suites remain relevant.
They are not an external cryptographic audit or a real-device/NAT field test.

Local verification on 2026-10-25: 1,085 app/server tests in 171 files passed
with two workers and local network access. Node.js 24 node tests: 45 passed,
22 platform-specific cases skipped, no failures. Svelte check: zero errors and
warnings; core type check and production build passed. The build retains its
existing HPKE browser-crypto and bundle-size warnings. Cross-domain parser and
server-origin tests passed; an unchanged old browser client talking to the new
deployment has not been field-tested. No live hosting/DNS was changed.

## Cross-domain acceptance criteria and first contact exchange

- A deployment defaults only to its own configured/same-origin signaling.
  Never bundle both deployment domains as universal fallback endpoints.
- A user-exchanged HTTPS contact link can supply its origin's `/signal` route.
  Parsing a link performs no network requests. The primary client asks once
  before saving a previously unknown endpoint to this profile's settings.
  Account/device authority and node storage permissions are not granted by it.
- Own contact cards retain the legacy Account ID QR and offer a separate
  contact-link QR with the network address. Bare IDs still carry no route.
- A route is an untrusted discovery hint, not a signed identity assertion.
  The authenticated session must verify the exact requested Account ID.
- The application server permits only its own browser origin by default.
  An operator can explicitly permit other app origins using
  `SIGNALING_ALLOWED_ORIGINS`; this is a server permission, not a list of
  addresses installed as client defaults. Wildcards and public HTTP are refused.
  Device pairing HTTP permissions are not widened by this setting.
- An unchanged legacy client may only accept Account ID QR. It can still add a
  compatible signaling-server QR through existing network settings, provided
  that server permits its browser origin. No new release can retroactively add
  contact-link parsing to an old cached application or bypass a server refusal.
- This step derives only a same-origin signaling hint from a contact URL.
  Custom signaling paths, signed route cards, automatic advertisements,
  node-to-node bridging and linked-device route import remain future work.

## Next stages, not implemented here

1. Extend delivery recovery checks across clean restart, restored backup,
   interrupted node uploads and queue draining when changing nodes. Preserve
   existing pending-job guards until an explicit migration model is implemented.
2. Define signed route advertisements: identity binding, sequence, expiry,
   privacy, rollback rejection and authorization of advertised endpoints.
3. Add authenticated node-to-node delivery with immutable recipient ciphertext,
   hop permissions, bounded retries/hops, deduplication and precise receipts.
   Existing courier-v1 jobs are bound to a particular courier, so arbitrary
   forwarding is not a compatible implementation-only change.
4. Connect device replication to the stable primary delivery model; keep
   per-device acknowledgements distinct from acceptance by the account owner.

Keep brief internal contracts and regression fixtures while building. A public
MeshAutonomy Protocol repository/specification will follow stabilization rather
than becoming a second independently maintained copy of the current code.
