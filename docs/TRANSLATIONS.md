# Interface translations

Automesh includes English and Russian. Choose the language on the sign-in / account creation screen or in **Settings → Application → Interface language**. The choice belongs to this browser, not to an account or node. A fresh browser starts in English. Changing language does not reconnect chats or change keys, addresses, messages, names, file names, or seed words.

## Create a local translation

1. In language settings, prepare and download the JSON template.
2. Set `locale` to a language tag such as `fr` or `pt-BR`, and `name` to the name shown in the selector.
3. Translate the **values** in `messages`. Keep the keys and placeholders such as `{v0}`, `{count}`, and `{total}` unchanged. Placeholders can be reordered but not added, removed, or duplicated.
4. Import the file in the same settings section. It is selected immediately. Missing or empty messages fall back to English. Whitespace-only cells also count as empty. Non-empty messages must preserve all placeholders.

The format is `automesh-ui-translation`, version `1`. Only plain JSON text is accepted: no scripts, HTML, styles, or remote resources. Unknown keys and malformed placeholders are rejected. Each file is limited to 1 MiB; up to five local translations can be saved. Reimporting the same language replaces that local pack. Removing a selected local pack switches to English.

Files are read locally, never uploaded. They contain interface copy, not account data. Browser storage keeps imported packs and the selected language. If storage is blocked or full, the app reports that the translation works for the current tab only. Keep the original JSON file: clearing browser data removes local packs too. These preferences are not an account backup.

## Contribute through GitHub

Propose the JSON and its language/name in a pull request. A reviewer checks wording, placeholders, misleading security claims, layout and accessibility before registering it as a built-in language and shipping a release. Importing locally does not publish a language for everyone. Do not include real messages, private addresses, passwords, seeds, or screenshots of personal accounts in translation contributions.

## Maintaining interface copy

Catalogs live in `src/lib/i18n/locales/ru.json` and `en.json`. Existing Russian copy is the source catalog. Stable `m_…` identifiers are hashes of normalized source copy; changing wording deliberately creates a new entry so that an old translation is not silently used with a new meaning. `language.*` keys describe the translation interface itself.

Run `npm run i18n:check` and `npm run check`. To add reviewed copy:

```sh
node scripts/check-translations.mjs --add 'Русский текст: {v0}' 'English text: {v0}'
```

Use `$i18n(id, {v0: value})` in Svelte for composed copy. Interpolated values are preserved literally and rendered as escaped text. `$i18n.text(source)` adapts app-owned labels and errors from existing helpers at display time. `$i18n.system(source)` is restricted to composed system diagnostics made only of known explanations, codes, counts and units; never pass names, file names, messages, URLs containing user data, or arbitrary server responses to it. Do not translate persisted enum values or protocol fields. Do not use a DOM-wide translator.

Shared controls translate their own app-owned help, placeholders and accessibility labels. Arbitrary option labels and user content remain the caller's responsibility. Dates use the selected UI locale; cryptographic timestamps and identifiers keep their machine format. Password strength feedback uses English or Russian locally; custom languages fall back to English for that dependency's feedback.

Before release, check both languages in entry, recovery, settings, node diagnostics, chats and device screens; test narrow layouts and long values. Localization tests cover fallback, pack validation, persistence, placeholders, and preservation of user content.
