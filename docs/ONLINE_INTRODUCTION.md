# Online introductions (prototype v1)

## Scope and consent

`automesh-introduction-v1` is a small online service exchange on existing authenticated signaling WebSockets. It carries the first contact request, explicit consent, a durable-receipt acknowledgement and existing courier/offline key bundles. It has no disk inbox or ordinary chat/file/call API. Common signaling is required; a node's loopback/LAN address is not thereby reachable from the internet.

Direct WebRTC gets a three-second grace period. The reserve has its own peer map, cryptographic sessions and statuses and never emits a direct transport `joined` event. Its absence does not disable existing delivery. Multiple configured servers are tried with bounded retries; simultaneous opens converge on the lower Account ID's route. Reopening a peer session invalidates old asynchronous work. It cannot create account or device authority.

Consent uses the existing contact state machine. Only an explicit outgoing request can be matched with a verified reciprocal request or an acceptance referencing that exact request ID. Presence, a signaling acknowledgement and key bundles cannot grant consent. An unsolicited first request remains pending; blocked contacts are excluded. First requests are limited to 4 KiB; pinned/ephemeral controls are excluded. Established contacts cannot use new request IDs as an ordinary messaging tunnel.

## Authentication and limits

The server advertises support after signed registration and supplies `from` from the authenticated socket. Frames are limited to 24 KiB, 4/s per sender (burst 32), and 8/s per recipient (burst 64), in addition to existing byte and connection limits. Offline recipients get an explicit unavailability response; no queue is created.

The signaling `frame` field uses canonical, padded RFC 4648 Base64 (`+`, `/`, `=`). It does not use the unpadded Base64URL encoding of offline mailbox objects. Client relay tests apply the shared server frame validator before dispatching any handshake or encrypted data frame.

Clients use a separate existing MAE v1 ephemeral P-256 ECDH/AES-GCM instance. Each signed envelope includes the `automesh-introduction-v1` domain prefix and sender/recipient identity. Normal DataChannel frames cannot be substituted into this instance. Envelopes must be recent; encrypted counters reject replays. Incoming work is serialized per peer and bounded globally. Consent and receipts follow successful local persistence. Existing bundle validation and primary-account authorization still apply.

Up to 32 active introductions, a 64-packet work limit, handshake timeout, idle expiry and session-generation guards bound client resources. An authenticated open can restart crypto after a peer reconnects; it cannot bypass the signed handshake. As with existing signaling, a hostile signaling server can disrupt availability and observe traffic metadata; it cannot decrypt the exchange or create consent. This prototype is not an independently audited cryptographic protocol.

## Verification

Automated checks cover real client signatures/ECDH/encryption with no direct transport, mutual and unilateral consent, persistence failure, replay and forgery, stale acceptance for a replaced request, blocking/lock, both reconnect directions, independent routing and server authentication/limits. Existing direct chat, queue, file, radio and device tests remain required. Hardware/browser/VPN behavior is a separate field test; no blanket NAT traversal guarantee is made.
