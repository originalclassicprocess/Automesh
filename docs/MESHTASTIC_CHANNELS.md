# Native Meshtastic channels — app 0.5.2

This feature is separate from Automesh personal chats. It uses the existing
USB or Bluetooth Meshtastic connection. No server deployment, MQTT bridge,
firmware update, channel configuration write or additional transport is included.

## Using it

1. Connect a configured Meshtastic board in LoRa settings.
2. Open **Meshtastic channels** in the chat list and enable channel reception.
3. Select one of the channels already configured on that board.
4. Send a short text. Its sender is the Meshtastic board, not an authenticated
   Automesh account. Other compatible Meshtastic clients can display it.

All configured channels can be received while enabled. The selection chooses
the outgoing channel; it does not change the channel used for personal Automesh
radio contacts. Channel indices belong to the local board. A board/network
fingerprint separates history when its channel configuration changes.

Hold **Send** (or right-click it) to open **Send options**. **Append my Automesh
contact** is a separate per-channel option, initially off. Its preview stays in
that dialog; the UTF-8 byte counter remains visible next to the composer.
It appends `[Automesh](current-contact-link)` using the current application's
origin, without hardcoded domains. Modern Meshtastic Android/Apple clients and
Automesh's native channel view display a clickable **Automesh** label; older
clients or board displays may show the literal Markdown. The full encoded URL
and formatting count towards the 200-byte limit. Other safe HTTP(S) Markdown
links received in these channels also display their label; personal Automesh
chats retain their existing plain-text rendering. No HTML is interpreted.
Everyone able to read that channel can also read the link. No PSK, private key,
seed or network invitation is appended. It does not auto-accept an Automesh contact.

## Delivery and limits

- Standard `TEXT_MESSAGE_APP` (port 1), broadcast destination, no all-recipient ACK.
  `want_ack` requests the firmware's standard broadcast reliability feedback.
- 200 UTF-8 bytes per outgoing message, including the optional contact link.
- No fragmentation, automatic broadcasting, bridge or automatic retries.
- Native and private Automesh sends share the existing local airtime scheduler;
  firmware retains its region, modem, retry and airtime constraints.
- “Sending” precedes queue acceptance. “Handed to radio” follows QueueStatus
  acceptance. “Delivered to mesh” requires the local firmware's correlated
  ROUTING_APP success (implicit ACK after hearing a rebroadcast).
  It does not prove reception by every participant, durable storage or reading.
- Explicit queue or routing failures retain their separate error namespace and
  code. Exhausted retries mean mesh delivery was not confirmed; recipients may
  still have heard the text. A late success can update that state.
- A local queue timeout remains unknown; reload never rebroadcasts historical messages.
- Duplicate incoming packets are identified by sender board and packet ID.
- Direct Meshtastic messages and MQTT-origin packets are excluded in this version.
  Outgoing packets explicitly opt out of MQTT upload. Existing board MQTT settings
  are not modified; Automesh does not control independent gateways elsewhere.

## History and privacy

Channel reception is off by default. Enabled reception stores the last 100
messages per channel in the encrypted local account history, bounded to 32
board/channel histories. Clear history affects only this application's copy.
Radio data is not removed from a board or from other participants.

Full and data-only backups retain native channel history without radio credentials.
Data import refuses to overwrite existing native channel messages. Device history
transfer continues to concern selected Automesh personal chats.

Names and board IDs are display metadata, not verified Automesh identities.
Default/public PSKs provide no confidentiality from other people who know them.
Custom channel PSKs are shared secrets, not per-recipient end-to-end encryption.

## MQTT later

A home or server node can run an MQTT client and connect to a broker. An actual
radio gateway is still needed to cross between the Internet and RF. Broker access,
per-channel uplink/downlink, encryption, loop suppression, deduplication, rate
limits and the consent to publish traffic need an explicit design first.

Reference: <https://meshtastic.org/docs/configuration/module/mqtt/>.
This patch does not activate that integration.

## Validation

Software checks cover native packet encoding, malformed input, UTF-8/signature
limits, Bluetooth PhoneAPI fixtures, MQTT/unicast filtering, channel/board
isolation, duplicate suppression, bounded encrypted history, backups and the
  shared scheduler with personal Automesh delivery, and correlated firmware
ACK/NAK without promoting remote claims to application receipts. The user
confirmed basic native-channel messaging locally before release. Device-specific
Bluetooth recovery and every third-party client's link rendering have not been
exhaustively tested on hardware.
