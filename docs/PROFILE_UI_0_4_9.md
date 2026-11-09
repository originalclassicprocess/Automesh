# Profile and contact sharing UI 0.4.9

The shared account header places network indicators before the node queue cloud. Next to the profile, two labelled buttons copy the current profile contact link or open its QR directly. Technical/root-only identities keep contact sharing disabled. Clipboard failure opens the contact with a selectable full ID; success feedback is scoped to the current account.

The quick contact dialog and profile card share ContactShare and AccountQr. A checkbox defaults to including the deployment-specific contact link. Turning it off encodes only the account ID. The adjacent ID copy action always copies the raw ID. Existing contact-link parsing and route discovery are reused; no domains, permissions, seeds, new transports or protocol fields are added.

Profile content groups appearance, personal materials and contact sharing. Other profile switching remains in a collapsed section; logout retains its existing confirmation. Desktop uses columns; narrow layouts use a single column and two header rows without shrinking touch controls. The delegated-device header shares the same shortcuts; owner-only editing remains restricted.

Validation: Svelte diagnostics, existing component/contact-link checks, browser inspection at wide and 320-pixel widths, and decoding both rendered QR images to verify the link/ID contents. No personal account is used for these checks.
