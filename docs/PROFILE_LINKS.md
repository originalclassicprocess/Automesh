# Profile links

Profile owners can publish up to five website/social links. Each entry contains
only `label` (up to 40 characters) and `url` (up to 512 characters after URL
canonicalization). Only HTTP/HTTPS URLs without credentials are accepted.
Control and bidirectional override characters are rejected. Imported fields such
as `verified: true` are discarded; there is no ownership badge in this version.

Links are exchanged as `\0mesh-profile-links-v1:` followed by a JSON array over
the existing signed, encrypted ChatService session. An empty array removes the
previous list. Invalid controls are ignored and never become chat messages or
delivery receipts. The account UI sends/accepts these controls only for accepted
contacts, on acceptance, reconnect, or a local edit. Older clients ignore the
unknown control. This does not add a delivery channel or change message acks.

Lists are stored in encrypted local history and included in full/data-only
backups. New links currently require a direct connection to update a contact's
cached profile. There is no automatic external preview/favicons/verification
fetch. Opening a link is an explicit browser navigation with no referrer.

## Future ownership proof (not implemented)

- Website: a dedicated public HTTPS proof document binding its exact origin to
  the Mesh ID and an account-signed challenge. A receiving client would check
  the exact source independently and display its check date/expiry.
- Social account: a public post linking back to the Mesh ID, with a separate
  verifier for each supported platform. Do not assume every platform allows
  independent checks from a browser.

Proofs must establish control of a site/social account, not a person's real
identity or trustworthiness. The badge must be derived by the receiving client,
never trusted from profile metadata. Verification requests also expose a visit
to the remote site, so refresh, consent, caching, fetch isolation and failures
need their own design before enabling automatic checks.
