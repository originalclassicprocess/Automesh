# Chat UX and disappearing content — 0.3.8

## Controls

Opening a chat without unread messages anchors to the end, including late media/viewport resizing. Actual unread rows retain their initial position. Scrolling into history disables bottom anchoring. A down button appears with 12 rows below the viewport. Text/date search uses local calendar days and local ordinary text/file names; its arrows jump inside the chat, not the surrounding page.

Double-click/double-tap non-interactive message content enters selection; links/buttons/media retain their actions and touch drags are ignored. The existing selection button remains keyboard-accessible. Batch download checks the entire selection before starting; failure retains selection. Selection closes after handing downloads to the browser, which cannot report successful disk saving and may require permission for multiple downloads.

The emoji picker inserts at the caret/selection inside the composer. Other buttons retain their positions. The paperclip is an SVG. Chosen/pasted/dropped files are staged until Send; each successfully queued file is removed separately to avoid duplicates on partial failure.

## Optional expiration

Ordinary sending is unchanged by default. Hold Send for 500 ms, use its context menu, or choose Send options above the composer. The policy applies to the next composer send, voice recording or library media, not protocol controls/contact cards. Successful sending or leaving the account/chat resets it; reselecting the same chat does not. A partly failed attachment batch retains remaining files/options.

Choose duration after **first explicit opening**, maximum openings, or both (earliest limit wins). UI durations: 10 s, 1 min, 1 hour, 1 day, 7 days. Counts: 1, 3, 5, 10. Protocol bounds: 5 s–7 days, 1–20 views. Download is disabled by default. No-download previews support images/audio/video; generic files need download permission. All disappearing content is excluded from forwarding and automatic library saving.

Arrival, scrolling, thumbnail loading and automatic file download do not consume a view. File integrity is checked before opening. The count and encrypted opening report are saved **before** showing content; failed storage does not reveal it. A crash/interruption after that commit may consume a view without completing display (fail-closed trade-off). The last allowed viewing session stays visible until closed/backgrounded or its timer expires. Sender previews do not consume recipient views; opening in Saved does consume a view.

Timers use persisted absolute device time and continue across application closure. The sender's copy retires after receiving the recipient's authenticated encrypted opening report, which may be delayed without connectivity. Opening reports are sent independently of ordinary read-receipt preferences; the options window discloses this. Counts currently belong to a receiving installation, not a globally authoritative server or identity counter. Additional-device synchronization remains paused and rejects protected content rather than displaying it without policy.

## Protocol and storage

- Protected text/open reports use encrypted `mesh-chat-v3`, direct file offers `mesh-file-offer-v2`, courier manifests `automesh-attachment-v2`. Ordinary content versions, E2EE and node packet formats remain unchanged.
- **Both clients must update.** Old clients reject/ignore protected versions, never silently downgrade to ordinary content. This first stage does not negotiate an explicit capability: an old receiver can leave a protected send pending. The UI warns about compatibility. Nodes cannot decrypt these content versions and do not need an update.
- Policies/reports are authenticated encrypted content, not unsigned UI hints. Only recipient reports matching an outgoing protected message affect the sender's state. Reports merge by maximum count/earliest first-open time, preventing rollback/restart by reordered copies. Controls are hidden from rows/unread counts.
- Expiry redacts to a tombstone, retires local outgoing courier jobs, persists redaction, then deletes encrypted local file records and clears session buffers. Cleanup failure retries while content stays hidden. Deleted IDs prevent repeated offers/messages from resurrecting content. A current final view holds only a temporary display copy and releases it on close/background/lock/account change.
- New full portable backups exclude all disappearing bodies/files and opening reports. Search, conversation previews, quotes and ordinary transcripts do not expose bodies. Explicit external downloads are outside this lifecycle.
- Relay ciphertext still follows normal receipt/retention rules. Expiration is not an immediate, provable remote deletion request to every possible relay or external copy.

## Honest limitations

This is cooperative client-side expiration, **not DRM**, secure-erasure proof, remote wipe or protection against a modified recipient. Screenshots, recording, developer tools, altered clocks, OS/media buffers, independent same-seed installations, disk snapshots and externally saved copies cannot be controlled. A recipient can withhold an opening report. No new cryptography or independent security-audit claim is introduced.

## Verification

Unit coverage includes strict policy/control validation, version isolation, protected manifests, monotonic reports, timer boundaries/persistence, redaction, export/backup exclusion, unread filtering and local-date search.

```powershell
node scripts/test-device-live.mjs <playwright-node-modules> --chat-ux-only
node scripts/test-device-live.mjs <playwright-node-modules> --ephemeral-courier-only
node scripts/test-device-live.mjs <playwright-node-modules> --ephemeral-courier-only --home-node
node scripts/test-device-live.mjs <playwright-node-modules> --primary-only
```

The chat fixture checks end/resize anchoring, jump/search, selection/download reset, caret emoji insertion, light/dark widths 320/390/1920, protected text/count/timer/reload/image and ordinary delivery before/after. Courier fixtures close the sender before receipt, queue return open reports offline, reopen the sender, and inspect durable redaction/file deletion. These are synthetic Chromium fixtures, not manual iPhone/Android or real NAT/network testing.
