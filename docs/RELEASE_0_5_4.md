# Automesh 0.5.4

- Native Meshtastic channels now appear in the regular chat list with a LoRa label. Show the connected board's channels by default, optionally include saved histories, and control reception/visibility in LoRa settings. Public/default, custom and absent channel encryption have distinct lock indicators; these do not verify author identity.
- Shared message actions add copying, replies using Meshtastic reply IDs, explicit manual resend, text forwarding with destination/preview/byte checks, selection, text export and local deletion. Search, date/unread dividers, jump to latest, emoji and per-channel drafts use the regular chat components. No automatic channel rebroadcasts or relaxed airtime limits.
- Signaling renewal now shares the registration gate with configuration and maintenance. Foreground recovery cannot start a second registration on the same listener or its aliases. Overlapping account-network initialization only publishes the newest transport.
- Slim dismissible account-backup and device notices replace bulky prompts. Profiles support safe external links without claiming verification. Storage management adds file previews, type/chat breakdowns, date filters and selective local cleanup.
- English and Russian interface text is updated throughout the changed views.

Existing home and server nodes remain compatible; no node upgrade, new transport or account migration is required. Local developer checks use disposable in-memory identities and cannot be served by the production runtime.

Validation includes transport recovery regression tests, native radio encoding/history tests, encrypted storage/backup checks, type and translation checks, production build, and actual browser WebRTC + MAE message/receipt exchange through the home-node and development signaling servers. Public application and server-node signaling accepted two disposable signed registrations and forwarded negotiation frames. This does not establish reliability on every browser, network or VPN; user-reported R/GPT delivery still needs confirmation after both clients update. Bluetooth background behavior and independent security-audit limitations remain.
