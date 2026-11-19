# Chat viewport and touch selection

The viewport controller is presentation-only. It does not write messages,
delivery state, read receipts, encrypted storage or transport queues.

- Follow the end while the user is already within 24 pixels of it. Reading older
  messages keeps the visible message and its offset stable when media above
  changes size, messages arrive, or the viewport changes height.
- Remember up to 32 chat positions in the unlocked profile's memory using IDs
  and offsets, with adjacent anchors as deletion fallbacks. Lock and profile
  changes clear the cache and invalidate queued callbacks. No positions or
  message contents are stored on disk by this controller.
- The compact down button counts newly appended incoming messages below the
  current view. Outgoing messages, delivery updates and older history backfill
  do not increment it. Reaching the messages clears this viewport count; it
  does not issue a read receipt or change delivery status.
- Observe each current row's size and remove observers for deleted rows.
  Anchor lookup during scrolling measures logarithmically in the history size.
- A stationary primary touch held for 450 ms begins message selection. Motion,
  scrolling, cancellation, blur and another finger cancel a pending hold.
  A short photo tap keeps opening the photo; the release after a selection hold
  cannot open it or immediately deselect the message. Links and other controls
  keep their own interaction. Global gesture listeners exist only during a hold.

Local validation: 75 focused viewport/gesture/interface/selection/composer,
ephemeral-message and file-queue checks passed. Real isolated Chromium views at
390 and 1100 pixels verified media resize anchoring, arrivals, chat return,
touch hold/release, and chat toolbar alignment. Types, core types, translations,
production build, PWA shell and local production/signaling checks passed.
These checks use synthetic content, not real account history or production
queues. Native phone acceptance and deployment are not claimed.
