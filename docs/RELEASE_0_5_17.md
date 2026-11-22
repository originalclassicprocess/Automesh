# Automesh 0.5.17

- Group AI settings by where the model runs. Browser options explain how to
  select a GGUF file, download or import ONNX weights, or use a built-in model.
- Use the embedded GGUF chat template when present. Files without one use the
  Phi-2 instruction format for that architecture or text completion. The
  optional per-file setting supports text completion and custom prompt formats.
- Show when a GGUF model is loading into memory and when it is generating a
  reply. Give test prompts and Saved Messages more time for large model files.
- Verify local generation with an embedded template, with no embedded
  template, and with a custom format, including offline restart.

See [Account AI](ACCOUNT_AI_V1.md) for file compatibility and offline setup.
