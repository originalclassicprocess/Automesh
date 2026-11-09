# Verify a public release

App and node sources are public in [Automesh](https://github.com/originalclassicprocess/Automesh)
and [automesh-nodes](https://github.com/originalclassicprocess/automesh-nodes).
Releases are built from a clean main commit by the manual `release.yml` workflow.
GitHub attestations bind the actual archive hash to that repository, workflow,
commit and hosted runner. They are not an independent security audit or an
operating-system publisher signature. Experimental software remains experimental.

## Installed web application

Settings → About project shows embedded version/commit and links to the sources.
“Compare with GitHub” only compares public metadata. A server can lie about its
commit: this button is not a complete verification of the running application.

For an independent check, use a trusted checkout of this repository, Node.js 24,
GitHub CLI with `gh attestation verify`, and `tar`:

```sh
node scripts/verify-hosted-app.mjs https://automesh.online v0.5.3
```

The tool downloads the exact public release, checks its GitHub checksum and
attestation, validates every packaged path/type/hash, compares hosted build
metadata, then downloads and compares all immutable client assets. It does not
execute downloaded code. No account, seed or hosting credentials are needed.
GitHub CLI may require normal GitHub authentication to fetch attestations.
Files are retained in a new temporary folder for inspection.

This checks published JavaScript/CSS/resources at the specified origin. It cannot
prove hidden server code, dynamic HTML, what an already open browser cached, or
that a verified program has no vulnerabilities. Update/reload an existing tab
normally after deployment. A local development build is explicitly marked local.

## Node packages

Download the Windows, Linux or separate server archive from the public node
release. The app uses fixed versioned GitHub download URLs, with SHA-256 and a
verification command available beside the download. Never treat a checksum from
the same untrusted source alone as proof of authorship.

```sh
gh attestation verify ./Automesh-Node-Setup.exe --repo originalclassicprocess/automesh-nodes --signer-workflow originalclassicprocess/automesh-nodes/.github/workflows/release.yml --source-ref refs/heads/main --deny-self-hosted-runners
```

For a particular release also pin `--source-digest` and `--signer-digest` to its
full public commit (the in-app command includes both). A failed or unavailable
check is not success. Windows packages currently have no Authenticode signature.
There is no macOS installer; Linux has terminal setup, not the Windows wizard.

## Source compatibility and hosting

CI compares the embedded node source against the **immutable public commit** in
`nodes/source-provenance.json`, then runs existing protocol and delivery tests.
Updating node source is deliberate: a moving latest branch cannot silently
change the application. This verifies source consistency and tested contracts,
not compatibility with every past/future server or hardware combination.

Public workflows have no hosting SSH keys and cannot deploy contributor code.
The private hosting relay independently verifies the public release before
using its existing backup/rollback deployment. Old repositories/history remain
private. Future hosting updates use public release artifacts, not private builds.
