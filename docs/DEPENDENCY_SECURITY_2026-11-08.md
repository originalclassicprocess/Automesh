# Dependency review — 8 November 2026

The online npm advisory check of the original lock reported 8 affected package
entries: 1 high, 2 moderate and 5 low. An offline audit returned zero and is **not**
evidence of current security. Use the online check for release assessment.

Compatible lockfile updates were tested in an isolated source copy using
Node.js 24.21.0. Vite is now 8.3.6 and Vitest 4.1.12; the remaining dependencies
stay inside declared ranges. No `audit fix --force` or major framework migration
was applied. These changes do not deploy an app or modify message protocols.

## Remaining online findings

Five low-severity package entries remain, representing three advisory areas:

- SvelteKit enhanced form navigation:
  [GHSA-pfhg-q3qv-9q6r](https://github.com/sveltejs/kit/security/advisories/GHSA-pfhg-q3qv-9q6r).
  Current routes do not use `$app/forms`/`use:enhance` or server form actions.
  The documented affected feature was not found; do not extend this assessment
  to future form features. Upstream fixes require Kit 3.
- SvelteKit prerendered cache-control:
  [GHSA-27mw-82g8-phjj](https://github.com/advisories/GHSA-27mw-82g8-phjj).
  Current routes do not opt into prerendering. This is an applicability
  assessment, not an assertion that the dependency is patched.
- deepmerge prototype poisoning:
  [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4).
  It is used by the Svelte/Rollup build toolchain. Application message,
  translation and node request handling do not import it. Do not feed untrusted
  objects into build configuration, run untrusted contributions with deployment
  secrets, or treat this as a safe general-purpose object merger.

The package entries also include adapter-node, vite-plugin-svelte and
plugin-node-resolve because they depend on the affected packages. They are not
five unrelated exploits. `npm audit --audit-level=moderate` passes while still
showing the low findings; the full audit does not pass. Do not suppress or call
this zero vulnerabilities. Reassess on dependency or feature changes. A Kit 3 /
adapter 6 migration is separate work with its own compatibility validation.

No independent security review or runtime exploit proof is claimed. npm's
database and automated tests do not establish absence of vulnerabilities.
