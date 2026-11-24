# Automesh 0.5.23

Group admission imports the P-256 MLS key with the public point required by
Apple WebKit's key importer. Existing invitations retain their original
group and key material.

Members can share the creator-signed MLS Welcome and relay encrypted group
messages while the creator is offline. For a group created before this release,
have the creator open the group once after updating while at least one other
member is reachable. That member can then help pending participants join.

The header shows the total membership and the device's direct connections.
Every message shows delivery and read counts for the other group members.
Read receipts are sent for visible messages when the account shares read
receipts. Members sync signed receipts when connections return.
