# Signed courier routes · app 0.4.0 / node 0.4.5

Experimental, additive extension to courier v1: a bounded signaling bridge,
not replicated inbox storage or general multihop federation.

## Delivery

`sender → sender's node queue → recipient's advertised signaling → recipient`

The original encrypted job stays on the sender's node until the recipient saves
it and returns its signed receipt. The remote signaling service forwards the
original job/hop and receipt without allocating another stored copy. The sender
can close the application; its node must remain running or resume later.

The recipient can use its public home/server node or just a compatible app
signaling service. It must eventually reconnect there. HTTP-only polling of a
different inbox cannot retrieve this source queue. No delivery is promised
without usable keys, reachability and an exchanged/configured route.

## Discovery and permissions

- Each installation defaults only to its own signaling. No old/new domain pair
  or universal project relay is bundled as a fallback.
- Accepted contacts exchange optional `route` metadata in the existing signed
  courier prekey bundle over the authenticated encrypted chat channel.
- The recipient separately signs `courierBytes('route', body)`. The body binds
  `automesh-courier-route-v1`, recipient `from`, permitted sender `to`,
  `issuedAt`, `expiresAt` and a canonical `signalingUrl`. A checked node route
  also includes `nodeId`/`nodeAddress`; a signaling-only route instead uses
  `kind: 'signaling'`, without inventing a node identity.
- A client without its own node advertises a connected public signaling
  endpoint. LAN-only mode never advertises Internet routes.
- This is discovery information, not device authority, node administration,
  mailbox permission or a certificate for the remote server. Existing
  recipient signatures and encryption still determine identity and acceptance.
- Lifetime is at most seven days. A node privately caches at most 50 routes per
  bound profile, 400 overall (`courier-routes.json`, at most 1 MiB). This bounded
  metadata is separate from the encrypted-message quota.
- `/outbox/route` requires a member's body/path/challenge-bound request and the
  recipient's signature. Older or conflicting equal-time replacements cannot
  overwrite the accepted route. Expiry cannot resurrect an older cached route.
- Updates can move pending jobs to another signaling service without changing
  their ciphertext, recipient, source courier, message ID or receipt checks.

## Safety

- Automatic destinations are WSS `/signal`, public DNS names, port 443, verified
  TLS, no credentials/query/fragment and no redirects.
- Every socket lookup validates all IPv4/IPv6 answers. Private, loopback,
  link-local, mapped and reserved answers are refused. The checked IP is handed
  directly to the socket, without a second resolution that could rebind it.
- Explicit LAN/custom-port routes keep their previous policy and behavior.
- At most 12 discovered sockets exist; larger queues rotate a bounded window.
  Each service is only asked about recipients who advertised that exact URL.
- Profile removal clears its cached routes. Obsolete sockets cannot reconnect.
  Nodes register with their own key, never with the user's seed.

## Compatibility and limits

Ordinary direct delivery, Account IDs, MAE, courier-v1 encryption/receipts,
files and device authorization retain their existing contracts. Automatic
routing currently applies to primary text/control messages in the normal text
queue. Files and device replication keep their previous paths.

A new sending node is required for discovery. A compatible older recipient
node/signaling service can still forward existing courier-v1 packets. A legacy
client that sends no signed route needs an exchanged compatible endpoint or the
source node's existing configured relay. Bare Account IDs are not a directory.
No automatic bootstrap is claimed for an unchanged old cached browser.

Browser Origin allowlists remain in force. Authorizing another app origin is
an operator permission, not a new client default. This is not an anonymity
network, global DHT, push guarantee, file federation or independent audit.

## Upgrade and rollback

Update the sending node first, preserving its private config, key, data, queue
and hosting-managed dependency paths. New fields are optional. Keep old app
assets available to already open tabs. Preserve source backups and queues before
rollback: an older node continues its configured routes but cannot provide this
automatic bridge. Never erase receiving keys or queues to perform a downgrade.
