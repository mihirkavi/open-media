# Convo repository guidance

- Read the exact Expo SDK 56 documentation at <https://docs.expo.dev/versions/v56.0.0/> before changing Expo or React Native code.
- Preserve the boundary between `src/domain`, `src/connectors`, `src/data`, and `src/ui`.
- Never add real credentials, tokens, mailbox exports, or personal message data to the repository.
- Keep connector support claims aligned with working code. Mock or proposed connectors must be labeled clearly.
- Keep generated output inside this repository or an operating-system temporary directory.
