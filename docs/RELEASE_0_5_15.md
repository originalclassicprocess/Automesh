# Automesh 0.5.15

- Enable account AI from its own settings section. Choose an on-device model,
  a browser model, a local engine, or an OpenAI-compatible HTTPS endpoint.
  Check the connection with a sample prompt before allowing auto-replies.
  Connection errors distinguish credentials, permissions, quota, rate limits
  and network failures without displaying the provider's response body.
- Download on-device model weights with interruption recovery, or import matching
  ONNX weights from disk. Verify weights before use and run inference from the
  browser cache over WASM or WebGPU.
- Allow short Russian auto-replies to selected personal contacts. Set optional
  request limits per conversation and sender. In Meshtastic channels, use
  `/ai <request>` and configure per-board limits.
- Add the emoji picker and received reactions to Meshtastic channels. Associate
  each reaction with the original packet and deduplicate retransmissions.
  Send personal chat reactions over the encrypted radio route when LoRa is
  selected for that conversation.
- Include license notices for the browser inference engine and its assets.

AI starts disabled. Authorization for auto-replies and API credentials live
in the active session. A remote provider receives the text of the triggering
message and the configured instructions. For peer setup and model details, see
[Account AI](ACCOUNT_AI_V1.md).

Local verification covered browser inference, simulated remote API replies
and errors, and simulated radio traffic. The live OpenAI test returned HTTP
429, so successful live generation still needs verification.
