# Automesh 0.5.20

## Experimental private groups

From a trusted device, open **Private groups**, create a room and select up
to nine accepted contacts. The roster is fixed, with one device per Mesh ID.
Each invitee accepts before the encrypted room opens. The client authenticates
MLS credentials against Mesh IDs and keeps group state in the encrypted local
profile, outside portable backups.

- Text uses MLS and is carried on authenticated WebRTC channels. Delivery
  nodes are optional for personal chat and have no group message queue.
- Direct peers can forward the same encrypted packet. The group reconciles
  recent messages on connection, on request and periodically while open.
  Up to 128 recent records are retained per participant. A recipient receipt
  confirms local storage by that participant.
- Mixed delivery node setups use the same allowed application signal for
  discovery. With custom-only or LAN-only routing, peers need a common
  reachable signal or direct QR pairing. Network preferences still apply.
- If the author is offline, another connected participant can serve a copy.
  When every holder of a missing message is offline, the group waits for one
  of them to return.

This first implementation uses a fixed MLS epoch after admission and has no
member changes or periodic rekeying. It is intended for functional testing.
