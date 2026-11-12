# Automesh 0.5.6

Two online primary accounts can now exchange a secure first contact request and delivery keys through a shared, compatible signaling server when direct WebRTC is unavailable. Direct connections are still attempted first. Two independently sent, authenticated requests count as mutual consent; a one-sided request still requires acceptance.

The reserve uses separate short-lived encrypted sessions with signed domain separation, ordered processing, bounded frames and request-ID-bound acknowledgements. A delivery acknowledgement follows durable local saving. Locking, blocking and replacing a session invalidate pending work. A reconnect on either side can reopen the exchange without accepting unsolicited contacts.

Status text distinguishes an unsent request, sending, confirmed receipt awaiting acceptance and an unavailable or unsupported reserve. Signaling connectivity and this introduction path never pretend to be an open direct chat.

Ordinary messages, files, calls, Meshtastic and device authority keep their existing paths. This release does not introduce general-purpose chat relaying, offline invitations, TURN or node federation. After introduction, offline delivery still requires a usable node and verified keys. Two clients without a direct path or usable courier cannot exchange ordinary chat solely through this introduction service.

The signaling support is included in the app server and Automesh Nodes 0.4.18. The app uses only configured signaling addresses; no new official-domain defaults are added. Installed home nodes retain their current behavior until explicitly upgraded.
