# LoRa / Bluetooth recovery after 0.5.1

Included in app release 0.5.2. Hardware-specific recovery limitations below remain.

## Multiple conversations

One unlocked primary profile can hold routes for up to 16 accepted contacts on
its selected radio network. One board is active per profile. Multiple browser
clients on one computer can each use their own permitted Bluetooth board.
Conversation IDs, encryption recipients, receipts and receive queues remain
separate; transmissions share the board's airtime guard.

Signed, correlated replies to a locally sent current offer can replace an old
route. Forwarded, unsolicited or imported replies still require explicit action.
Concurrent acceptance of the same route preserves the existing radio session.
Reactive chat controls are refreshed only after installing the session, rather
than treating a saved route string as proof that the session exists.

## Connection state

Bluetooth permission, GATT connection, complete configuration and the running
account controller are separate stages. The chat is connected only after all
stages succeed. Settings and queue indicators use the same readiness state.
Checking configuration requires fresh node, LoRa and channel records; cached
records cannot make an incomplete response pass.

On foreground/focus restoration, Automesh renews local GATT notifications and
reads FromNum to check the link. These operations create no RF probes. Failure
closes the stale session, then recovery reuses the exact remembered device,
channel and unexpired account keys. The initial FromRadio drain waits until the
configuration request was written, avoiding a blocking empty read before setup.

The chat has a Restore connection button. A browser that does not retain device
permissions may still require the user to select the board; recovery never opens
a device picker without a user action. This does not promise background BLE
execution while iOS suspends the browser.

Firmware long/short names (including emoji), then the Bluetooth advertisement
name, supply automatic display names. Node IDs still identify boards; display
names never select hardware. Explicit user labels are preserved.

## Validation and remaining hardware check

Automated cases cover all six directed paths among three accounts, per-peer
receipts, restoring one account while its two peers have pending messages,
concurrent route acceptance, two independent BLE devices, missed notifications,
stale GATT objects, incomplete configuration, emoji names and encrypted storage.

The reported physical PC-to-PC failure has not been reproduced on the user's
boards. These tests verify software routing, not RF availability or Bluefy.
For the next hardware check, compare the actual local and peer board IDs, then
test each pair with all three clients present. After locking/unlocking the iPhone,
its chat and settings must show the same readiness and reuse the saved channel.
