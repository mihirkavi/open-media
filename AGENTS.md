# Convo repository guidance

- Read the exact Expo SDK 56 documentation at <https://docs.expo.dev/versions/v56.0.0/> before changing Expo or React Native code.
- Preserve the boundary between `src/domain`, `src/connectors`, `src/data`, and `src/ui`.
- Never add real credentials, tokens, mailbox exports, or personal message data to the repository.
- Keep connector support claims aligned with working code. Mock or proposed connectors must be labeled clearly.
- Keep generated output inside this repository or an operating-system temporary directory.

## Cross-platform verification (required for every change)

Open Media ships as one app on web, iOS, and Android. A change is not done until it is tested on every platform it can affect, not just the one it was written on.

- **Web**: run the app (`npm run local`, or the `web` preview) and exercise the change in a browser at desktop width and at phone width (375 px), signed out and signed in. Check the console for errors.
- **iOS**: run it on the iOS Simulator (`npx expo prebuild --platform ios` when native modules change, `pod install`, then `npx expo run:ios --no-bundler` against the running Metro server). Check layout at phone size, the keyboard, safe areas, and native modules such as video. Local sign-in works on the simulator. A physical iPhone needs a TestFlight build from `npx eas-cli build -p ios --profile production --auto-submit`, which the owner runs.
- **Android**: run it on the Android emulator (`npx expo run:android`). This needs JDK 17 or newer; the Mac currently has JDK 11, so install a newer JDK before the first Android run.
- **Shared logic**: add or update unit tests (`npm run check` covers the typecheck, app and Worker tests, and the web export), and run `npm run test:db` for database changes.
- **Report honestly**: say which platforms were verified and how, and name anything not verified (for example, a feature that needs a real network account, a physical device, or production-only services) instead of implying it works.
