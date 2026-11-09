# Local UI localization — October 2026

Initially prepared locally, then included in the app 0.4.11 release candidate. Publication and hosting status are recorded separately by GitHub Releases and deployment workflow runs.

- English and Russian catalogs: 2,628 entries each, including presentation labels, help, recovery, device linking, delivery diagnostics and accessibility text.
- Device language selection on entry/sign-in/creation screens and Settings → Application, including linked-device settings. Selection is restored from browser storage; a fresh browser defaults to English.
- Local JSON template export, validated import, replace/remove, five-pack limit, 1 MiB per pack, English fallback for missing or empty cells, and explicit memory-only warnings on storage failure. The 50/50 test file is described in [TRANSLATION_TEST_0_4_11.md](TRANSLATION_TEST_0_4_11.md).
- Explicit presentation boundaries. Messages, names, file names, seed words, addresses and protocol values are not translated. Composer focus uses a stable data attribute rather than a translated accessibility label.
- Dates follow UI locale. Password-strength feedback stays local and uses English or Russian.
- Contribution instructions: [TRANSLATIONS.md](TRANSLATIONS.md). `npm run i18n:check` checks catalog parity, placeholders, explicit UI references and untranslated static markup.

Validation:

- Svelte / TypeScript: zero errors and warnings.
- Production build completed; the existing large-chunk warning remains. The server language module is approximately 446 kB, 139 kB gzip; both languages are bundled for offline use.
- Full Vitest run: 186 files, 1,179 tests passed. Includes local pack validation/lifecycle, complete English coverage, interpolation preservation and content boundary tests.
- Browser: English/Russian switch without reload, saved selection after navigation, real settings navigation, template link generation, and a 390 px settings surface with no horizontal overflow. Screenshot: `.release/english-language-settings.png`.
- The browser automation could not complete the native file chooser flow. Parsing, validation, storage, selection, replacement and removal were verified by tests; the real OS file chooser/import interaction still needs a manual check.

The independent local preview on port 5176 uses the same source. No real chat messages were sent and no real account was unlocked during browser checks.
