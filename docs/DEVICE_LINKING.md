# Linked devices — app 0.3.4 / node 0.4.3 private preview

Integration and compaction changes included in app 0.3.9:
[DEVICE_REPLICATION_STAGE.md](DEVICE_REPLICATION_STAGE.md). The bounded journal
notes below describe the older preview; completed tracking now compacts while
pending jobs remain protected. Manual selected-device transfer of old history and
available attachments is documented in [DEVICE_HISTORY_TRANSFER.md](DEVICE_HISTORY_TRANSFER.md).
Live file/call synchronization is still absent.

Publication is confirmed by release notes/operator report, not the presence of
this document alone. Full state/rights/routing tables in
Russian: [ACCOUNT_DEVICE_STATES.md](ACCOUNT_DEVICE_STATES.md).

This is the simplest independent-device release, not offline-root/admin
delegation, a finalized interoperable protocol or an independent security audit.
The existing seed, account vault, full-backup format and recovery stay unchanged.
Do NOT erase the owner's seed/device as part of this workflow.

## User workflow / Как пользоваться

1. The owner opens the trusted account/profile, then Settings → Security →
   Connect new device. This is available without a node and for old incoming-only
   node bindings. Node availability is rechecked, without silently changing pins.
2. The owner alone initiates. A single short-lived QR/link appears in that same
   window. On the new browser choose “Sign in without seed”, scan/open it and
   create a local password. Browser/OS supplies an editable device label; it is
   not reliable hardware identity. Never enter the owner's seed/password here.
3. The encrypted request returns automatically. Compare the code simultaneously
   displayed on BOTH screens and approve on the owner. There is no reverse QR,
   typed owner ID, JSON request or manual approval import in this UI.
4. The new browser verifies permission and prepares its receiving channel before
   the owner sees completion. Optional nickname/contacts transfer uses encrypted
   messages, not QR plaintext. Reload of a pending invitation resumes with the
   local password. Established logins use the same “Password → Sign in” form.
5. With a working node, owner and sender may close: the recipient polls its own
   queue after unlocking. Without a node, direct traffic needs reachable peers
   AND a fresh nonce-bound signed answer from the owner. An offline owner permits
   opening local history, not silently authorizing new traffic from an old grant.
6. The owner may add a node from the device-management window later. A fresh
   owner-signed route update upgrades a linked device with the SAME key/identity,
   without another QR. Existing node pins are not silently replaced. A connection
   to the owner is needed to learn the update; it is not out-of-band discovery.
7. Grants last 30 days. Only the owner renews/revokes them. Known revocations and
   expired grants remain forbidden; already decrypted copies cannot be recalled.

По-русски: владелец → «Настройки → Безопасность → Подключить новое устройство» →
один QR. Второе устройство → «Войти без сида» → QR → свой пароль. Заявка приходит
сама; сверка кода на двух экранах → «Разрешить вход» у владельца → чаты.
Обратный QR и ручной перенос ответа убраны. Повторная разблокировка — только
свой пароль. Первый аккаунт в браузере не удаляется и не заменяется. Seed
сохраняйте как раньше. Без ноды владелец нужен для свежей проверки прав.

## Actual scope and limits

- New TEXT messages only, up to 4096 UTF-8 bytes including reply metadata.
  Incoming messages and one's own outgoing copies fan out to authorized devices.
  Old history/settings are not automatically transferred on enrollment. Optional
  nickname/contact bootstrap uses owner-authored encrypted self-messages
  (HPKE via node queues or authenticated MAE directly);
  contact aliases/IDs are not included in public invitation QR. The invitation
  itself contains the owner's public ID/nickname and node parameters. Bootstrap import is durable,
  idempotent and does not unblock locally blocked contacts. It transfers neither
  history, routing discovery for unknown foreign nodes nor private credentials.
  This preview exports the first 50 accepted contacts per action, with names up
  to 32 characters; at most 128 imported bootstrap event IDs are retained. It is
  a one-time owner action, not continuous bidirectional address-book sync.
  Unknown incoming contacts appear as requests. Add a known Account ID manually
  if needed; accepting allows its node delivery, not device administration.
- Live files, voice messages, calls, saved-message synchronization, pin/read-status
  merging, device administration and full-backup export from the linked-device
  workspace are NOT implemented. They remain available through the original
  owner interface. Do not claim full messenger feature parity on linked devices.
- Same-node contact policy is discovered automatically. Different-node contacts
  must first exchange signed routing metadata over an authenticated online
  connection. There is no global directory or magic discovery of an unknown node.
  The encrypted mail also carries its sender's signed public routing hint; that
  hint is NOT freshness and does not bypass the fresh authorization check.
- Node data TTL/prekeys: up to seven days. A receiver must have published usable
  keys before going offline. No native push, browser wakeup, always-on iOS or
  unlimited retention. “On node” is not “received” or “read”.
- Current bounded delivery journals: 128 incoming / 128 outgoing events and
  1 MiB, including dedup/policy data; mail journal 128 jobs / 1 MiB. Capacity
  fails explicitly without evicting unacknowledged content. Compaction and larger
  histories need further work; this release is for bounded private testing.
