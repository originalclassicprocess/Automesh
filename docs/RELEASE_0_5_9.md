# Automesh 0.5.9

Optional browser notifications are available in Settings → Application. Enable
once on each receiving browser/device and grant the browser permission. The
built-in provider is the current application server; an advanced setting selects
another compatible HTTPS Automesh provider. No additional node setup is required.

Only generic notifications are shown, never message text, names or chat keys.
Signed receiving-device registrations authorize accepted contacts, and routing
metadata travels over the existing encrypted direct/introduction channel. The
provider still sees registration/contact/request metadata; this is not anonymous
traffic. Browser/OS push infrastructure remains an external dependency.

Without delivery nodes, a recipient returning to the unlocked app can send a
bounded reverse nudge to an absent sender with a still-pending message. It never
marks the message delivered or creates ordinary chat traffic. An enabled delivery
node on either side suppresses this nudge. Delivery, cancellation, contact blocks,
node attachment, stale tickets and active sender leases suppress obsolete nudges.

Server Node 0.4.19 optionally retains a signed wake request with an accepted
courier submission so its short retry survives sender closure. Old nodes continue
to deliver messages normally; the app can send notifications directly too.

The provider uses private persistent SQLite/VAPID state outside released code,
bounded quotas, authenticated requests, replay protection and a push-service
allowlist. Optional failures are isolated from signaling, courier storage, message
receipts and UI delivery colors. Notification acceptance is not delivery evidence.

Brave may require “Use Google services for push messaging”. Brave and Vivaldi
also need site/system notification permission. iPhone/iPad require Home Screen
installation. Fully exited/force-stopped browsers, OS power controls, permission
revocation and network outages can prevent immediate display.

See [notification architecture and hosting limits](NOTIFICATIONS.md).
