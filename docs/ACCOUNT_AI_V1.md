# Account AI integration — stage 1

AI is an optional local mode of an existing account, not a new identity class.
The user can dedicate a separate identity to AI or enable it on a personal account.
The adapter does not hold identity keys, discover contacts, read other profiles or
execute tools. The existing client controls the data supplied to it and delivery.

## User flow

1. Open profile settings, expand **AI for this account**, enable it and select a backend.
2. On-device: choose SmolLM2 135M (about 145 MB download) or Qwen2.5 0.5B
   (about 525 MB download), WASM or WebGPU, and explicitly download the weights.
   Browser native: check availability of the browser's own built-in model. Local: enter an
   OpenAI-compatible loopback endpoint (e.g. Ollama at
   `http://localhost:11434/v1/chat/completions`) and model name. Cloud: enter the
   HTTPS chat-completions endpoint, model name and access key if required.
3. Use **Test connection** to send a fixed diagnostic prompt without any chat
   content or custom instructions. Save settings. Open an accepted contact's
   chat, expand **AI assistant**, and select **AI: draft reply**.
   Review the generated draft and send it using the ordinary send control.
4. Optionally enable **/ai replies** for one accepted contact in the current
   unlocked session. A fresh verified message beginning with `/ai ` can
   trigger one automatic plain-text response marked `[AI]`. No backlog is scanned.

## Boundaries

- Disabled by default; configuration is scoped to the account's encrypted chat
  store. API keys and automatic reply permission are session-only. Locking,
  switching or restoring an account clears these and aborts outstanding requests.
- Draft context: at most six recent text messages, 600 characters each; no files,
  calls, ephemeral messages or pin controls. Automatic mode receives just the
  explicit command, not the chat history. One inference at a time, bounded input,
  output and request duration, with a 15-second automatic request cooldown and
  at most 20 automatic requests per unlocked session. Busy/cooldown-limited
  commands are not queued for later inference, preventing unintended bursts.
- Requests are direct browser requests. No Mesh Autonomy relay or model billing.
  Remote endpoints must use HTTPS and allow the web application's origin via
  CORS. Local mode only accepts loopback addresses; browser mixed-content/local
  network policy may restrict access. No redirect or cookie forwarding.
- Cloud mode respects the existing internet-disabled setting. External engines
  receive the selected text; browser inference does not send it to a model API.
- Manual drafting uses the same transport selection, including LoRa when the
  existing radio text limit is satisfied. A common committed-incoming event
  supports direct, mailbox, Courier and personal LoRa messages. Events contain
  only a peer and message reference and are emitted after successful commit,
  never on duplicate delivery or history import. Radio replies use the same
  radio transport and fit the encoded 320-byte payload, including metadata.
  Failed writes are not automatically replayed into the model. Model errors do
  not affect message acknowledgements, and no automatic requests are retried.
- The browser native backend uses the optional LanguageModel API. The on-device
  backend instead uses a bundled Transformers.js/ONNX Runtime Web worker and
  explicitly downloaded weights. WASM with one thread is the default; WebGPU
  can be selected on supporting devices. The model is released from memory on
  lock/switch/cancel. No inference runs in a Mesh server. SDK, CLI and MCP remain
  follow-up stages. Real mobile-device acceptance and inference benchmarks remain
  necessary before claiming universal iOS/Android support.

## Portable browser runtime

The engine is a pinned build-time dependency, not a server runtime dependency.
It loads only after user selection. The two Q8 public ONNX presets use pinned
Hub revisions and an origin-local per-model cache; generation is cache-only,
never implicitly downloads weights, and never sends prompts to the model host.
The WASM executable and factory are same-origin build assets and the service
worker excludes them from ordinary PWA precache. They are cached when used.
Model weights are not secret and are shared by accounts on the device; they
are not part of encrypted chat backups and can be individually removed from
the AI settings. An emergency app reset also removes the model caches.
Browser storage eviction may require re-downloading a model. Background mobile
tabs may be suspended. No silent cloud fallback is used.

## Current integration and validation — 20 November 2026

This work is selectively ported onto the exact app 0.5.14 baseline
4bb3dba39eedb259ede679ed897282ea62cc47d3 in a separate local working tree.
The old 0.5.2 branch was not merged wholesale. Previously locked dependency
versions and server runtime dependencies are unchanged. New AI packages are
pinned build-time dependencies. No deployment or framework-major upgrade occurs.

The full app/server suite passes (1,535 tests, one existing skip), with two
workers to avoid local resource contention. Node compatibility passes (84 tests,
22 platform skips). Types, 3,159 bilingual messages, the existing dependency
applicability audit, production build, PWA checks and production signaling pass.

Real SmolLM2 135M Q8 generation was exercised through the actual WASM engine in
an isolated browser, with no user account or chat data. After stopping the engine,
cold generation succeeds from cache with external network access blocked. A
separate check of the actual compiled worker also succeeds after a fully offline
page reload, using the real application service worker to retain engine assets.

The browser SDK's discovery helpers can default to main before propagating their
revision option. The remote path template itself is pinned, including cache keys.
Local-only generation enables the SDK's required local lookup but rejects every
fetch on a cache miss. A real-SDK regression test covers this contract. Metadata
Range headers are retained without forwarding Authorization, cookies or bodies.
Model errors and context updates are kept outside the transport receipt path.

## Release gates

Before publication, exercise actual downloads and generation on desktop and
Android/iOS, including cancellation, cold offline reload, memory constraints,
and storage eviction. The 2026-11-20 npm audit reported SvelteKit/adapter-node
advisories, with npm proposing a breaking SvelteKit 3 upgrade. Assess and fix
this independently; do not use `npm audit fix --force` in the AI change.
The regenerated dependency inventory also reports new upstream notice gaps
for ONNX Runtime and guid-typescript. Preserve exact upstream notices before
publishing a distribution; do not claim that the inventory is complete.
