# ADR 0034: Password accounts, and passkeys as a second sign-in step

- Status: **accepted; built and tested locally on the web** (2026-11-07). Not deployed to production yet: that needs the Supabase dashboard settings listed under "Production" and the owner's go-ahead. The iOS and Android apps were not run (the owner asked for web only for now); see "Phones".

## Context

Open Media signed people in only with an email that carried a one-time code and a link. The link uses PKCE, so it works only in the browser that asked for it. On the owner's Mac, the Dock app opens Open Media in a Chrome app window while links open in the default browser (ChatGPT Atlas), so clicking the link never signed the app in. The code always worked, but the email made the link the obvious thing to click.

The owner asked for:

1. A sign-in that isn't tied to one browser.
2. Traditional accounts with a password, so they can sign in from anywhere.
3. Multi-factor sign-in with passkeys.

## Decision

Everything uses Supabase Auth's own features. Open Media adds screens, configuration, and the database rules that make the second step real.

### 1. Passwords alongside email codes

- The sign-in screen opens on **email and password**, with **Forgot password?**, **Email me a code instead** and **Create an account**. The email-code sign-in is unchanged.
- **Sign-up** confirms the address with a 6-digit code (`auth.email.enable_confirmations = true`), so nobody can register with someone else's address. If the address already has an account, Supabase answers the same way without sending a code (it doesn't reveal which addresses exist); the screen says so.
- **Password reset** emails a code, typed into the app together with the new password. No reset link, so it works in any browser or device (`supabase/templates/recovery.html`).
- Accounts made with email codes add a password in **Profile → Sign-in and security → Set password**.
- Rules (`src/domain/passwordRules.ts`): at least 8 characters (also the server minimum), at most 72 bytes (the hash limit, beyond which Supabase would silently cut the password), not only spaces, not the email name. No composition rules: length helps; forced symbols don't.

### 2. Passkeys as an optional second step (WebAuthn MFA)

- **Profile → Sign-in and security → Add passkey** registers one with the device (Touch ID, Face ID, Windows Hello, a phone or a security key). It is named after the device and browser, and can be removed (the last one with a warning).
- With a passkey, every sign-in (password, email code or password reset) ends at **Confirm it's you → Use my passkey**. Supabase raises the session from `aal1` to `aal2`.
- A password reset for an account with a passkey keeps the new password in memory until the passkey step, then saves it (Supabase only changes passwords on `aal2` sessions).
- Passkeys belong to the site: `localhost` locally, `openmedia.site` in production (shared by `www.`). Supabase checks them against `[auth.webauthn]` `rp_id` and `rp_origins` in its own settings, not against what the app sends.

Passkey-only sign-in (no password or code) exists in supabase-js but is marked experimental; the owner chose the second-step design.

### 3. The database is the lock, not the app

Hiding screens isn't security: with a stolen password someone could call the API directly. Migration `20261121120000_passkey_second_step.sql` makes the database refuse an `aal1` session of anyone who has a verified passkey (`open_media_session_meets_mfa()`), in three layers:

1. **PostgREST pre-request check** (`pgrst.db_pre_request`): every API call, including security-definer functions that bypass row-level security, gets `403 open_media_passkey_required`.
2. **A restrictive row-level security policy** on every public table and on `storage.objects`, which also covers Realtime and Storage. An event trigger adds it to tables created later.
3. **The Worker** (`services/mail-sync/src/session.ts`) checks the same function before acting with its own key, cached for a minute per token. It answers `403` (`passkey_required` on the agent API).

People without a passkey are unaffected.

### 4. Local Mac setup only: links work from any browser

The local stack (`npm run local`) already filled in sign-in codes from its test inbox. Now:

- If the link from a local sign-in email opens in another browser, that browser hands the link's one-time code to the local mail service (`/local/sign-in-handoff`), and the window that asked to sign in finishes it (it holds the PKCE verifier). The other browser shows **You're signed in**. The code is useless without the verifier, kept in memory, taken once, and expires after five minutes.
- The app window keeps listening for up to ten minutes instead of giving up after 30 seconds.
- Codes are matched with ten minutes of clock slack, because Docker's clock can lag the Mac's after sleep; a stale code fails to verify and is skipped.
- Sign-up confirmation and reset codes are filled in automatically too.

None of this exists in the Worker or production.

## Phones

The web app is done. The iOS and Android apps share the code: passwords work there, but they can't add or use passkeys yet (the WebAuthn browser API isn't available in React Native). An account with a passkey sees **Confirm it's you** with a note to finish at openmedia.site.

Planned next (owner's choice): the phone's passkey step opens a secure browser sheet (ASWebAuthenticationSession / Custom Tab) on openmedia.site. The app asks Supabase for the challenge with its own session; the page signs it with the passkey and returns only the signed response; the app verifies it with its own session. No tokens travel through the browser. Full native passkeys (a native module, associated domains, `apple-app-site-association` and `assetlinks.json`, new store builds) remain an option after that.

## Agents

Agents that sign in with an email code (`/v1/auth/verify`, or the OAuth **Sign in with Open Media** page for `/account/mcp`) get `aal1` tokens. For an account with a passkey those are refused with `403 passkey_required`; a token copied from the app after the passkey step works. Adding the passkey step to the OAuth approval page is a follow-up.

## Production

Not changed yet. Needed, in the Supabase dashboard for the production project:

- Authentication → Sign In / Providers → Email: **Confirm email** on; minimum password length **8**.
- Authentication → Multi-Factor: **WebAuthn** enroll and verify on; relying party ID `openmedia.site`, origins `https://openmedia.site` and `https://www.openmedia.site`, display name `Open Media`.
- Authentication → Emails → **Reset password** template: the contents of `supabase/templates/recovery.html` (the `{{ .Token }}` code).
- Apply the migration (`supabase db push`), then deploy the Worker and the web app.

## Verification (2026-11-07, local, web, Chrome)

- Password sign-up with the confirmation code filled in, profile setup, sign-in, wrong-password message.
- An email-code account adds a password and signs in with it.
- Add passkey (Chrome virtual authenticator) → sign out → password → **Confirm it's you** → passkey → app. The same after an email code.
- Password reset with a passkey: new password saved after the passkey step; the old one is refused.
- Remove the only passkey (with warning) → a password alone signs in again.
- A password-only token for an account with a passkey: PostgREST `403 open_media_passkey_required`; Worker `403` on `/v1/mail-accounts` and `passkey_required` on `/v1/me/contacts`.
- A link opened in a separate browser profile signs in the window that asked; that browser shows **You're signed in**.
- 375 px wide: sign-in and sign-up fit without sideways scrolling.
- `npm run check` passes; `supabase/tests/open_media_passkey_second_step_test.sql` passes (9 tests).

Not verified: iOS and Android (not run, at the owner's request); real Touch ID/Face ID or a physical security key (a virtual authenticator was used); Safari and Firefox; production.
