# Browser notifications

## Hosting and operation

Read-only hosting check on 15 November 2026 found Node.js 24.22.3, working built-in
SQLite, a writable account home and outbound TLS connectivity to FCM, Mozilla and
Apple push endpoints. The current app worker used approximately 86 MiB RSS. These
are readiness observations, not a load test or a guarantee about the hosting
account's LVE/RAM/disk quota. Filesystem-wide free space is not account quota.

The app serves `/api/notifications/config` plus signed POST operations under
`/api/notifications/`. It lazily creates private SQLite state in
`~/.automesh-notifications/<origin-hash>/`, outside deployed/static code, and uses
the same persisted VAPID identity after upgrades/restarts. An operator can set
`AUTOMESH_NOTIFICATIONS_DIRECTORY` or disable only this feature with
`AUTOMESH_NOTIFICATIONS_ENABLED=0`. Node.js with `node:sqlite` is required; tested
on Node.js 24. No native SQLite addon, external database or new domain is required.

Up to 10,000 device registrations (16/account), 500 accepted contacts/device,
10,000 coalesced jobs and 50,000 event/replay records are accepted. SQLite is capped
at 256 MiB and WAL journal retention at 1 MiB; actual WAL size can temporarily be
larger during active writes. Send work is serial and bounded per pass. Overall
HTTPS deadline is ten seconds. No redirects, private/custom push endpoints or
user-controlled outbound URLs are accepted. FCM covers compatible Chromium
browsers, including Brave and Vivaldi; Mozilla, Apple and Windows endpoints are
explicitly allowed. No Firebase service account is needed for VAPID Web Push.

Jobs survive process replacement and are retried by the live worker and subsequent
requests. On shared hosting, a suspended/stopped process cannot execute timers:
retries resume on the next request. This release does not promise an always-on
background scheduler. Push acceptance is not proof of OS display or message receipt.

## Client, permission and provider change

Permission is requested only from the Enable button. Separate notification-worker
registrations/scopes per provider avoid changing the shell updater or breaking
another profile's subscription. Turning off one profile removes only that account's
server registration; it never unsubscribes a browser-wide endpoint used by another.
The app reports a failed server removal instead of falsely claiming success.

Signed account/device registrations and an accepted-contact allowlist control who
can wake a device. Browser endpoints and VAPID private keys are not published or
exchanged with contacts. Only provider routing/device metadata is encrypted and
exchanged, with stale updates rejected. Existing contacts discover the same-origin
default without manual setup. A custom provider must first be advertised to the
contact while a secure direct/introduction exchange is available; provider
switching is not cross-provider federation. Other devices retain their own provider.

Notification preferences/routes are encrypted with local profile data and excluded
from portable/data/history backups. After restoring an account, re-enable receiving
on that browser. Permission revocation requires reconnecting in browser settings.
The receiving device must have Internet access. Browser closure and power-saving
restrictions are platform-specific, not controlled by Automesh.

## Reverse reminders and node compatibility

An outgoing pending message can register a one-day random waiting ticket. The
recipient's unlocked client reads a bounded ticket list and sends a signed reverse
wake to the sender's provider. That provider requires its matching outstanding
ticket/contact permission, waits for the sender's active lease to expire, and
removes the ticket after submission. Normal receipts/cancellation reconcile stale
tickets, including after a sender restart. Neither side may request a reverse wake
when it advertises/configures an enabled delivery node. Every node-relayed wake
also has `returnRoute: null`.

Notifications do not store chat payloads and never write message-delivery state.
Without a node the sender must return for actual message delivery. History imports,
radio-only tasks, canceled work, ephemeral messages and contact requests do not
generate these notifications. Existing node/courier/direct/LoRa workers continue
independently; notification failure cannot downgrade confirmed delivery.

Server node 0.4.19 advertises a wake capability in `/outbox/status`. Updated clients
can add a separate signed wake envelope to `/outbox/put`; the encrypted courier job
format remains unchanged. The node queues it only after durable message storage,
has no push credential, permits only operator-approved app providers and retries
for at most 90 seconds. Old nodes receive the original `{job}` request. Personal
nodes are not automatically updated and continue their current delivery behavior.

## Acceptance and browser guidance

Unit/integration suites cover real identity signatures, domain/replay/recipient
isolation, two providers, node suppression, delivery cancellation, expired/blocked
work, persistence/restart, worker click handling and notification failure isolation.
Production server/PWA checks continue to exercise actual signaling and HTML shell.
An actual Web Push subscription and system display must be accepted on real
Chrome/Firefox/Brave/Vivaldi/Android/iOS devices; fake push transports are not proof
of physical delivery. The UI has a Test notification action for this purpose.

Primary references:
- https://developer.mozilla.org/en-US/docs/Web/API/Push_API
- https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
- https://support.brave.app/hc/en-us/articles/360017989132-How-do-I-change-my-Privacy-Settings
- https://vivaldi.com/blog/decoding-network-activity-in-vivaldi/
- https://github.com/web-push-libs/web-push
