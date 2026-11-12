# Automesh 0.5.7

Fix online introductions that reached the signaling server but stalled before contact acceptance. Version 0.5.6 encoded encrypted introduction frames as unpadded Base64URL, while the existing signaling contract requires padded standard Base64. The server rejected those frames as `invalid_introduction`; an open-only server probe did not detect this client encoding defect.

The client now explicitly encodes and validates the signaling format. Regression tests apply the real server validator to every frame in the signed/encrypted introduction exchange and reject mailbox-style URL encoding. A complete exchange using temporary client identities against deployed signaling was verified after the fix, rather than checking only the unencrypted opening packet.

Existing contacts and messages need no reset. The server/node protocol, its limits, signature verification, encryption, consent requirements and existing ordinary delivery paths are unchanged. Nodes 0.4.18 already accept the corrected format; no node update is required.
