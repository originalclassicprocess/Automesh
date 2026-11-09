# Post-release local polish

Published with voice recording improvements on 2026-10-10: `v0.2.5-562cee747a684d2d`.

1. Avatar crop preview before upload is committed: zoom, mouse/touch drag, position sliders for keyboard users, reset and cancel. Original remains untouched. Closing or switching profiles cancels the preview load and frees its object URL. The thumbnail uses the selected square in the existing JPEG conversion, privacy filter, size limits and encrypted exchange.
2. Routine direct-connection messages (`Собеседник не ответил…` / `Сообщения ждут…`) no longer add a full-width paragraph above chat messages. Details and retry are in a compact info button in the chat header. Offline/connecting text remains visible. Details distinguish direct connection from delivery through a node. The status is available to screen readers. Input, send, storage and unknown errors remain visible alerts.

No transport, encryption, queue, retry or acknowledgement behavior changed by this polish. No profile registry photos or external services added. Interface scaling, broader icon unification and transition polish are separate future work.

Initial local validation: 717 automated tests, Svelte check (zero errors/warnings), build and local production smoke checks passed. The subsequent combined release passed 729 application tests and 20 standalone node tests, type/build/production checks, transactional deployment and independent public HTTPS/version/WSS checks. The earlier local build `v0.2.5-9ad353fbac4d4189` was superseded, not uploaded separately.
