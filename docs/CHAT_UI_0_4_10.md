# Chat interface 0.4.10

Application release 0.4.10. Nodes remain 0.4.12. Publish both application hosts
through GitHub Actions with protected rollback backups.

- Keep the profile, contact-copy action and QR action together in a compact
  group with shared hover and keyboard-focus highlighting. Measure the real
  content to retain one header row while it fits. First merge networks and cloud
  into one toggle, then hide the QR shortcut, then the copy shortcut. Both remain
  available in the profile. Keep settings at the top right and the lock immediately
  to its left; only move the complete profile below the controls when even its
  full name cannot fit. Full names wrap rather than being truncated. The merged
  button retains the queue's priority colour/count and opens the original network
  and queue controls directly below the toggle, shifting sideways only to avoid
  overflowing the header. Escape and outside clicks close it. Keep
  the cloud available even when the main-account queue is empty without a node.
- Use one shared conversation-row component in the main account and linked
  device interfaces. Normal rows are 64 px tall; rows with activity add short
  transfer/status indicators. Keep long names/previews on one line, unread counts
  separate, and presence as a small dot on the avatar.
- Keep upload/download indicators continuously visible with explicit direction,
  counts and percentages, both in conversation rows and above the open chat.
  Cancellation, quota warnings and expiry never hide these indicators. The open
  chat has a question-mark button beside active transfers; the reminder to keep
  the application open is hidden until that button is pressed.
- Put the remaining status details into one closed disclosure. Existing queue
  cancellation and expiry notices, counter clearing and jump-to-message actions
  remain available. Transfer jump controls are outside the disclosure.
- Present expiry/cancellation in red, actionable failures in yellow, active
  transfers and stored envelopes in green, and automatic waiting/user
  cancellations neutrally. Retain transfer progress beside a higher-priority
  warning. A stored envelope is not recipient delivery.

This batch changes presentation only: existing transfer, queue, key, receipt,
profile-selection and conversation-opening logic is retained. Node protocol,
quotas and node deployments are unchanged.

Validation: Svelte check without errors/warnings; 31 focused tests for activity
classification and existing transfer/queue/conversation components. The isolated
interface preview was checked at desktop width and 280–1100 px, including long
names, unread counts, keyboard-operated disclosure, and popup anchoring 5 px
below its toggle. The full local suite covered 1158 tests: one Windows EPERM in
the deployment journal rename passed on an isolated repeat of that test file.
GitHub CI runs the required complete checks before publication. Live-account
message acceptance remains with the user.

The local interface preview now includes seven selectable synthetic chats with
three or four concurrent states each (uploads/downloads, key waits, quota errors,
stored envelopes, expiry and cancellation). Expanding the summary exposes the
existing controls; clicking a counter jumps to its example message. No real
accounts, messages, file uploads or node requests are used by these scenarios.
