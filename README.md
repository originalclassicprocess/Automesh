# Automesh

[Русский](README.ru.md) · [Development history](HISTORY.md)

An experimental local-first browser/PWA messenger. Create an account without a
phone number or email, keep conversations on your devices, and choose between
Internet, LAN and short Meshtastic radio messages where supported.

**Public source preview. No independent security/cryptography audit or delivery
guarantee.** Development began on 30 April 2026; this repository opens with a
clean snapshot, not the full private development history.

## Why Automesh

Decentralize messaging infrastructure, return control of storage to people and
their own devices, and encrypt private communication by default while retaining
familiar convenience. A home computer should be a practical node without a VPS.
These are project goals, not a completed autonomous global network.

## Current capabilities

| Area | Available / limits |
| --- | --- |
| Identity | No phone/email; seed recovery; password-protected local vault |
| Personal chats | Encrypted text/files, voice messages, replies, forwarding, selection, image paste, emoji/stickers and local media |
| Connectivity | Direct WebRTC when available; configurable signaling; optional authorized encrypted node queues |
| Backups | Access-only, data-only or full encrypted backup; manual restoration |
| Devices | Owner confirmation, separate device keys, new-text copies and manual selected history/attachment transfer; incomplete feature parity |
| Personal LoRa | Short encrypted Automesh text via Meshtastic USB/Bluetooth and exchanged radio contacts; no radio files/calls/groups |
| Meshtastic channels | LoRa-labelled channels in the chat list; sent as the board under the radio network's security rules |
| Interface | English/Russian, local translation import, themes, profiles, local GIF/stickers |
| Calls | Experimental personal voice calls; browser-dependent audio outputs |

Node storage, radio reception, app storage and reading are different states.
Recipients must open/unlock the app. A radio ACK does not promise durable
storage across board restarts. Native Meshtastic channel text is not an
authenticated personal Automesh account message.

## Run from source

Use Node.js 24 (minimum 22.12). No hosting credentials are required.

```sh
npm ci --ignore-scripts
npm --prefix nodes ci --ignore-scripts
npm run prepare
npm run dev -- --host 127.0.0.1
```

Use disposable accounts, never real seeds, chats or node state in development.
Run `npm run check`, `npm run i18n:check`, `npm run check:core`, `npm test`
and `npm run build`. After building: `node scripts/test-pwa-shell.mjs` and
`npm run test:production`. The workflows build/test only; they do not deploy.

[Architecture](docs/ARCHITECTURE.md) · [Contributing](CONTRIBUTING.md) ·
[Security reporting](SECURITY.md) · [Backups](docs/DATA_BACKUP_V1.md) ·
[Device rights](docs/ACCOUNT_DEVICE_STATES.md) · [History transfer](docs/DEVICE_HISTORY_TRANSFER.md) ·
[Translations](docs/TRANSLATIONS.md) · [Meshtastic](docs/MESHTASTIC_CHANNELS.md)

## Optional nodes

[automesh-nodes](https://github.com/originalclassicprocess/automesh-nodes)
is canonical for the shared protocol/runtime and Windows/Linux/server adapters.
`nodes/` here is a synchronized compatibility snapshot. Submit node changes to
the canonical repository. [Platform support](nodes/docs/PLATFORM_STATUS.md).

The hosted app at [automesh.online](https://automesh.online/) is 0.5.2; this
source preview contains later preparation changes and is not a production
deployment. Existing Windows node baseline: 0.4.16; Linux/server distribution
baseline: 0.4.12. New public build artifacts are candidates, not acceptance of
an updated Linux installer. No Mac installer or wizard is available.

## Limits and community help

No anonymity, guaranteed delivery, audited security or support lifetime is
claimed. Infrastructure sees connection metadata. NAT/firewalls, browser/iOS
suspension, local-storage clearing, node quotas and radio airtime affect use.
TURN is not supplied. Hardware/browser support is not universal. Backups,
multiple devices and radio reception do not remove those limitations.

Help is welcome with independent security review, mobile/Bluetooth recovery,
Windows usability, clean Linux installation, accessibility, translations,
NAT/TURN and abuse-resistant limits. Groups, marketplaces, business storefronts,
MQTT bridges and arbitrary multi-hop node routing are not completed features.

App dependency review retains five low-severity package findings and four
build/test package versions without a recovered full upstream license notice;
their manifests declare MIT. These are disclosed, not silently cleared:
[security](docs/DEPENDENCY_SECURITY_2026-11-08.md),
[license inventory](docs/DEPENDENCY_LICENSE_REVIEW.md).

Project code: [MIT](LICENSE). Dependencies keep their [own licenses](THIRD_PARTY_NOTICES.md).
User media is not automatically licensed under the project license.

Topics: local-first, peer-to-peer, PWA, self-hosting, Meshtastic, LoRa,
decentralized messaging, encrypted communication.
