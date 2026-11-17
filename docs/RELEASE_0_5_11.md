# Automesh 0.5.11

- Store identical PNG, WebP and GIF stickers once per profile across packs and
  messages. Reuse verified recipient content by hash where the optional encrypted
  cache exchange is available; misses and older clients retain normal delivery.
  Courier receivers can also reuse a verified local copy without fetching chunks.
- Browse a received pack in chat, add it to the library, or send an individual
  sticker directly. Pack cards show overlapping sticker previews. Completed
  request/send actions no longer leave duplicate action buttons in history.
- Put creation/import controls above the library, select packs by name and cover,
  and edit names, contents and covers without deleting stickers used by messages.
- Add Emoji / Stickers / GIF modes to the main composer's smile button. Stickers
  start with favorites; installed packs remain available in a horizontal selector.
- On phones, switch between the browser keyboard and the custom panel, with the
  message field above either one and an explicit keyboard button. Sending does
  not close the panel. Apply the same input switching to linked-device and LoRa
  chats; desktop layout keeps the panel above the composer.

Storage migration uses database version 3 to prevent old tabs from dropping new
media references. Close older tabs if asked. Existing readable sticker copies are
migrated only after an atomic save; missing/corrupt copies are not deleted. Full
backups share canonical blobs; device history uses portable file copies.

This is byte-identity deduplication, not visual similarity matching. Complete
sticker-pack ZIP attachments are still transferred as complete archives. Ephemeral
files are excluded from reuse. No node update or LoRa file transport is included.

Validation includes shared encrypted storage, migration/backup/history, optional
cache exchange and fallback, courier receipts, input mode/viewport transitions,
mobile-size UI checks, types, translations, production build and offline shell.
Native phone-keyboard behavior still requires device acceptance testing.

Dependencies and the explicitly reviewed remote-function audit applicability gate
are unchanged from 0.5.10; see docs/DEPENDENCY_SECURITY_2026-11-17.md.
