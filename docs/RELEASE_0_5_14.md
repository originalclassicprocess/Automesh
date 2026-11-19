# Automesh 0.5.14

- Keep native Meshtastic message selection compact so its toolbar no longer
  stretches vertically and displaces message history. Hide selection in empty
  channels; retain the shared eligibility rules for bulk actions.
- Sort both forwarding destination choosers by recent conversation activity,
  without promoting chats for reaction, edit or pin controls. Display local
  contact photos with account-identicon fallback and native radio avatars.
- Cancel waiting Bluetooth callers promptly on lock. Keep native GATT operations
  serialized across reconnects and give replacement operations their own timeout.
  Release a connection completing after cancellation or timeout without closing
  a newer session. Invalidate readiness after write failure and show bounded,
  localized Bluetooth errors, including native bridge error objects.
- Compact message padding, headings, reply quotes and spacing. Display reactions
  and delivery status in a shared wrapping footer without changing status meaning.
- Add a small adjacent reaction button that opens only an emoji grid. Support
  selection, replacement/removal, keyboard navigation, outside dismissal, Escape,
  focus restoration and the existing back/profile-reset lifecycle.
- Expand the exact reaction allowlist to 36 emoji, including negative reactions.
  Advertise expanded support through a signed control while retaining the older
  update capability. Keep the six legacy choices until expanded peer support is
  authenticated; Saved messages use the full set locally.

Reaction updates retain the existing signed encrypted v4 queue, actor ownership,
revisions, replay handling and receipts. Originals, attachments and delivery
states are not rewritten. Capabilities create neither chat rows nor delivery
receipts. No node release, dependency update or storage migration is included.
Existing nodes carry the opaque encrypted events unchanged.

Validation: full app/server suite (1,498 passed, one existing skip), node
compatibility (84 passed, 22 platform skips), type and translation checks,
production build, PWA/offline checks and signed production signaling checks.
Isolated browser fixtures cover native selection and both forwarding choosers at
390/1100 pixels, and compact messages/reaction selection at 320/390/1100 pixels.
All 36 reactions round-trip through the codec and projection; authenticated
exchange tests deliver a negative reaction followed by ordinary text.

Bluetooth checks cover cancellation, hung writes, timed-out/late connection
completion, newer-session ownership, per-operation reconnect timeouts,
notification recovery and legacy acknowledged writes. Physical Bluefy/iPhone
acceptance after lock or sleep remains necessary; these fixes do not establish
the cause of every observed device-specific failure or promise background radio
availability while the OS suspends a page. General iPad internet slowness is not
changed by this release.

Deploy the verified public package with the existing backup/rollback workflow.
Older app clients retain the six-reaction vocabulary; a downgraded client may not
display or retain newly introduced reaction values. Original messages and files
remain unchanged. Preserve the encrypted profile backup before a client downgrade.
