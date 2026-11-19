# Automesh 0.5.13

- Keep the visible message anchored while earlier media resizes. Restore recent
  chat positions within the unlocked profile. Incoming messages no longer pull
  readers out of history; the compact down button counts new incoming messages.
  Search can return to its original anchored position after a match jump.
- Select a message with a stationary touch hold. Scrolling, movement and another
  finger cancel the hold. Its release cannot open an attachment or deselect the
  message. Subsequent taps use the existing full-message selection overlay.
- Center the notification bell in a matching 44-pixel chat control. Remove the
  accordion marker from chat toolbar controls and hide unavailable bulk actions,
  empty counters and selection controls in an empty conversation.
- Expand an attachment draft to inspect local media, remove a file or change the
  queue order. Keep accompanying text in the existing composer; sending remains
  an explicit action using the existing attachment queue, followed by that text.
  Remove the persistent explanatory line above attachment drafts.
- Filter local chat search by images, video, audio, attachments or valid HTTP(S)
  links, combined with text and date. Searching does not fetch link previews or
  reveal disappearing content.
- Offer six reactions and author-only plain-text editing after authenticated
  support negotiation. Incoming supported updates can also establish support.
  Saved messages work locally. Updated linked-device clients display the result;
  they retain their existing restrictions on actions performed for the owner.

Edits and reaction changes are authenticated encrypted v4 application events in
the existing delivery queue. Their original message IDs, file bytes, receipts and
delivery state are not rewritten. Originals remain in encrypted history; editing
does not erase a recipient's prior copy. A participant can edit only their own
plain text and replace/remove only their own reaction. Disappearing content,
files, forwarded claims and radio messages are excluded from text editing.
Revision ordering and deterministic ties handle retries and out-of-order events;
updates arriving before the original can apply later. Deleted originals cannot
be recreated by update replay. A manual retry cannot roll a newer update back.
Updates do not inflate unread counters or send ordinary new-message push alerts.

Both clients need the updated app for reactions/editing. Older decoders ignore
the new application payload instead of displaying an empty chat row. Feature
negotiation is scoped to the unlocked session; retained authenticated update
events also establish prior support. Original queued payloads remain immutable
for exact-ID retry; copy/forward/download/search use presented edited text.

No node release, node configuration change, dependency update or storage schema
migration is included. Existing nodes carry opaque encrypted events unchanged.
Deploy the verified app package using the existing backup and rollback workflow.
Rolling code back does not erase originals or queued update events; use updated
clients again to display/process those events.

Validation includes the full app/server suite (1,487 passing tests before the
final retry/normalization cases), targeted follow-up checks, real authenticated
node restart/delivery of updates and later ordinary text, secure-session tests,
history normalization, browser fixtures at 390/1100 pixels, types, translations,
production build and PWA/server checks. Isolated browser fixtures cover attachment
ordering/removal and draft retention, search filters, reaction toggling, editor
save/failure retention, scrolling and touch selection. Native phone acceptance
and real-user data are not used for automated checks.
