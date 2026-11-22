# Automesh 0.5.16

- Import compatible single-file GGUF chat models from your computer or phone.
  Keep several files in browser storage and choose one model at a time. In
  **Settings → AI**, choose WASM or WebGPU and try a test prompt of your choice.
- Language instructions are optional. The model receives the text as written
  and any instructions you choose to add.
- Ask AI from the composer in **Saved Messages**. The prompt and answer stay
  in that chat. In connected Meshtastic channels, use **AI** to send a draft
  as an `/ai` request without typing the command.
- Keep per-chat auto-reply preferences and limits when switching models.
  Auto-replies that send text to an API require confirmation for each
  account session and endpoint.
- App upgrades preserve the previously configured ONNX model and engine
  settings. GGUF weights are never included in the app release.

See [Account AI](ACCOUNT_AI_V1.md) for compatible files and offline setup.
