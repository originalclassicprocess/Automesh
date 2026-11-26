# Automesh 0.5.32

Closed groups use the existing node file queue for encrypted attachments.
Once a node confirms storage of the file, a recipient with an updated client
can download it while the author is offline. The chat shows separate storage
statuses for the attachment card and the file. Both use the node's existing
limits and delivery permissions.

Group files retry automatically when a direct connection returns and
automatic downloads are enabled. A manual download request survives a client
restart. A file from 0.5.31 whose node only received its card still needs
the original bytes from a participant's device.

Groups reuse the chat media viewer, sticker-pack previews and native sharing.
Files can be dragged into the composer. Download and sharing actions are
available in the attachment menu and media viewer.
