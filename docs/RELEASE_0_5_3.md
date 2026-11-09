# Automesh 0.5.3

- Node downloads now use immutable releases from the public automesh-nodes repository: Windows, Linux and a separate cPanel server package.
- Settings → About project links public sources, issue reporting, MIT license and development history; shows version and source commit.
- An explicit comparison checks release metadata. The independent verifier additionally checks GitHub attestation and hosted immutable client assets; see VERIFY_RELEASE.md for limits.
- CI checks embedded node source against a pinned public commit and runs existing protocol tests.
- Production updates consume verified public artifacts; hosting credentials stay in the private operator repository, with backup and rollback.

No transport, encryption, message delivery or account migration changes. Existing experimental limitations remain, including browser Bluetooth support differences, no macOS installer, and terminal-only Linux setup.
Dependency audit and notice gaps remain documented in DEPENDENCY_SECURITY_2026-11-08.md and DEPENDENCY_LICENSE_REVIEW.md; this release does not claim an independent security audit or a completed license certification.
