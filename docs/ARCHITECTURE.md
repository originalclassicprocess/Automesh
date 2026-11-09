# Architecture and contributor entry

Automesh is a browser/PWA client with optional infrastructure. A browser account,
a connected device, a signaling session and authorization to use a node are
different things. None is proof that a recipient saved or read a message.

| Area | Responsibility |
| --- | --- |
| `src/lib/identity`, `addressing`, `vault` | Account identity, addresses and local protected access |
| `src/lib/core`, `core-storage` | Application operations and durable local state |
| `src/lib/chat`, `message` | Personal message handling and presentation state |
| `src/lib/transport` | Existing direct/signaling connection plumbing |
| `src/lib/node` | Explicitly authorized node queues, files and receipts |
| `src/lib/radio` | Meshtastic USB/Bluetooth, personal radio routes and native channel text |
| `src/lib/application`, `src/routes` | Shared UI, settings, language and capabilities |
| `server` | App hosting, signaling and temporary device pairing |
| `nodes/packages` | Compatibility snapshot of canonical node protocol/runtime |
| `nodes/adapters` | Windows, Linux, server and shared-hosting integration |

Canonical node development belongs in AutomeshNodes. Do not silently diverge
the snapshot. Builds and deployments are separate: running tests or building an
archive must not require real server credentials or start a production node.

## First local run

Use Node.js 24 and a clean directory:

```sh
npm ci --ignore-scripts
npm --prefix nodes ci --ignore-scripts
npm run prepare
npm run dev -- --host 127.0.0.1
```

Use disposable browser accounts. Existing site data is scoped to its origin;
opening localhost does not migrate a production account. Do not import a real
seed or private chat backup for development. Hardware is unnecessary for normal
unit tests. LoRa tests with a real board are a separate, explicit acceptance step.

Before a contribution run `npm run check`, `npm run i18n:check`,
`npm run check:core`, `npm test` and `npm run build`. After building, run
`node scripts/test-pwa-shell.mjs` and `npm run test:production`; these use local
test services, not your hosting account. Platform skips are expected and must
be reported. Linux service acceptance still needs Linux.

## Security and delivery boundaries

TLS protects the connection to infrastructure; private-message encryption is a
separate layer. Signaling helps peers meet. Nodes retain authorized encrypted
queues until a valid receipt, cancellation or expiry. Message state must not
regress when a late event arrives through another existing path.

Meshtastic personal Automesh text has its own encryption/identity checks.
Native Meshtastic channel text is sent as the board under that network's
security rules. It is not an authenticated Automesh account message. Radio
reception and mesh feedback do not promise durable storage or reading.

See [security policy](../SECURITY.md), [core API](CORE_API.md),
[device permissions](ACCOUNT_DEVICE_STATES.md),
[Meshtastic channels](MESHTASTIC_CHANNELS.md) and
[public readiness](PUBLIC_RELEASE_PLAN.md).
