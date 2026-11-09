# Voice message recording and notices

Published to https://automesh.space on 2026-10-10: `v0.2.5-562cee747a684d2d`.

- One click starts recording. The text composer is replaced by a full-width compact strip: discard, actual duration, optional measured microphone level, square stop. Text drafts are preserved.
- Stop and the 5-minute limit both open a local review; neither auto-sends. Microphone tracks and optional Web Audio analyser close immediately. Preview supports native audio controls, discard and explicit send. Recording remains capped at 5 MiB.
- Confirm queues the same ordinary voice attachment through existing encrypted storage/delivery. Failure keeps the preview for retry. Repeated confirmation is blocked. Success means queued, never a delivery/read acknowledgement.
- Voice capture and review block ordinary chat/profile navigation. Lock/logout/disposal discard temporary audio and release object URLs. Hidden pages interrupt capture without sending; a completed review stays local until the account is closed. Background MP3 playback is paused during capture/review.
- Record and permission callbacks have generation guards. A stalled stop fails after 10 seconds; canceled late permission responses have their tracks closed and cannot restart capture.
- Permission denial, absent microphone and unsupported recorder have short notifications (7 seconds) with optional details. Known success confirmations expire after 3 seconds. Details/focus/hover pause expiry. Data loss, failed persistence, unknown errors and failed recording remain until dismissed or another explicit action clears them. Timers never mutate delivery or operation state.
- Notifications overlay the interface in a bounded stack instead of wrapping inside a 44px microphone column. Account authentication validation remains inline. No blanket timeout on all statuses; critical alerts remain visible.
- Codecs still use native MediaRecorder support, MP4 first where available, then WebM/Opus/Ogg. No external audio conversion or service. Physical iPhone behavior still depends on browser permissions and native media support; automated tests do not certify every device.

Also included in this release: avatar crop editor and compact routine direct-connection notices from the previous local iteration. Server node code/state is unchanged.

Validation: 729 application tests and 20 standalone node tests passed on Node.js 24; Svelte check had zero errors/warnings; build and production smoke checks passed. Transactional deployment and independent public checks confirmed the exact release, HTTPS/health, both WSS endpoints and unchanged node identity. No test messages or real profile mutations were performed. This is not a physical iPhone recording certification.
