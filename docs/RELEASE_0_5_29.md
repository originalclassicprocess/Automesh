# Automesh 0.5.29

Private group posts bind the app signature to their MLS epoch. Clients check
the authenticated MLS sender against the author, including when reading
compatible older messages.

A group member can relay an existing encrypted post through its configured node
to another eligible member after exchanging courier keys as accepted contacts. The queue continues with additional one-time keys
when available. Pending messages on a page no longer block later group messages
from being downloaded.

The message route panel shows the receiving route or the available delivery
evidence for each recipient. Older history may not have route information.
