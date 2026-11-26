# Automesh 0.5.30

Sending a group message wakes connections for that group. A history sync
requested during an active replay is processed after that replay. Group
membership and MLS epoch checks apply throughout.

The node delivery queue prepares group messages before personal attachments
and processes text before attachments in each outgoing batch. File transfers
yield between batches, and polling uses available slots for other authorized
nodes when a source is busy or waiting for its next check. Delivery diagnostics
show when the node confirmed storage and when each file transfer first made
progress.

Chat sizing accounts for the visible viewport offset when the mobile keyboard
opens. Media previews wait for the local file to be saved and can retry a
failed image when opened. The storage manager shows a cover for sticker packs
that have a valid local archive.
