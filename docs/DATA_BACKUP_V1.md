# Separate backup modes — app 0.3.9

Implementation stage 1, 2026-10-23. This backup format does not activate identity
migration, node changes or device synchronization. A separate subsequent local
device stage is described in [DEVICE_REPLICATION_STAGE.md](DEVICE_REPLICATION_STAGE.md).

## User workflow

Settings → Security → Backups offers three explicit choices:

- Full: account recovery phrase, verified profile registry, all locally stored profile histories and referenced media. Existing `AMFULL01` remains unchanged/readable.
- Data only: contacts, history, portable settings, avatars and available referenced media for the **active profile only**. Other profiles are excluded; export them separately or choose Full.
- Identity only: the existing encrypted `.automesh` account format, containing recovery phrase and profile metadata but no chat history/files. Paper recovery remains available separately.

Full and data exports can use an independent archive password after reauthenticating the local root vault. Identity-only export also supports an independent file password. Defaults retain the account password for familiar behavior. Changing the app password never re-encrypts existing downloaded files. Two files/passwords are not automatically two-factor authentication. Independently encrypted sections in a single file are future work, not implemented here.

Data recovery: first unlock/recover the corresponding identity normally, open the matching profile, choose Data only → Restore data from file. Decrypt, inspect counts/date/missing files, then explicitly confirm. This stage refuses to combine with existing history, meaningful contacts or media. It may replace an initialized but empty local history record, never the identity vault. A data-only archive selected at account entry explains why it cannot log in.

## Data-only format and boundaries

- Separate `AMDATA01` container, random 16-byte salt and 12-byte nonce, PBKDF2-SHA256/600000 and AES-256-GCM; format-specific authenticated data. No fallback to a full/identity reader.
- Encrypted metadata binds account/profile address, random archive ID, creation time, portable data and file descriptions. No public account/address manifest. Exact file lengths/hashes and profile ownership of message directions are checked. Metadata is bounded to 16 MiB; archive to 128 MiB; files to 10000; messages to 100000.
- Explicit data-field allowlist, not merely removing a field named seed. Excludes identity/recovery/device private keys, transport sessions, queued mail/prekeys, node credentials, device policy/settings, network endpoints and seed-backup verification flags. User-entered text/media can of course contain secrets the user themselves put there.
- Protected disappearing messages and opening reports remain excluded, as do their unreferenced file bytes. Partial/missing files are reported, never silently invented.
- Import keeps the destination's existing network configuration, device authority, delivery state and seed-backup verification. Archive history is marked restored; old sends/receipts/device transactions are not replayed.
- Before replacement, the exact observed destination ciphertext is checked again inside one IndexedDB transaction. Account/file writes commit together; conflicts/quota/abort roll them all back. A storage-reset epoch prevents asynchronous recovery from resurrecting reset data. Existing orphan files are not deleted/overwritten; conflicting insertion fails.
- Knowing the archive password reveals its historical data but does not authorize account login, device enrollment, node administration or issuance of new messages. The exporter/receiver must already be trusted; this cannot protect an unlocked compromised browser or OS.

The current memory/size limit remains explicit. Streaming multi-volume archives, deterministic non-empty history merge, linked-device data backup and continuous sync are separate later stages.

## Verification

`node node_modules/vitest/vitest.mjs run src/lib/backup`

`node scripts/test-full-backup.mjs <playwright-node-modules>`

`node scripts/test-data-backup.mjs <playwright-node-modules>`

Synthetic fixtures only; manual physical iPhone/Android file handling and memory acceptance remain necessary. No independent cryptographic audit or production-safety claim.
