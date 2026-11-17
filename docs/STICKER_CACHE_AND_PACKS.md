# Sticker cache and pack library

This change is local development work after 0.5.10; it has not been published or deployed.

## Storage and migration

PNG, WebP and GIF stickers/GIFs are identified by SHA-256 of their exact bytes.
Within one profile, packs and messages reference one encrypted media asset with a
random storage UUID. Names and pack membership do not change content identity.
Different encodings of the same picture remain different assets. Image metadata
cleaning and disappearing-message rules are unchanged; ephemeral media is never
put in this reusable cache.

On unlocking, existing readable sticker copies are gradually linked to a shared
asset. Metadata and new bytes are saved in one IndexedDB transaction before old
per-message copies are removed. Missing/corrupt copies are left alone. The database
version is 3: older clients must close their tabs and update, rather than write
history that drops the new references. A full backup includes each canonical
asset once; device-history transfer materializes portable message files instead
of exporting another device's local storage UUIDs.

Library edits and cache writes share one serial queue. An edit is rebased onto
concurrently received assets, preserving their storage UUIDs and message references.
Removing a pack or clearing unused cache does not delete bytes used by a live
message. Existing storage limits still apply; a full optional cache falls back to
ordinary attachment storage/transfer.

## Optional transfer shortcut

For accepted contacts, a new client may send an encrypted `media-cache` probe over
the existing online-introduction channel. It contains a single file offer and a
fresh challenge, not a cache inventory. A hit is acknowledged only after verified
bytes and the recipient's message reference have been saved. Replies are bound to
the peer, request and message. Limits, timestamp checks, a two-second timeout and
one attempt per message bound the extra work. A missing route, old client, cache
miss or storage failure retains normal delivery.

Direct offers and courier manifests also check verified local content before
requesting chunks. Courier jobs and manifests retain their signature checks,
normal completion and signed receipts. No node protocol or node update is needed.
This does not introduce binary transport over LoRa.

Pack ZIP messages remain ordinary downloadable attachments and are transferred
as complete archives; this is not a delta protocol for entire packs. Their
imported stickers share library assets across packs and messages.

## Pack interface

The library has creation/import controls at the top and a horizontal pack selector
with first-sticker covers. Only the selected pack's stickers appear below. Packs
can be renamed, extended, reduced and given another cover. Content/order/name
changes produce a new immutable pack ID; up to 32 previous IDs remain local aliases
so older requests can be answered with the current pack. Reply references also
mark a request as answered if the pack changed.

A ready pack attachment shows up to four overlapping covers and opens a popup
with all stickers. The popup supports adding the pack and sending an individual
sticker directly. Request/send buttons derive their completed state from saved
chat history rather than temporary UI flags.

The main chat composer's smile button opens Emoji / Stickers / GIF modes in the
same inline panel. Entering Stickers starts with favorites from installed packs;
the horizontal selector switches to any installed pack. GIF mode uses the local
GIF collection. Both send through the existing attachment/library path, including
cache reuse and normal delivery. Library management is reachable directly from
the panel. Other users of the emoji-only component retain their existing behavior.

## Validation

Regression coverage includes shared encrypted storage, account isolation, backup
and device history, old-reader exclusion, pack identity/aliases, stale-edit rebasing,
cache challenges and fallback, and cached HTTP/relay courier receipt completion
without chunk requests. Mobile-size UI checks use isolated disposable fixtures,
not a signed-in user profile. Temporary review routes are removed before builds.

Final local validation on 2026-11-17: 210 suites / 1,393 tests passed; Svelte
reported zero errors and warnings; core TypeScript and both translation catalogs
passed; production build, service-worker shell and production HTTP/signaling smoke
checks passed. A pre-existing offline-relay test was made deterministic by waiting
for the sender socket's processing barrier before connecting its recipient.
