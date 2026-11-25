# Automesh 0.5.25

Private groups can update MLS membership while some remaining members are
offline. The administrator or designated successor commits the change.
Participants that have applied it can keep chatting.

The app sends signed membership updates to reachable participants and replays
missed changes in order when a participant reconnects. A participant that is
still catching up receives the key updates before the current group messages.
The removed participant receives no new MLS epoch secrets.

An isolated part of a peer-to-peer group can still use its previous keys until
it learns about a removal. Group membership changes are retained for catch-up
and older updates needed by remaining members are protected from being pruned.
