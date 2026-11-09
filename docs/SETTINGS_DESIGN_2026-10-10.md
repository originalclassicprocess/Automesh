# Unified settings controls — 2026-10-10

Settings now use one rounded visual language: consistent field/button sizing, labeled forms, rounded cards and custom accessible parameter menus. Native square dropdowns in the visible settings have been replaced. Advanced disclosures use a circular plus/minus rather than native triangles. Styles are scoped to settings, not the conversation composer or media viewer.

Profile order: avatar, nickname, profiles, advanced identity parameters. Connection settings keep the role-based organization from SETTINGS_CLEANUP_2026-10-10.md; operating systems do not become separate connection protocols.

Node invitations, administrator invitations, direct pairing and signaling server entry use the same QR control: visible manual input, camera scan, image picker. Existing validation, consent and permission checks remain. Generated signaling QR codes have exact-content copying; direct pairing and account QR codes retain their existing code/address copy actions.

Keyboard menus support arrows, Home/End, selection, Escape and focus restoration. Labels, disabled controls and high-contrast checkbox fallback are preserved. A local account-free /dev/settings fixture demonstrates the layout; production returns 404 for this route.

Verification: 760 application/server tests and 20 standalone node tests passed; Svelte/TypeScript check reported 0 errors and 0 warnings. Production build and production checks passed. Browser checks covered keyboard selection, Escape focus restoration and a 390px settings surface without horizontal overflow. This is not a physical iPhone test.

Release also includes the previously prepared receive-channel recovery and safe diagnostics described in RECEIVE_RECOVERY_2026-10-10.md. The standalone deployed server node, its identity, membership and stored messages are not updated by the client deployment.