- Sixteen cumulative certificate records per account, including revoked entries;
  renewal preserves the same record/key. Linked devices do not consume extra
  slots in the node's legacy eight-profile pairing limit.
- No profile-switching or cloning a linked private key by full-backup restore.
  Device vault/journals are separate databases, outside full backup v1. That
  archive still contains the owner's seed and must NOT be used for enrollment.
  Owner public control metadata can be recovered from its existing node, signed
  by the original owner; this is not device-key/history recovery.
- The chat layout, common account header and settings categories are shared;
  unsupported features are disabled/explained, not silently granted. Feature
  parity is NOT claimed. The owner's existing vault is not overwritten when
  another device login is explicitly stored in the same browser.
- An unfinished 0.3.3 invitation needs a 0.3.3-capable client after rollback.
  After verified approval its temporary invitation field is removed, keeping
  established linked-vault records readable by 0.3.2. Rollback does not undo
  owner grants/revocations or migrate client databases backwards.
- A restored history does not retransmit old device messages. Browser/site-data
  deletion can lose independent device keys/history: revoke the old device and
  enroll a new one. A server rollback does not roll back browser databases.

## Trust and encryption

Every linked device generates an independent P-256 key and stores it encrypted
under its own local password (PBKDF2-SHA256 600000 / AES-256-GCM). Enrollment is
owner-signed, messages-only, non-delegating. The seed/root signer is not an
enrollment input to the new device.

The new invitation contains public signed metadata AND a short-lived rendezvous
join capability/encryption key in the URL fragment. It must not be published.
Possession alone cannot grant access: owner confirmation and signed device-bound
permission are still required. Request/approval/completion packets are AES-256-GCM
encrypted with session/type-bound AAD; completion is device-signed. The relay is
not an authority: ciphertext only, memory-only, ten-minute TTL, bounded sessions,
body sizes and rates, exact Origin and separate owner/join roles. It sees IP,
timing and sizes. Restart interrupts unfinished enrollment. Public app rendezvous
is explicitly disallowed in LAN-only mode; a local HTTPS app can host its own.
A single QR cannot complete a fully disconnected two-way exchange without some
return channel; no offline-only automatic enrollment is claimed.

Legacy public signed links remain size-bounded parsable for compatibility. New
enrollment requires a fresh owner invitation. Compression uses a fixed output
buffer. Signatures, expiry, owner/request binding, pins and code comparison are
still checked. No invitation is a substitute for owner confirmation.

Owner-signed directory lists expire within 30 days, bind a specific HTTPS node
identity/public signing key when node-bound and contain versions and revocation tombstones.
Clients check signatures, remembered versions/revocations and nonce-bound node
checkpoints (30-second validity). Default: unavailable current verification means
wait. Direct mode instead requires a fresh owner-signed proof bound to a random
nonce, exact recipient and roster digest, with at most 30-second validity; cached
authorization is disabled there. Advanced node cached mode must be explicitly enabled and still rejects known
rollback, invalid signatures and expired grants/lists. It can delay learning a
revocation. This is not global consensus: a malicious pinned authority can hide
a newer owner statement from a client that has never seen it. No instant global
revocation is promised. Existing decrypted copies cannot be recalled.

Direct traffic uses unchanged authenticated encrypted MAE sessions under
physical device identities. Node delivery uses independent one-use HPKE prekeys,
sender-signed envelopes and device-signed receipts. Node ACK follows the durable
delivery journal AND idempotent visible chat-history commit. Ciphertext/receipts
survive node restart; private prekeys stay in the encrypted client journal.
Failed storage, missing keys or rejected policy do not produce success receipts.
No plaintext or seed-based fallback is introduced into the v1 validators.

The node sees routing IDs, traffic sizes/timing/IPs and signed device metadata.
Signed lists/device labels are public metadata available to authenticated node
clients: use generic labels, not confidential personal details. Endpoint/XSS/
extension compromise and malicious served JavaScript remain threats. Permission
renewal/revocation cannot erase messages already decrypted by a stolen device.

## Checks

- Automated owner approval, semantic ECDSA replay binding, encrypted persistence,
  CAS, expiry/renewal, matching codes, rollback/revocation, per-device ACK/dedup.
- Real MAE/ChatService integration with captured encrypted wire frames.
- Real disk node queues: both sender and first owner device closed; independent
  recipient and node/client restarts; lost ACK; strict versus opt-in cached policy.
- Isolated headless browser: ordinary owner settings, separate new-device login,
  both message directions with first device closed, signed HTTP node requests,
  reload/unlock, owner revoke and revoked re-entry denial. Single real QR PNG,
  automatic request/approval, same comparison code through completion; old
  incoming-only bindings and node failure/retry. Shared header geometry and no
  overflow at 320/390/600/1024/1280/1920px. Real browser MAE without node, strict
  offline-owner wait/resume, same-key node upgrade and offline node reception
  with both owner and sender closed after upgrade.

These are automated local checks, not fresh physical iPhone/Android trials,
an independent protocol audit, clean VM installation or public production approval.
