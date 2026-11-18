# Automesh 0.5.12

- Protect locked sessions with an encrypted in-memory recovery snapshot. Stop and
  drain admitted attachment work before clearing plaintext and media URLs. Retain
  an encrypted recovery copy and explain when durable saving fails; do not claim
  unsaved data is safely stored. Untrusted sessions remain unpersisted.
- Recover accepted file queues after disconnects and lock/unlock. Reserve the two
  receive slots before asynchronous cache/storage work and retain ownership until
  hash verification, storage and receipt. Old tasks cannot release newer slots or
  reset their buffers. Exact repeated chunks are tolerated; conflicting bytes and
  invalid hashes are still rejected. Courier and direct admission share the limit.
- Add a manual reminder to an interrupted sender when neither side has a node.
  A bounded capability is registered while the sender is online; clicking requests
  a generic return notification through the optional push provider. Permissions,
  a registered subscription and a still-valid pending transfer are required.
  Notifications never acknowledge a message or replace file delivery.
- Display chat mute using a crossed bell: gray for permanent/global disabling;
  red with 1H, 8H or 24H for temporary muting. Compact the transfer and attention
  indicators into adjacent areas while keeping their help and actions.
- Find contacts using a bare Mesh ID or complete contact URL, including local
  links and links with network parameters. Public HTTPS origins may supply the
  existing validated signaling hint; plaintext/local origins and arbitrary query
  parameters do not silently configure network access.
- Include optional pixel dimensions and nine approximate colors in encrypted
  image offers. Show a correctly proportioned placeholder before the photo arrives.
  PNG, JPEG (including orientation), GIF and WebP dimensions are supported. Palette
  decoding is bounded and optional; missing support never blocks file delivery.
  Disappearing images do not retain these hints. Original file bytes/hashes remain
  unchanged. Older clients can omit the cosmetic hint on retry.
- Replace repeated history-media searches with indexed lookup. Add informational
  raw/compressed build-size reports and reproducible large-history/sticker checks.

No node release, node configuration change, delivery wire format change or
dependency version change is required. The built-in app notification provider
must be updated together with the client. Legacy providers retain existing
delivery/notification behavior and may not support the new manual reminder.

Validation: application/core type checks, translation checks, 1,447 application
and server tests passed across the full run plus the restricted-network rerun;
one explicit performance benchmark remains opt-in. The queue test transfers 12
files through five disconnect/restore cycles without manual accepts, checking
every hash and the two-file limit. Browser push tests use a fake push sender;
they do not prove delivery by a live browser push service. Native phone behavior
and real push acceptance testing are not claimed.

See [lock invariants](SESSION_LOCK_SECURITY.md) and
[performance checks](PERFORMANCE_CHECKS.md). Deployment retains the prior release
and existing user storage; rollback switches the complete app package back.
Manual return tickets use the existing expiring metadata table, with no schema
migration or message/file content added to the provider.
