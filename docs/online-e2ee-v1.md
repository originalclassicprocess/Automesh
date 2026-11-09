# Online E2EE prototype (MAE v1)

Status: experimental application protocol; **not independently audited** and
**not Signal Protocol**. Do not describe it as production-grade E2EE.

## Scope and trust model

- Two account identities must both be online. The existing P-256 ECDSA identity
  key authenticates each handshake and data envelope; the peer's Account ID is
  recomputed from the supplied public key before a frame is processed.
- A new non-extractable ephemeral P-256 ECDH key pair is generated for each
  connection. The signed hello and welcome messages bind both Account IDs,
  the ephemeral public keys, the protocol version, and a random 128-bit session
  ID. Each side proves knowledge of the derived secret with encrypted confirm
  and acknowledgement frames before the UI reports the peer as online.
- HKDF-SHA-256 derives separate AES-256-GCM keys for each direction. The IV is
  a monotonic 64-bit counter under each fresh directional key; counter zero is
  reserved for the handshake proof, and data starts at one. Frame type,
  addresses, session ID, and counter are authenticated as AEAD associated data.
  The 96-bit IV is four zero bytes followed by the big-endian 64-bit counter.
  Its uniqueness is scoped to the fresh directional key, not to the entire
  application. DATA accepts counters 1 through 2^64-1 inclusive; the following
  value is rejected before AES-GCM. BigInt itself never wraps, whereas writing
  an unchecked value through DataView would truncate it modulo 2^64. This is
  an encoding/nonce bound, not a recommended unlimited key-usage budget.
- Data frames are also signed by the sender's existing identity key. Only
  encrypted `MAE v1` frames are accepted; legacy plaintext frames have no
  fallback path. Reconnection discards the old state and starts a new session.
- Current transport provides ordered, reliable delivery. A later unordered
  transport requires explicit reordering and bounded replay-window design;
  this implementation must not simply be plugged into such a transport.
  ChatService also serializes authenticated receives per peer: SecureSessions
  must not be called concurrently on the same peer outside that orchestrator.

## Limits

- The signaling service and relays can still observe connection metadata,
  Account IDs, message timing, and ciphertext length; they cannot be prevented
  from delaying, dropping, or replaying handshake attempts to cause denial of
  service. A live session rejects duplicate or out-of-order data counters.
- This is **not** Double Ratchet. Compromise of a live session's symmetric key
  can expose other recorded messages from that same connection. Ephemeral ECDH
  private key references are released after handshake, but JavaScript cannot
  guarantee physical memory zeroization.
  Ephemeral ECDH provides the basis for forward secrecy of recorded, completed
  wire sessions against later identity-key compromise, assuming trustworthy
  code/RNG and that the old session secrets are no longer available. No
  post-compromise recovery is provided, and garbage collection is not evidence
  of physical zeroization.
- The local chat archive is unchanged: its AES key is still derived from the
  identity seed. A seed plus a copy of that local archive can decrypt history.
- The browser must execute trustworthy application code. A malicious or
  compromised client build can read plaintext before encryption or after
  decryption, regardless of the wire protocol.
- This protocol has no offline delivery, multi-device session management,
  identity-key revocation, or independent cryptographic review yet.

## Wire format

Every inner frame begins with bytes `4d 41 45 01` (`MAE`, version 1), then one
type byte: `1=hello`, `2=welcome`, `3=confirm`, `4=ack`, `5=data`. The next 16
bytes are the session ID. Hello and welcome carry ephemeral public keys;
welcome also carries SHA-256 of hello. Confirm and ack carry AEAD proofs. Data
carries an unsigned 64-bit sequence number followed by AES-GCM ciphertext and
tag. The existing `TransportMessage` envelope contains the sender public key,
signature, sender and recipient Account IDs, timestamp, and message ID.

The original local-history format and key derivation are deliberately not
changed by this feature.
