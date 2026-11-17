# Automesh 0.5.10

Release audit notes: SvelteKit 2.70.4 remains at its reviewed version. Two new
experimental-remote-function advisories are explicitly assessed as inapplicable
only while that feature is disabled and no remote modules/API references exist.
All findings remain reported; unknown moderate/high and all critical advisories
block publication. See docs/DEPENDENCY_SECURITY_2026-11-17.md. A Kit 3 migration
is separate work, not silently included in this release.

- With an enabled delivery node, notify only after attachment chunks and the final
  encrypted envelope are committed. Without a node, alert immediately that the
  sender is attempting delivery. A push never confirms message delivery.
- Mute an accepted chat for 1 hour, 8 hours, 24 hours or indefinitely using the
  chat-header bell. Preferences belong to this profile on this device and remain
  in encrypted local storage. The provider stores only contact/expiry rules so
  muting works with the browser closed; offline changes show a pending warning.
- Suppress pushes for the currently focused chat, with a 25-second expiring
  foreground lease. Other chats still alert. Existing per-contact burst
  coalescing remains bounded to a minute. Browser permission and provider errors
  are distinguished. A test notification remains available in settings.
- Cancellation removes matching pending provider/node retries, including delayed
  wakes arriving after cancellation. A push already handed to the browser's push
  service cannot be recalled.
- Selection supports downloading available messages/files in one ZIP (64 MiB
  input limit), resuming pending sends, explicitly sending completed/stopped
  messages as new copies, and canceling unfinished file/node transfers.
  Unsupported or failed entries remain selected. Receipts are rechecked for each
  action. Existing copy, forward and local delete remain available.
- LoRa channels allow confirmed bulk retry of failed outgoing messages. Packets
  already sent over radio cannot be recalled; retry can create duplicates.

Node 0.4.20 enables autonomous signed notification wakes on home nodes. Publish
installers without modifying existing home installations. Updating the web app
alone provides the fallback only while the sender remains open.

Validation covers upload ordering, no-node attempts, mute expiry/device isolation,
foreground lease expiry, signed cancellation, persisted node retries and mixed
selection eligibility. Actual background receipt still depends on browser/OS
permissions and requires device acceptance testing.
