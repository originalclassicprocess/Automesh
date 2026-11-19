# LoRa chat layout, forwarding and Bluetooth recovery

## User-visible changes

- The native Meshtastic selection bar is inside a non-growing horizontal row.
  It no longer competes with message history for vertical space. Empty channels
  do not expose message selection. Shared selection actions keep their existing
  eligibility rules and plain ellipsis.
- Both forwarding choosers use recent message activity across their eligible
  destinations, rather than contact insertion order. Empty histories follow
  active chats; ties keep their existing relative order. Edit, reaction and pin
  controls do not promote a conversation. Sorting does not mutate stored history.
- Ordinary destinations display their existing local photo, falling back to the
  account identicon. Native channel destinations retain a radio avatar. Search
  also matches account IDs. Full IDs remain available in the contact chooser;
  long rows truncate visually rather than stretching the dialog.

## Bluetooth lifecycle

The transport uses the same Meshtastic acknowledged-write PhoneAPI and signed
application messages as before. There is no iOS-specific alternative protocol.

- Cancelling/locking releases callers waiting for native GATT operations, without
  waiting for a stalled write's timeout. Pending device-level operations remain
  serialized until completion or their existing bounded timeout, so a reconnect
  does not overlap a still-finishing operation.
- A connect promise that completes after cancellation or timeout releases its
  connection when no newer session owns the device. Old cleanup cannot disconnect
  a newer session.
- A failed write invalidates the connection and readable stream. The application
  cannot keep presenting that board as ready while its writer is already broken.
  Native chat retries still require the existing explicit action and duplicate
  warning; this change does not automatically replay native messages.
- Plain native-bridge error objects receive bounded error codes. Read/write,
  permission and unsupported-write failures have localizable explanations rather
  than exposing native text or generic `radio_operation_failed` for those cases.

No changes to courier nodes, cryptography, receipt meanings or persistence schema.
No additional RF probes. Existing wake-time checks and notification renewal remain.

## Verification and limits

`bluetooth-port.test.ts` covers timed-out and cancelled connection completion,
ownership of replacement sessions, interruption of a hung write, failed-write
readiness, plain bridge errors, legacy acknowledged writes, notification recovery,
configuration exchange and independent boards. Forwarding order has unit tests.
Isolated browser fixtures check the actual native channel and both forwarding
dialogs at 390px and 1100px, including photos, identicons, empty history, action
eligibility and layout size. Fixtures use synthetic data and remain local.

Bluefy on a physical iPhone still needs acceptance testing: initial connection,
send/receive, app lock/unlock and phone sleep/wake, then send/receive again. These
code-level fixes do not establish the cause of every observed iPhone failure or
guarantee a browser connection while iOS suspends the page. Ordinary iPad network
slowness is outside this change. No deployment is performed by these checks.

Primary references: [Bluefy connection guide](https://bluefy.app/guide.html),
[Meshtastic PhoneAPI](https://github.com/meshtastic/meshtastic-sdk/blob/main/docs/protocol.md).
