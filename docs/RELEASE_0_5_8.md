# Automesh 0.5.8 · local candidate

Restore existing delivery paths when returning to the app or changing networks.
Foreground, restored-page, online and supported network-change events coalesce
into independent queue, signaling, peer and device recovery tasks. A notification
arriving during recovery is retained for one subsequent check. Sleep is also
detected when the existing periodic timer resumes after a long pause.

An interrupted incoming node page is retried before advancing its cursor. Durable
receipts deduplicate already saved entries. History imports, canceled node work,
radio work and unsaved files cannot become fresh direct sends after recovery.
Completed file transfers retain their result when an older route later fails or
sends cancellation. Outgoing files are saved before being made eligible to send.

The contact header now says “No direct connection” rather than asserting that a
contact is offline: node delivery may still work. Account addresses, encryption,
signed receipts, consent, existing node APIs and routing policies are unchanged.
No node upgrade or contact reset is required. This candidate is not deployed.

See [recovery verification and limits](DELIVERY_RECOVERY_2026-11-13.md).

Delivery status colors now describe the user's next action consistently: green
for completion or confirmed handoff, yellow for work that needs the app to stay open,
red for repairs or deliberate retry, and gray for history/intentional stops.
Node uploads remain yellow; confirmed recipient-board LoRa handoff is green,
with board-buffer limitations explained in existing status details. File-offer
receipts cannot turn unfinished byte transfers green. The aggregate queue keeps
the highest-priority status visible rather than rotating through green copies.
See the [complete user status inventory](USER_STATUS_CONTRACT.md).
No new message-path card or global safe-to-close indicator is planned.

Mobile Back follows the media/chat hierarchy. Browsing photos replaces the same
viewer history entry. Closing media consumes that entry, including native modal
cancel that may not emit `popstate`; the next Back reaches the chat list. A late
render cannot overwrite the parent history marker while traversal is pending.
Reply/share actions wait for that traversal before opening their next UI.

Verification: navigation unit regressions and an isolated real-browser fixture
at 390px cover 20 photo changes per open, native modal cancel, browser Back,
viewer/chat close buttons, repeated reopen, and replying after viewer close.
These exercise browser events; physical iOS/Android system gestures still need
device acceptance. Run `scripts/test-device-live.mjs <playwright-node-modules>
--back-hierarchy-only` with a disposable test browser, never a user profile.
