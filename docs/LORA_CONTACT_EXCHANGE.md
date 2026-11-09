# Radio contact exchange in ordinary chats

Available in app release 0.5.1. The initial 0.5.0 release did not include this flow.

## Connecting two accepted contacts

1. Both users connect a Meshtastic board and select compatible radio networks.
2. In the existing Automesh chat, the first user selects **Attach → LoRa**
   (antenna icon). The signed public card uses the existing encrypted IP/node delivery.
3. The recipient selects **Connect and send mine**. Automesh verifies the account
   signature and selected network, saves the route, and queues its own card as a
   correlated reply in the same chat.
4. The first user accepts that reply automatically only when it matches an offer
   actually sent by this local profile and its currently active receiving key.
   An unsolicited, forwarded or history-imported card never silently grants a route.

The follow-up stability patch permits a verified, correlated response to update
an older route for that same peer. Concurrent acceptance of an identical card
does not reset its pending transfers. See LORA_BLUETOOTH_STABILITY.md for recovery
and multiple-conversation checks.

Each party still needs the other's public receiving key and radio address. One
manually sent invitation is enough when the ordinary chat can carry the reply;
the second exchange is automatic. With no existing communication path, exchange
the QR/text in both directions as before. This feature does not send a large
contact card over LoRa or change firmware channel keys, frequencies or presets.

The current public radio contact is also available in **My profile**, with copy
and QR controls. It expires after 24 hours and includes no seed, channel PSK or
private receiving key. It is a local profile surface, not a public discovery registry.

## Chat controls

The delivery button to the left of the composer opens **Delivery: node and LoRa**:

- Node status, key budget and node settings.
- Selected board and its connection state.
- **Use LoRa in this chat**, saved per conversation. It can always be switched
  off; enabling requires an accepted contact, connected board and valid route.
- Last received LoRa link quality and reception time, with RSSI/SNR/hops on
  expansion. This is a past measurement, not a live availability guarantee.
- Radio settings and sharing the current radio contact in the chat.

The composer no longer has a separate send-settings line or LoRa checkbox.
Hold Send for ephemeral-message settings. The left delivery button changes to
an antenna when LoRa is selected. No additional RF probes are made for quality.

## Confirmation handling

Optional `Routing.ack_proof` metadata is compatible with recipient-board ACKs;
route discovery, local echoes, unrelated senders, MQTT and malformed extensions
remain excluded. The firmware-level board status does not become a signed
application receipt. A delayed complete ACK for a previous attempt of the same
ciphertext may still confirm board reception; incomplete attempts are never
combined. Application delivery still requires saving the message and verifying
the account-signed receipt.

The LoRa queue dialog is rendered beside the account header, outside its
collapsible/inert network panel. Closing the network panel cannot disable the
dialog's close button.
