# Release 0.5.10 dependency applicability review

The 16 November release audit stopped on newly published remote-function
advisories GHSA-3r8g-jcqq-3p5j (high) and GHSA-6cf5-gc4q-fm3x (moderate).
Upstream documents both as affecting applications enabling experimental
remote functions. The locked SvelteKit 2.70.4 is affected at package level;
this review does not claim it has been patched.

Automesh uses its own signed APIs. It has no remote modules or imports of
$app/server, and explicitly configures remoteFunctions:false. The release
audit runs the current online npm audit and preserves its findings. Only those
two exact advisories and their Kit/adapter transitive effects are considered
inapplicable, conditional on the reviewed lock version, explicit disabled flag
and absence of remote API/module references. Unknown moderate/high findings,
critical findings, audit failures and changed guards block release.

Tests cover the actual source and fail-closed guard/advisory changes. This
scoped applicability decision requires owner review before production release.
It does not reduce the severity threshold for other packages or advisories.
SvelteKit 3 migration should be a separately tested project, including config,
imports, service worker, navigation and managed-hosting package compatibility.

Primary sources:
- https://github.com/advisories/GHSA-3r8g-jcqq-3p5j
- https://github.com/advisories/GHSA-6cf5-gc4q-fm3x
- https://svelte.dev/docs/kit/migrating-to-sveltekit-3
