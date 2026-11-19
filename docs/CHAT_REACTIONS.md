# Compact message bubbles and quick reactions

MessageCard exposes an optional adjacent reaction button, hidden during message
selection and disabled while the parent is busy. The primary chat supplies it
only for accepted, supported conversations and messages allowed by reactionAllowed.
The control does not add a reaction until an emoji is selected. Its dialog has
only a six-column emoji grid, with pressed state, keyboard arrows/Home/End,
Escape, backdrop dismissal and focus restoration. The root owns the target and
includes the chooser in the existing back-navigation and profile-reset lifecycle.

Message reactions and delivery status share a wrapping footer. Bubble padding,
inter-message spacing, heading controls and reply quotes are smaller. Long status
text can still wrap; status meaning, timestamps, reply references and file content
are unchanged. Reaction buttons remain outside the bubble without extending the
history's horizontal scroll area on narrow phones.

## Bounded protocol compatibility

`reactions.ts` is the single exact emoji allowlist for encoding, decoding,
projection and the quick picker. It retains all six existing reactions and expands
to 36 values, including negative reactions. Arbitrary strings, HTML, multiple
emoji and unlisted variants are not valid reactions. Removal remains emoji:null;
actor identity, per-actor revisions, replay handling and receipts are unchanged.

`sendMessageFeatures` continues advertising `\0mesh-message-updates-v1`, followed
by a signed `\0mesh-reactions-v2` capability. The latter is dispatched only as a
control, without a visible chat row or message receipt. Older clients ignore its
unknown prefix. Sending that additional advertisement is guarded against a changed
service generation or peer epoch.

The UI uses the six legacy choices until it has authenticated expanded support
from the peer (or a persisted incoming expanded reaction). Saved messages allow
the full local set. The sending guard applies the same choice restriction. Old
messages, original message payloads, courier storage, encryption, node software
and the persistence schema are unchanged. No deployment is part of this change.

## Validation

Unit checks round-trip and project all 36 reactions, exercise removal and invalid
metadata, and preserve original text and delivery state. Authenticated ChatService
checks cover the capability exchange and delivery of a negative reaction followed
by ordinary text. The complete app/server and node compatibility suites pass.
Local isolated browser checks exercise actual message and picker components at
320, 390 and 1100 pixels: compact footer, adjacent controls, negative selection,
toggle/removal, legacy choices, disabled/selection states, focus and dismissal.
