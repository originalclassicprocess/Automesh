# Chat interface iteration — 0.2.0

Published on 2026-10-06 at automesh.space as `v0.2.0-c3cf1b131cc5bbf9`, source
`e332ca7`. Release workflow (pre-publication record, archived privately)
completed successfully, including Windows, application/core tests, PWA/production
and standard deployment checks. No additional live app testing was performed.
Update both clients; an installed 0.1.9 node does not need reinstallation.

This iteration does not change MAE, identity derivation, encryption primitives,
the node executable, public ports, or the relay protocol.

## Presentation

- Explicit HTTPS links are blue; HTTP links are red. Text and attributes are
  escaped by Svelte; no HTML injection, iframe, automatic metadata/image fetch,
  or link-preview service. Links open separately with noopener/noreferrer.
  HTTPS means transport encryption, not trustworthiness of a destination.
- Inline images/video are larger but constrained to the message and viewport.
  Existing verified-media allowlist and whole-file hashes are retained.
- Avatar, sender, time, reply, copy and a three-dot action menu form the header.
  Copy sends text/contact links to the clipboard; for an attachment it explicitly
  copies its filename, not its binary content. A short confirmation is shown.
- The action sheet provides reply, pin/unpin, forward, select, stop an incomplete
  transfer, external share, download, status, known route, and local deletion.
  Incoming attachments must be complete before forwarding/downloading/sharing.
  External file sharing verifies size/hash and asks for a second explicit click
  after preparation, preserving user activation on iOS. Unsupported native file
  sharing offers a download. Clipboard and external apps are outside chat E2EE.
  The sheet explicitly uses 14 px text and 16 px icons instead of inheriting the
  tiny message-header font. The application-wide scale remains unchanged.
- Status icons always have text: clock=queued, arrow=sending, gray check=sent
  without receipt, gray double check + node label=durable node acknowledgement,
  green check=recipient acknowledgement, green double check=allowed read receipt.
  Red cross is a known file-transfer failure, never an offline peer by itself.
  Route details distinguish a verified received courier hop from a node storage
  acknowledgement, and do not invent IP traces or multihop histories.

## Back navigation

The chat header arrow jumps to the list, collapses the in-app history to its
guarded root and invalidates previous gallery snapshots. Browser Forward cannot
resurrect those snapshots. Physical positions, not monotonically assigned route
IDs, determine the history jump, including after a history branch.

## Shared pins

Both clients must support this iteration. Each authenticated participant has
one independent pin slot; either may pin either participant's message. Updating
or removing one person's pin does not override the other person's pin.

The encrypted rich-chat payload has a standalone bounded control:

    { text: "", details: { pin: { targetId: "UUID" | null, revision: positiveInteger } } }

The actor comes from the verified envelope sender, never a supplied owner field.
Normal text, files, replies and forwarding metadata cannot be mixed with this
control. Only accepted contacts may send pin controls. Revision then control UUID
ordering converges under delayed delivery, duplicates and equal revisions;
unpin controls are retained as tombstones. Pins and tombstones are stored inside
the existing encrypted conversation history, not plaintext browser settings.

Controls use the existing direct outbox or one-time-key courier/mailbox queue,
with the same persistence, encryption, receipts and replay checks. A pin operation
uses one offline prekey when reserved as an offline envelope. It is hidden from
ordinary bubbles, message selection, conversation previews and unread counts.
The pin bar says synchronizing until acknowledgement. A missing/deleted target
is explicitly identified; a pin never restores a locally deleted message.

Concurrent devices sharing one address can issue equal revisions; deterministic
UUID tie-breaking converges once they have the same controls, but this is not a
new cross-device history synchronization mechanism.

## Offline key budget

The small composer label counts unique unspent, unexpired advertised peer keys
in the selected courier/mailbox mode. It never displays private key contents.
Reservations decrement it, exact retries do not; fresh peer bundles replenish it.
Files use one key per encrypted manifest, not one per chunk. Missing/disabled
nodes, unavailable nodes, untrusted sessions and missing descriptors are labeled
separately. Expiry is refreshed periodically. This is not a limit on direct online
messages and not a guarantee that a node/network is available.

## Verification

Unit coverage includes safe link rendering, action-sheet visibility, status/read
privacy, per-participant pins and tombstones, revision reordering, persistence,
key reservation/replenishment and branched-history collapse. Integration coverage
exercises pin delivery in an authenticated direct encrypted session and through
an opaque courier queue, including restart, replay and signed acknowledgement.
582 tests passed before release preparation; Svelte-check, the application build
and PWA shell verification also passed. Physical Android/iPhone checks remain
manual. Publication is performed by the existing checked GitHub release workflow;
the deployment result is recorded in the changelog after it completes.
