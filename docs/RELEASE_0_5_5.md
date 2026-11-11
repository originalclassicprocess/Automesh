# Automesh 0.5.5

Includes all features and signaling recovery fixes from 0.5.4, plus a shared-hosting compatibility fix. The larger page's preload Link header exceeded the hosting proxy's response-header budget and caused HTTP 500 despite successful SSR. Oversized optional Link headers are now omitted; HTML retains its stylesheet links and application bootstrap. Security headers, encrypted delivery and node protocols are unchanged.

A production regression check fails against 0.5.4 and verifies the header budget, retained HTML resources, CSP, version, PWA shell and signed signaling after this fix. Existing home/server nodes need no update. The original 0.5.4 release remains available unchanged for provenance; the failed hosting attempts automatically restored 0.5.3.
