# Photo avatars

Photo avatars initially published 2026-10-10 in `v0.2.5-bd5f8de6b6015553`. Crop editor was included in the later `v0.2.5-562cee747a684d2d` release. Larger-source processing below is a subsequent local change, not deployed yet.

- Own contact card and Settings → Account provide photo upload, replacement and removal.
- Default remains the address-derived identicon. With a photo, the identicon also appears next to Account ID in own and peer cards. Photos are not proof of identity.
- Local browser decoding, user-selected square crop, opaque white background, 160×160 JPEG up to 12 KiB. The original file is unchanged; the thumbnail is re-encoded and metadata-filtered. HEIC/AVIF support depends on the browser. SVG and external image URLs are not accepted. Current local input limit is 64 MiB / 64 megapixels, maximum 16384 per source edge (previous release: 20 MiB / 32 megapixels); GIF becomes a still thumbnail.
- Photo and received peer photos live inside each profile's encrypted LocalChatData. Nothing is added to the public profile registry. Other locked profiles retain identicons in the switcher until opened.
- Authenticated encrypted `mesh-avatar-v1` control is separate from nickname-v1 for compatibility. Older clients ignore it. Empty control explicitly removes a photo. Controls create neither chat messages nor message receipts.
- Photos are shared with accepted contacts only, on connection, acceptance and local changes. There is no public server upload or courier avatar job. Both contacts must connect directly to receive changes. Saved copies cannot be forcibly erased from other devices.
- Incoming images have bounded wire size, canonical JPEG-only data URLs and square decoded-size declarations up to 160 px; malformed or unsupported images fall back to identicons in the UI. Up to 256 peer avatars per profile.
- Profile/lock generation guards discard unfinished uploads after an account switch. Metadata-cleaning and delivery fixes were included in the published release.
- Crop preview with zoom 1–4×, mouse/touch positioning, accessible horizontal/vertical sliders and reset. Cancel never saves; profile switch discards the preview and aborts loading. The selected square is applied to the same bounded, metadata-filtered JPEG thumbnail; wire format and storage remain unchanged.
- Current local improvement: bounded header inspection for JPEG/PNG/GIF/WebP before decoding, native bitmap downscaling where supported, otherwise a reduced canvas preview. Loads time out or cancel safely, including releasing bitmaps that resolve after cancellation. Native HEIC/AVIF decoding and its internal peak memory remain browser-dependent; a failure asks for JPEG/PNG instead of using an external service.
