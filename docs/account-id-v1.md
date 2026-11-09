# MeshAutonomy Account ID v1

This is a MeshAutonomy account identifier, **not** a Reticulum destination,
device identifier, network location, or proof of a person's legal identity.
Contacts and local conversations belong to an account ID. Future device and
transport addresses must be attached to an account separately.

## Deterministic account key

1. Generate a 12-word English BIP-39 mnemonic (128 bits of entropy), or import
   one. The BIP-39 optional passphrase is currently empty.
2. Derive the 64-byte BIP-39 seed.
3. Compute `identitySeed = SHA-256(seed || UTF8("mesh/identity/v1"))`.
4. Use the 32 bytes as a P-256 ECDSA private scalar. In the exceptional case
   that the scalar is zero or not less than the P-256 curve order, replace it
   with `SHA-256(previousCandidate)` until it is valid.
5. Export the P-256 public key in WebCrypto's 65-byte uncompressed form:
   `0x04 || X[32] || Y[32]`.

This is **not** BIP-32 or a cryptocurrency wallet derivation path. Do not import
a mnemonic protecting real financial assets into this application.

## Account ID encoding

1. `domain = UTF8("MeshAutonomy/account/v1\0P-256\0")` (the `\0` characters
   are literal zero bytes).
2. `fingerprint = first20(SHA-256(domain || publicKey[65]))`.
3. `payload = 0x01 || fingerprint[20]` (the first byte is the address version).
4. Encode the 21-byte payload using Bech32m with human-readable prefix `mesh`.
   The text is lowercase and exactly 45 characters long, starting with
   `mesh1`. The `1` is the Bech32m separator, **not** the version number.

Validation requires the exact prefix, length, lowercase alphabet, Bech32m
checksum, version byte, canonical bit padding, and a 20-byte fingerprint.
After receiving a public key, recompute the ID and compare it to the claimed
sender ID. A well-formed ID alone does not prove possession of the key.

### Test vectors

- `fingerprint = 20 × 0x01` encodes as
  `mesh1qyqszqgpqyqszqgpqyqszqgpqyqszqgpqyhjxl32`.
- P-256 private scalar `1` has public key
  `046b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c2964fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5`
  and account ID `mesh1qxnhrv2f9p8ev4jyyqq9jsjw7pfwsurctgzfczmf`.

The initial test-only `r...` identifiers are intentionally unsupported.
