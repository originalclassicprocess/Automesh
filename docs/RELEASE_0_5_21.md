# Automesh 0.5.21

This release brings the [experimental private MLS groups](https://github.com/originalclassicprocess/Automesh/releases/tag/v0.5.20)
to managed hosting. The deployment package now excludes overrides that
apply only to build dependencies.

Open **Private groups** in the chat list on a trusted device and invite up
to nine accepted contacts. The roster is fixed. Messages travel between
participants over WebRTC, and an online participant can provide missed
messages when the original author is offline.

A shared, enabled signaling endpoint helps participants connect even when
their delivery nodes differ. Direct QR pairing works as the connection
option when there is no shared signal. The prototype keeps its bounded
group cache on participants' devices.
