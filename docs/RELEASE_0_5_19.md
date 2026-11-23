# Automesh 0.5.19

- Storage shows a single breakdown for app components, profile data, chat
  files, AI model copies, and the GIF and sticker library. The dashboard
  distinguishes browser estimates from measured sizes and tab memory.
- Clear all chat files, files in selected chats, or message history while
  keeping attachment cards and files. Clear a single chat independently.
- Routine cleanup preserves GIFs and sticker packs. The library has a
  separate action to delete all packs while keeping GIFs and assets used
  by messages.
- AI storage separates browser copies of model files, the current tab's
  loaded model, and optional engine cache. Clearing engine cache preserves
  saved models and the app's offline shell.
