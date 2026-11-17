# Build-tool advisory assessment for 0.5.11

The project owner approved this assessment and a one-time PR #22 review bypass
for release 0.5.11 on 18 November 2026. It does not
claim that picomatch is patched or exempt future findings from review.

The reviewed advisory is [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf):
repeated extglob patterns supplied to picomatch can cause excessive regular
expression backtracking. The registry's latest version remains 4.0.7; the advisory
lists versions through 4.0.7 as affected and has no patched version as checked on
18 November 2026.

In this release picomatch is used by development/build tools. The installed
production dependency graph and prepared release dependency list contain no
picomatch; app/server source does not import it or the reviewed build tools.
The build uses patterns/configuration from reviewed source, rather than message,
sticker, attachment or network input. No existing hosting/node setup is changed.

The proposed audit policy continues to report the advisory and excludes only
this exact cause and its known transitive effects while all of these checks hold:

- Every picomatch copy is exactly 4.0.7 and marked development-only in the lock.
- All 13 reviewed build packages retain their exact reviewed versions and remain
  outside production/optional dependencies; the Kit version remains 2.70.4.
- Source under src/server has no literal reference to the reviewed build tools
  outside test files. Symlinked source is rejected by inspection.
- Only named reviewed packages may receive a transitive exclusion. Unrelated
  packages, unknown advisories, all critical findings, changed versions/usage or
  unavailable audit data still block publication.

Remaining risk: malicious build patterns/source can still consume a CI job until
its timeout. Public validation runs without hosting secrets and with read-only
repository access. The package remains vulnerable for other applications that
accept untrusted glob patterns; this is not a general safety claim. Replace this
assessment with an upstream fix when available.

Tests check the actual graph/source and reject production promotion, new runtime
imports, toolchain changes, missing evidence and unknown/critical findings. The
existing separately reviewed disabled-remote-function assessment is unchanged.
