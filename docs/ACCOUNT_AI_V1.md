# Account AI integration — stage 1

AI is an optional local mode of an existing account, not a new identity class.
The user can dedicate a separate identity to AI or enable it on a personal account.
The adapter does not hold identity keys, discover contacts, read other profiles or
execute tools. The existing client controls the data supplied to it and delivery.

## User flow

1. Open **Settings → AI**, enable it and select a backend.
2. Under **Run in browser**, choose **Choose GGUF file**, then select a single
   `.gguf` file from device storage. Add more files to switch between models.
   Choose WASM for CPU inference or WebGPU for hardware acceleration.
   Browser native: check availability of the browser's own built-in model. Local: enter an
   OpenAI-compatible loopback endpoint (e.g. Ollama at
   `http://localhost:11434/v1/chat/completions`) and model name. Remote API
   accepts an HTTPS chat-completions endpoint for a cloud service or your server.
3. Enter a test prompt and check the answer. Model instructions, including
   language preferences, are optional. Save the settings.
4. Open an accepted contact's chat, click **AI** beside the composer and enable
   **Reply to this contact**. New text messages receive auto-replies
   labeled `[AI]`. Repeat for each contact who should have access.
5. Open **AI chat** in the chat list and send a message to the model. This
   conversation uses a browser model and keeps its own local transcript. Recent
   completed exchanges provide context for follow-up messages. Choose an
   imported GGUF file in the header to change the model for this chat.
6. In a connected Meshtastic channel, use **AI** to send a typed prompt as
   `/ai <request>` or enable responses to such requests. Replies are sent as quoted, plain-text channel
   messages and fit the 200-byte Meshtastic limit. Regular channel messages
   are ignored by AI.

## Boundaries

- Disabled by default; configuration is scoped to the account's encrypted chat
  store. Per-chat auto-reply preferences survive model changes and account
  locks. API keys and permission to send automatic requests to an endpoint
  are session-only. Locking or switching accounts aborts outstanding requests.
- Inference receives text from the triggering message. Files, calls, ephemeral
  messages, chat history and control messages stay out of the prompt. Reply
  generation runs sequentially. While one request is active, committed messages
  are queued in memory. Each chat controls the number of requests per sender
  over a time window beginning with the first request. The channel default
  is one request per hour per radio. The local radio is unlimited by default,
  and the owner can set overrides by radio number. Radio numbers do not
  authenticate sender identity. Limits and usage are stored with local history.
- Requests are direct browser requests. No Mesh Autonomy relay or model billing.
  Remote endpoints must use HTTPS and allow the web application's origin via
  CORS. Local mode only accepts loopback addresses; browser mixed-content/local
  network policy may restrict access. No redirect or cookie forwarding.
- Cloud mode respects the existing internet-disabled setting. External engines
  receive the selected text; browser inference does not send it to a model API.
- A common committed-incoming event
  supports direct, mailbox, Courier and personal LoRa messages. Events contain
  only a peer and message reference and are emitted after successful commit,
  never on duplicate delivery or history import. Messages marked `[AI]` do not
  invoke the model. Radio replies use the same
  radio transport and fit the encoded 320-byte payload, including metadata.
  Failed writes are not automatically replayed into the model. Model errors do
  not affect message acknowledgements, and no automatic requests are retried.
- The browser native backend uses the optional LanguageModel API. Model files
  run through a llama.cpp worker. The legacy ONNX engine uses Transformers.js.
  WASM is the default; WebGPU can be selected on supporting devices.
  The model is released from memory on
  lock/switch/cancel. No inference runs in a Mesh server. SDK, CLI and MCP remain
  follow-up stages. Real mobile-device acceptance and inference benchmarks remain
  necessary before claiming universal iOS/Android support.

## Model files and offline use

Use compatible single-file GGUF releases. Automesh uses the embedded chat
template when available. For files without one it uses the Phi-2 instruction
format when the architecture is Phi-2, or runs text completion. The optional
per-file **Prompt format** setting lets the user choose text completion or
provide a template with a `{{prompt}}` placeholder. A fallback format
does not guarantee that weights trained on a different format will follow
instructions. Browser inference supports text requests. Available RAM, the model
architecture, its quantization, and the browser's WebAssembly and GPU support
determine what runs. The file
size alone does not measure the memory required for inference.

Automesh stores a copy of each selected model in browser storage. The picker
uses the OS file dialog on desktop and mobile. The first test loads the
runtime from the Automesh origin. Once cached by the service worker, it can
open the file offline. Storage is shared across profiles on that browser
origin, and deletion in AI settings removes only the browser copy. An
emergency app reset clears the model library as well. Browser storage eviction
can require importing files again.

**Settings → Media and storage → Storage manager → AI models** lists GGUF
files and ONNX caches for this browser. It shows the model in use in this tab.
**Unload from memory** ends its worker. **Remove from storage** removes only
the browser copy of the selected model. The size shown is the saved file or
cache payload size.

## ONNX download and import

The engine is a pinned build-time dependency, not a server runtime dependency.
It loads only after user selection. The two Q8 public ONNX presets use pinned
Hub revisions and an origin-local per-model cache; generation is cache-only,
never implicitly downloads weights, and never sends prompts to the model host.
The model settings can download weights in verified ranges and resume with
the cached parts after an interruption. They can also copy a matching
`model_quantized.onnx` file selected from disk. Imported and assembled weights
are checked against the pinned SHA-256 before becoming available for inference.
First-time setup still needs the configuration and tokenizer from the Hub if
they are absent from the browser cache. During a download, allow space for the
cached parts and the assembled file.
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

Desktop SmolLM2/WASM and cold offline reload have been verified. Check the
Qwen preset, WebGPU, physical phones, and behavior under memory pressure or
storage eviction before claiming support for those scenarios.
The 2026-11-20 npm audit reported SvelteKit/adapter-node
advisories, with npm proposing a breaking SvelteKit 3 upgrade. Assess and fix
this independently; do not use `npm audit fix --force` in the AI change.
The generated dependency notices include the ONNX Runtime MIT text and the
third-party notices from the pinned web runtime revision. See the
[dependency license review](DEPENDENCY_LICENSE_REVIEW.md) for the remaining
installed-package gaps and what ships in the browser build.
