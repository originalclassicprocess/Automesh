# Third-party licenses

Automesh application source is MIT. This does not relicense dependencies or
user-imported photos, GIFs, stickers, audio or video. Users remain responsible
for rights to media they import/share. No third-party sticker collection is
bundled with this source distribution.

Locked dependencies are inventoried in `docs/DEPENDENCY_LICENSES.json`.
The current collection method and remaining upstream notice gaps are recorded
in `docs/DEPENDENCY_LICENSE_REVIEW.md`; a manifest's MIT declaration alone is
not described as a recovered full license text.
Their installed license/copyright/NOTICE files are preserved in
`static/DEPENDENCY_NOTICES.txt`, shipped as `/DEPENDENCY_NOTICES.txt` with the
site. `static/PASSWORD_NOTICES.txt` contains additional password-estimator data
notices. `docs/THIRD_PARTY_MEDIA_NOTICES.md` records the ZIP dependency.

The dependency tree is NOT uniformly MIT: it contains MIT, ISC, BSD-3-Clause,
Apache-2.0 and MPL-2.0. MPL entries are Lightning CSS build tools; project source
does not copy/modify their source files. Their own license must remain intact
if those binaries/source are redistributed. Optional packages for other OSes
are listed but cannot be inspected from absent local files; platform release
builds must regenerate/verify notices for their own installed dependencies.

Node packages have independent notices in `nodes/THIRD_PARTY_NOTICES.md`; full
Node.js runtime LICENSE includes its own embedded third-party terms. This is a
technical inventory and preservation check, not a legal certification or a
statement that all media on a user's device is licensed.
