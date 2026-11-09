# Delivery status 0.4.8 / node capacity 0.4.12

Existing delivery paths are preserved. The courier now exposes ephemeral, per-message preparation, uploading and retry-wait phases. These phases are never saved/restored as live activity. A valid upload-start reply clears an earlier attempt error and starts byte progress, including zero and resumed uploads. Stored remains distinct from recipient-delivered.

Peer/signaling disconnect resets interrupted direct transfer presentation but preserves an independently active HTTPS upload. Successful queue HTTP access updates queue connectivity independently of signaling. Local preparation failures do not by themselves mark the node network offline.

The cloud separates automatic retry from action-required quota/access/storage failures. Its states rotate when several apply: green for upload/stored; yellow for action; red for expiry and cancellation in progress; neutral for user-canceled and automatic waiting. User cancellation and automatic expiry have separate counters and chat jump targets. Hiding notices preserves history and active delivery.

File and message quotas sit below the status counters, under the configured node hostname. Only personal usage is displayed; node-wide file counts, capacity and bytes are hidden. Unknown or stale quota remains explicitly unconfirmed. Authenticated node status adds optional actual message quota fields; no limit, routing, crypto or expiry setting changes.

Validation includes a real signed HTTP upload that fails once, resumes without the old error, reports uploading and finishes stored without falsely reporting delivered; signaling disconnect presentation; runtime-phase persistence exclusion; personal quota isolation, configured node limits, receipt retention and restart. Physical phone acceptance remains with the project owner.
