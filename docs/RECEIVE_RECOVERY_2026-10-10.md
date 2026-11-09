# Receive recovery — local changes, 2026-10-10

Not deployed in this turn. Server-node identity, stored envelopes, membership, keys and wire encryption are unchanged.

## Diagnosis and scope

The inspected server has embedded signaling enabled, with its local internet route connected; an external courier relay was not configured. A client with ordinary quick reserve disabled could keep only the first working internet signaling endpoint registered. A second endpoint hosting its courier queue could remain idle, even though signed HTTPS queue requests succeeded. This is a reproduced routing hole, not proof that it was the sole cause of the reported iPhone incident.

The configured courier node's `/signal` endpoint is now treated as a required receive route independently of ordinary discovery reserves. Explicit signaling disable, LAN-only policy and disabled endpoint choices still win. Nodes with the same registry ID reuse an existing registration, not a second account registration. A healthy unrelated endpoint no longer suppresses recovery of the required route.

Returning to a visible document, restoring it from the browser back/forward cache, or an online event renews signed signaling registration and wakes the courier. Already established encrypted DataChannels remain open. Repeated foreground events coalesce; locking/stopping prevents resumption. Stale `address in use` refusals are retryable only within a 65-second recovery window; other authentication/policy refusals remain fail-closed. Required route maintenance retries every 10 seconds while the account is open.

## Diagnostics

Updated location: Settings → Связь и ноды → Диагностика доставки. Registration refusals and unavailable channels now get separate sanitized explanations; raw server exceptions are not rendered.

Settings → Connection → Incoming / Outgoing contains a collapsed panel distinguishing signed queue access from the configured node's receiving channel. It shows the last verified envelope, durable save, receipt sent into the channel, a bounded human-readable failure and a recovery action. It contains no message text, filenames, addresses, keys or raw exception strings, and resets with the opened session. A receipt sent into a socket is not claimed to be a confirmed receipt at the node.

Save-before-ack, duplicate detection, signatures, prekeys, bounded attachment pulls and durable restart of interrupted files are unchanged. Automatic recovery does not mean a locked/suspended browser receives in the background. A browser must reopen/unlock. Separate nodes still need a shared signaling route and previously exchanged receive keys; arbitrary node-to-node federation is not added here.

## Automated coverage

New discovery/negotiation uses this order: selected public courier node, deployment-provided application internet signaling, other enabled public endpoints, then home LAN listeners. Both reserve modes use the same order. A saved administrator bookmark alone is not a delivery selection. Endpoints are classified by public/LAN address, not by operating system; a public home-node address is a public route. The selected courier queue remains the only outgoing queue; this does not turn application signaling into a second storage node or implement federation. Existing working direct DataChannels, including those negotiated through application signaling, are preserved. No encrypted message is broadcast or retried across E2EE sessions by this priority change.

Required node pinning with reserves off, node recovery with another endpoint healthy, explicit policy opt-out, registry aliases, foreground signed re-registration preserving a live channel, bounded stale-socket retry, stop/lock safety, persistence before acknowledgement, sanitized diagnostics, and GIF delivery from node storage while the sender is locked (including interrupted upload and receiver restart).

Avatar updates are documented separately in `PHOTO_AVATARS.md`; settings inventory and proposed reorganization are in `SETTINGS_MAP_2026-10-10.md`.

Follow-up verification: 125 test files / 756 tests passed, Svelte/TypeScript 0 errors and 0 warnings. Additional cases cover priority independent of reserve, public/application/LAN order, no duplicate endpoint registration plan, sanitized registration errors, application fallback followed by preferred node recovery, and keeping an established conversation while new peers use the server node. Physical iPhone/Android checks and production deployment were not performed in this follow-up.
