# Backup protection modes — design only, after 0.3.0

Requested 2026-10-19. Nothing in this proposal changes the shipped .automesh-backup
v1 format. It contains the account recovery phrase and data encrypted together,
and remains readable with the password used at export time.

Local stage-1 implementation on 2026-10-23 now provides full, identity-only and
active-profile data-only files with optional independent file passwords. See
[DATA_BACKUP_V1.md](DATA_BACKUP_V1.md). It is not deployed. Separate encrypted
sections inside one file and paper archive-unwrapping keys remain design only.

## Simple choices, explicit consequences

| Mode | Content | Restore requirement | Does possession permit account impersonation? |
| --- | --- | --- | --- |
| Identity | Recovery phrase, minimum identity/profile recovery metadata | Its password or separately designed paper recovery key | Yes, once decrypted |
| Data only | Selected history, contacts, settings and saved files; no recovery/control/device private keys | Data password AND proof of the destination identity/approved device rights | Not by archive content alone |
| Everything, one protection | Identity and data, one user-facing unlock | Backup password | Yes, once decrypted |
| Everything, separate protection (advanced) | Independently encrypted identity and data sections | Identity password for identity; data password plus identity authority for history import | Identity section remains highly sensitive |

Keep one default action: full encrypted backup. Put independent section passwords
under Advanced. Explain that losing either password can lose the corresponding
section. Different files/passwords are not automatically stronger if stored together.
Do not call two locally entered passwords two-factor authentication.

## Format and trust boundaries to design before implementation

- New versioned container; no reinterpretation of v1 or silent removal of its seed.
- Independent random encryption keys and AEAD per section, each with its own key
  wrapping slots/KDF/salt/nonce. One-password UX must not mean nonce/key reuse.
- Bind section kind, format version and shared random backup ID in authenticated
  associated data. Keep account identifiers/manifest contents encrypted. Validate
  both decrypted account binding and manifest/file hashes before atomic import;
  reject mixed sections, duplicate IDs, trailing data and unauthorized destination.
- A data-only serializer must be independent of the existing full serializer:
  existing nested account backups carry the seed and MUST NOT be copied into it.
  Also exclude device private keys, root-derived profile key material, live session
  state, node credentials, active permission/recovery policies and transport queues.
- A linked device's data transfer is a separate, authenticated encrypted pairing
  workflow, not giving it a full recovery archive or arbitrary owner-supplied key.
- Imported history is not a proof that every message was freshly received, that
  restored rights are current, or that the archive is the latest version. Preserve
  archive labels and do not replay messages/receipts/network grants automatically.
- A paper recovery key/QR for decrypting archives needs a separately reviewed
  key-wrapping/recovery design, explicit offline printable workflow and tests. The
  current mnemonic alone still cannot decrypt password-only v1 archives.
- Confirm target identity, data scope, missing files, limits and overwrite behavior
  before import. Retain the existing refusal to merge over live history until an
  explicit deterministic merge design is implemented and tested.
- Threat model: stolen archive, stolen one password, malicious/mixed archive,
  old backup rollback, wrong destination, cancelled/locked import, interrupted write
  and compromised exporter/browser. Separate encryption cannot protect secrets
  already accessible to a compromised unlocked device.

No new crypto primitives or security guarantee is claimed by this design note.
