# Browser receive compatibility — app 0.4.7

## Observed failure and scope

The reported iPad diagnostic already showed an accepted sender queue grant and a verified node envelope, but no saved message or receipt. This puts the failure after the HTTPS request and outer signature checks. It does not prove the exact native browser exception, which 0.4.6 hid behind a generic message.

The existing HPKE receive code deserialized the saved P-256 scalar through a private-only EC PKCS8 import. Some WebCrypto implementations, including WebKit configurations, reject this representation even though Chromium/Node accept it. The app already stores both public coordinates, so the receive paths now import the same key as a complete JWK. HPKE P-256/HKDF-SHA256/AES-256-GCM, ciphertext, signatures, stored key bytes and wire formats are unchanged. There is no plaintext fallback or key replacement. Existing queued envelopes can be retried with their existing keys.

The compatibility regression deliberately rejects private-only ECDH PKCS8 imports. It failed on the old path and passes with complete JWK import. This models the API limitation; it is not a claim that the owner's physical iPad has passed acceptance testing. Native errors are replaced by fixed safe diagnostic codes; no exception payloads, key material or message content are displayed.

References: the maintainer's cross-browser HPKE implementation report, https://github.com/panva/hpke/discussions/20 (Browser Reality Checks), and P-256 JWK/PKCS8 compatibility report, https://github.com/panva/jose/discussions/423. The actual dependency code was inspected locally in @hpke/common's Ec._deserializePkcs8Key.

## Queue failure isolation

Each remote envelope is still authenticated and saved before its receipt. An individual failure does not stop processing other entries on that page. If ANY entry fails, the previous cursor is retained, including on storage or receipt errors. The failed envelope remains on the node and is retried. Successful entries retain their normal durable receipts. This deliberately avoids advancing past a temporarily unsaved message.

The regression injects a failed first receive followed by a valid envelope and a nonempty page cursor: the valid envelope is acknowledged, the failed entry keeps its private key and receives no receipt, and the next poll uses the same cursor and completes the failed entry when storage recovers. A separate encrypted ChatService integration preserves the sender queue grant through JSON snapshot/unlock and verifies automatic polling without an own node.

Only the app needs updating on both hosted domains. Nodes remain 0.4.11; quotas, permissions, signaling and node-to-node routing are unchanged. Existing archives and hosted rollback backups are retained. The project owner should repeat the physical iPad scenario after updating the receiver; if it still fails, the new fixed diagnostic code identifies the next stage without exposing secrets. Do not erase the account, delete queued messages or replace keys as part of this check.
