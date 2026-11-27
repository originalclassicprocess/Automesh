# Automesh 0.5.33

Group chats automatically receive batches of attachments while the app is
open, including when the recipient is on the chat list. The attachment
layout keeps portrait and landscape photos within the conversation on
narrow screens. Offline receiving continues to use the existing encrypted
node queues and their per-recipient limits.

New group messages record which posts the author had already received.
These posts appear before the new message even when device clocks differ
or history arrives later. Independent messages sort by sender time and
message ID. The displayed timestamp remains the sender's time.

Groups share the message menu, selection toolbar, status display and emoji
button with personal chats. Forward text or fully received attachments to
one or more accepted contacts or groups. Select messages to download them
together. A group attachment's caption stays with the original message when
the file is forwarded to a personal chat. Tap an author's name to open their
profile. Signed nickname updates can travel with new group messages.

The group status shows a confirmed copy in green, an active search or
transfer in yellow, and an unsent item in red. A partial confirmation shows
a count. Tap the status or use the message menu to see separate counters for
the attachment card, file, and read receipts, plus known delivery routes.
For an attachment, a green confirmation requires the full file. Each node
storage confirmation still applies to an individual recipient.
