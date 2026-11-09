# Network recovery candidate · 2026-10-20

Status: 0.3.5 release candidate; no node upgrade or identity migration.
This is an implementation/regression report, not an external security audit or
a promise of universal delivery. Never include real account data in this report.

## Separate responsibilities

| Component | Responsibility | Does not imply |
| --- | --- | --- |
| Signaling | Discover peers and exchange connection setup | Message storage, receiving keys or device rights |
| P2P | Authenticated direct traffic while a working channel exists | Background execution on a locked phone |
| Courier node | Persist bounded encrypted jobs and return receipts | Administrator permission or a device authority |
| Device authority | Fresh signed membership/revocation policy | The ordinary outgoing courier is selected |
| Admin bookmark | Open the node control panel | Membership of its delivery queue |
| Backup | Recover identity and local user data | Recover old transport keys, jobs or current remote permissions |

The dashboard projects those states independently. It is not a new source of
authorization. Server/home groups use checked node metadata when known; the
address-based fallback for old entries is explicitly provisional.

## Corrected regression

0.3.4 direct discovery could announce an empty primary-only device roster.
Remembering it made an ordinary primary chat require a fresh owner response;
an offline recipient without a node directory then caused
`device_owner_unavailable`, before the ordinary courier path could run.

An authenticated empty direct roster is now only a discovery hint. An existing
primary uses ordinary delivery for it. Existing node-bound rosters, certificates
(including revoked/expired ones), or a disabled primary remain device-protocol
conversations. Lower sequences, conflicting same-sequence policies, removal of
known revocations and downgrade to an empty direct hint are rejected.

Only queued primary text UI records accidentally marked as device messages are
reconciled; IDs are retained. Stored records, files and restored history are not
rewritten. Corresponding obsolete foreign device targets are paused, not falsely
acknowledged. They still occupy bounded journal space: compaction is future work.

Ordinary outgoing text can also be mirrored to the primary's own linked devices
without requiring the foreign primary online. This is a separate bounded sync
job, not a transactional guarantee across ordinary delivery and the device
journal. A crash before that job is persisted can still omit the self-copy;
large text, history, attachments and calls are not made multi-device by this fix.

## Scenarios and boundaries

| Scenario | Candidate behavior / protection |
| --- | --- |
| Root-only contact announces direct mode, then goes offline | Ordinary node delivery remains usable; isolated browser regression covers receipt after reopening |
| Direct device account adds a node later | Runtime is reinitialized against checked node identity; same device key, no replacement QR |
| Temporary device-node startup failure | Visible-account bounded retry, 15–120 second backoff; respects LAN policy and disabled device settings |
| Known device owner offline without a node | Fresh policy remains required; no silent legacy/cached bypass |
| Revoked child sends after reconnect | Denied; receipt of old public hints cannot clear known revocation |
| Two root sessions use one signaling address | Distinct conflict explanation; no weakening of signature/authentication checks |
| Node only appears as admin bookmark | Not claimed to be a queue; explicit delivery selection checks identity and existing membership |
| Switch courier while old jobs await confirmation | Existing pending-job guard blocks replacement; no silent queue deletion |
| Switch device authority to another node | Pin migration remains refused; no automatic trust transfer |
| Restore backup | Signaling endpoints and device HTTP disabled; public pins retained; explicit re-enable required; history is not replayed |
| Restore old incoming envelopes without their one-time keys | Not recoverable by this patch; backup excludes transport credentials by design |
| Administrator disconnects a profile | No local auto-join or automatic privilege grant; server membership still decides |
| Different signaling networks, no common route | No invented bridge; need common permitted signaling/direct pairing and valid delivery route |
| Server node and home node alternated | Saved roles remain separate; no automatic copying of encrypted queues between nodes |
| Locked iPhone | Browser suspension still applies; receiving resumes after app execution returns, not a push-notification guarantee |

## Network settings

Overview → Signaling / Direct connection / Delivery nodes / Diagnostics /
Parameters / Recovery. Common state appears on the overview; node roles and
checked selection are in delivery nodes. Installation/download guidance is
collapsed. Advanced LAN inbox and reserve parameters are not mixed into the
signaling address list. Recovery explains backup, session conflict and migration
limits without deleting storage or reloading the page.

## Verification

Local results on 2026-10-20: 951 tests / 156 files passed; Svelte check had
zero errors/warnings; core TypeScript check, production build, production
handler smoke checks and PWA shell checks passed. The internal release gate
matched all 95 canonical node files and both node artifact hashes. No node
source, package or live deployment was modified.

The full device browser scenario passed twice. Backup browser export, readback,
normal-entry restore and reload/unlock passed at 320/390/1100px with zero page
errors on the final run. One earlier backup run aborted its reload navigation
(`net::ERR_ABORTED`); an unchanged rerun passed. This is not evidence that every
navigation timing has been eliminated. Production build still reports existing
large-chunk/browser-crypto compatibility warnings; these are not suppressed.

- Unit/integration suite for app and signaling; component and core type checks.
- `scripts/test-device-live.mjs`: isolated real browser contexts, public fixture
  identities, real encrypted P2P and local signed node APIs. Covers owner QR,
  enrollment, offline node delivery, direct no-node devices, same-key node
  upgrade, revocation, the root-only courier regression, settings overflow and
  shared header layout at narrow/wide widths. No real user accounts are opened.
- Existing backup regression now verifies imported device HTTP stays disabled
  and the original snapshot is not mutated.

These checks do not exhaust all browser/OS/NAT combinations, power-loss timing
or every possible switching sequence. Remaining work: transactional unified
outgoing journal/self-sync, acknowledged-job compaction, explicit safe authority
migration, old-queue drain and multi-node failover with deduplication. They must
not be simulated by clearing keys, switching trust pins or weakening revocation.
