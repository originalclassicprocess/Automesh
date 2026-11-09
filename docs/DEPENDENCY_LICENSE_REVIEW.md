# Dependency license review — 8 November 2026

This is a technical inventory, not a legal certification. Source MIT does not
relicense dependencies. Regenerate with `npm run licenses:inventory` after a
clean install on the platform being packaged; retain all reported gaps.

## Corrected collection

- Include `THIRD-PARTY-LICENSE` files, not just filenames starting with LICENSE.
- Native Rollup/Rolldown packages use the installed **same-version** parent
  package's license/notices; a mismatched parent is not accepted as evidence.
- `is-module@1.0.0` includes the full license in its README; preserve that section.
- `@polka/url@1.0.0-next.29` and `sirv@3.0.2` omit the text in their npm payload.
  Copies from their npm-recorded Git commits are in `third-party-licenses/`,
  with source URLs and SHA-256 in `sources.json`. An update needs fresh evidence.

## Remaining upstream notice gaps

| Package | Declared license | Evidence and scope |
| --- | --- | --- |
| is-reference 1.2.1 and 3.0.3 | MIT | Installed manifests/README; no full license text found in the inspected npm payload or attempted release-commit LICENSE paths. Compiler/build dependency. |
| locate-character 3.0.0 | MIT | Installed manifest and README declaration; no full license text found at the inspected release-commit paths. Compiler/build dependency. |
| stackback 0.0.2 | MIT | Installed manifest declaration; no full text found. Transitive test tool through why-is-node-running, not an application runtime dependency. |

Do not invent a copyright year or claim those original notices were recovered.
The inventory retains these entries as missing full notices and returns a
nonzero status. Confirm upstream terms/attribution or replace the affected build
tool dependency before claiming a fully completed license gate. These are not
bundled third-party stickers or user media.

The app lock contains optional dependencies for other platforms. Windows bytes
do not verify absent Linux/macOS payloads. Node installers have separate notices
and include the complete pinned Node.js runtime license. Review each actual
distributed archive, not just package.json declarations.
