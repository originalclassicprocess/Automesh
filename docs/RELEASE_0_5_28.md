# Automesh 0.5.28

Group replies follow their originals even when the devices disagree on time.
Message times stay as sent. Each message shows the number of direct replies in
the available history. Enter and the send button submit through the same path.

New text and replies can use the configured sender node when a member has not
confirmed direct delivery. Both clients must support group node delivery and
must have exchanged courier keys as accepted contacts. The node stores an
encrypted envelope per recipient, under the existing queue policy. A recipient
can use the sender's published queue grant without a node of their own. Clients
keep the usual direct group synchronization for membership and key changes.
