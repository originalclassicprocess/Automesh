# Contributing

Read README, SECURITY and the public release plan. Small reviewed changes are
welcome; discuss protocol, identity, migrations and routing changes first.
Preserve existing data and wire compatibility.

Start with [architecture and local development](docs/ARCHITECTURE.md). Use
Node.js 24, install both app and node dependencies with `npm ci --ignore-scripts`,
then run `npm run prepare`. The node dependency command is
`npm --prefix nodes ci --ignore-scripts`. Development requires no production
credentials. Canonical node changes belong in AutomeshNodes; see its
`CONTRIBUTING.md` before modifying the app's compatibility snapshot.

Help wanted: crypto/security review; mobile reconnect tests; accessible UI and
localization; Windows/Linux install/recovery; NAT/TURN; abuse-resistant limits.
Describe what tests actually demonstrate, including skips and untested devices.

Use synthetic fixtures/disposable profiles, not real messages, seeds, keys,
node configuration or user exports. Localizing UI must never translate messages,
display names, filenames, account addresses or mnemonic words.

Run relevant tests/type checks and supply a rollback plan for storage/deployment
changes. Contribute only code/assets you can license under MIT; preserve
third-party notices. Report security issues privately when possible.

## Shared interface and themes

Use `src/lib/application/theme.css` semantic tokens for component colors
(`--surface`, `--text`, `--muted`, `--accent`, `--danger`, etc.). Reuse the
shared controls and shell styles. Do not add fixed light/dark colors to new
panels. `server/ui-theme.test.js` checks this contract and key contrast pairs.
Media pixels, QR content and the deliberately dark media viewer are exceptions;
theme changes must never recolor an attachment or change exported image bytes.

Transfer and delivery badges are presentation-only projections of existing
state. Do not let a badge initiate a download, emit an ACK or change delivery
state. Browser verification: `node scripts/test-device-live.mjs <playwright-node-modules> --interface-only`.
