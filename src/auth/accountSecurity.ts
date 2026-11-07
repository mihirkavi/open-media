/**
 * Passwords and passkeys for Open Media accounts (ADR 0034).
 *
 * - Password accounts sit alongside email codes. Signing up confirms the address with a 6-digit code;
 *   a forgotten password is reset with a code too, so nothing depends on opening a link in a
 *   particular browser.
 * - Passkeys are an optional second step after the password or email code (Supabase WebAuthn MFA).
 *   Once someone adds one, the database refuses their sessions until it is used (aal2).
 *   Adding and using passkeys works in the web app; the phone apps get it next (see ADR 0034).
 */
import { Platform } from 'react-native';
import type { Factor } from '@supabase/supabase-js';

import { passkeyRelyingParty, passkeysSwitchedOffError, passwordProblem } from '../domain/passwordRules';
import { getSupabaseClient } from './supabase';

function client() {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase Auth is not configured for this build.');
  return supabase;
}

function friendly(error: { message?: string; code?: string } | null | undefined, fallback: string): Error {
  const message = error?.message ?? '';
  if (error?.code === 'invalid_credentials' || /invalid login credentials/i.test(message)) return new Error('That email and password don’t match. Check them, or reset your password.');
  if (error?.code === 'email_not_confirmed' || /email not confirmed/i.test(message)) return new Error('Confirm your email first: enter the code we sent when you signed up, or sign up again to get a new one.');
  if (error?.code === 'weak_password' || /password should be/i.test(message)) return new Error('Choose a longer password (at least 8 characters).');
  if (error?.code === 'over_email_send_rate_limit' || /rate limit|security purposes/i.test(message)) return new Error('Too many emails were sent just now. Wait a minute, then try again.');
  if (error?.code === 'same_password') return new Error('That is already your password. Choose a different one.');
  if (/otp|token|expired|invalid/i.test(message)) return new Error('That code is invalid or has expired. Request a new one and try again.');
  return new Error(message || fallback);
}

function cleanCode(code: string) {
  const token = code.replace(/\s+/g, '');
  if (!/^\d{6,10}$/.test(token)) throw new Error('Enter the code from your email.');
  return token;
}

function checkPassword(password: string, email?: string) {
  const problem = passwordProblem(password, email);
  if (problem) throw new Error(problem);
}

export async function signInWithPassword(email: string, password: string): Promise<void> {
  const { error } = await client().auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw friendly(error, 'Could not sign in. Try again.');
}

/**
 * Creates a password account. The address is confirmed with a code before the account can sign in.
 * If the address already has an account, Supabase deliberately answers the same way (so no one can
 * probe which addresses exist); the person then gets no code and can sign in or reset instead.
 */
export async function signUpWithPassword(email: string, password: string): Promise<void> {
  checkPassword(password, email);
  const { error } = await client().auth.signUp({ email: email.trim(), password });
  if (error) throw friendly(error, 'Could not create the account. Try again.');
}

/** Confirms a new account's email with the code from the sign-up email, which signs it in. */
export async function confirmSignUp(email: string, code: string): Promise<void> {
  const { error } = await client().auth.verifyOtp({ email: email.trim(), token: cleanCode(code), type: 'email' });
  if (error) throw friendly(error, 'Could not confirm the code.');
}

export async function sendPasswordResetCode(email: string): Promise<void> {
  const { error } = await client().auth.resetPasswordForEmail(email.trim());
  if (error) throw friendly(error, 'Could not send the reset code. Try again.');
}

/** Uses the reset code (which signs the person in) and then sets the new password. */
export async function resetPasswordWithCode(email: string, code: string, newPassword: string): Promise<void> {
  checkPassword(newPassword, email);
  const supabase = client();
  const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: cleanCode(code), type: 'recovery' });
  if (error) throw friendly(error, 'Could not confirm the code.');
  const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
  // With a passkey, Supabase only changes the password after the passkey step (aal2). Keep the new
  // password in memory until then; completePasskeyStep saves it. It is never stored anywhere.
  if (updateError && (updateError as { code?: string }).code === 'insufficient_aal') { pendingNewPassword = newPassword; return; }
  if (updateError) throw friendly(updateError, 'Could not save the new password.');
}

let pendingNewPassword: string | undefined;

/** True while a password reset is waiting for the passkey step before it can be saved. */
export function passwordResetWaitingForPasskey(): boolean { return pendingNewPassword !== undefined; }

/** Forgets a reset that was waiting for the passkey (for example after signing out). */
export function forgetPendingPasswordReset(): void { pendingNewPassword = undefined; }

/** Sets or changes the signed-in person's password (accounts made with email codes can add one). */
export async function setPassword(newPassword: string, email?: string): Promise<void> {
  checkPassword(newPassword, email);
  const { error } = await client().auth.updateUser({ password: newPassword });
  if (error) throw friendly(error, 'Could not save the password.');
}

// Passkeys ------------------------------------------------------------------------------------

export interface Passkey { id: string; name: string; addedAt: string }

/** Whether this app can add or use a passkey here: the web app in a browser with WebAuthn. */
export function passkeysSupportedHere(): boolean {
  return Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function' && window.isSecureContext;
}

function relyingParty() {
  return passkeyRelyingParty(window.location);
}

function toPasskey(factor: Factor): Passkey {
  return { id: factor.id, name: factor.friendly_name || 'Passkey', addedAt: factor.created_at };
}

export async function listPasskeys(): Promise<Passkey[]> {
  const { data, error } = await client().auth.mfa.listFactors();
  if (error) throw friendly(error, 'Could not load your passkeys.');
  return data.all.filter((factor) => factor.factor_type === 'webauthn' && factor.status === 'verified').map(toPasskey);
}

/** Creates a passkey on this device (Touch ID, Face ID, Windows Hello, a phone or security key). */
export async function addPasskey(name: string): Promise<void> {
  if (!passkeysSupportedHere()) throw new Error('Add a passkey from Open Media on the web, in a browser that supports passkeys.');
  const supabase = client();
  // A passkey started but never finished leaves an unverified factor behind; clear those first so the
  // name can be reused and the limit isn't reached.
  const { data } = await supabase.auth.mfa.listFactors();
  for (const factor of data?.all ?? []) {
    if (factor.factor_type === 'webauthn' && factor.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: factor.id });
  }
  const { error } = await supabase.auth.mfa.webauthn.register({ friendlyName: uniqueName(name.trim() || 'Passkey', data?.all ?? []), webauthn: relyingParty() });
  if (error) throw passkeyError(error, 'Could not add the passkey.');
}

function uniqueName(name: string, factors: Factor[]): string {
  const taken = new Set(factors.filter((factor) => factor.status === 'verified').map((factor) => factor.friendly_name));
  if (!taken.has(name)) return name;
  for (let index = 2; ; index += 1) if (!taken.has(`${name} ${index}`)) return `${name} ${index}`;
}

export async function removePasskey(id: string): Promise<void> {
  const supabase = client();
  const { error } = await supabase.auth.mfa.unenroll({ factorId: id });
  if (error) throw friendly(error, 'Could not remove the passkey.');
  // The session stays aal2 for the remaining passkeys; refresh so the database sees the change.
  await supabase.auth.refreshSession();
}

/** True when this person has a passkey and this session hasn't used it yet. */
export async function passkeyStepNeeded(): Promise<boolean> {
  const { data, error } = await client().auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) throw friendly(error, 'Could not check your sign-in.');
  return data.nextLevel === 'aal2' && data.currentLevel !== 'aal2';
}

/** Confirms this sign-in with one of the person's passkeys (the browser offers the right one). */
export async function completePasskeyStep(): Promise<void> {
  if (!passkeysSupportedHere()) throw new Error('This account uses a passkey. Passkeys in the phone app are coming next; for now, sign in at openmedia.site.');
  const passkeys = await listPasskeys();
  if (!passkeys.length) throw new Error('No passkey was found for this account.');
  const supabase = client();
  let lastError: unknown;
  // The browser asks for one specific passkey at a time; try the newest first.
  for (const passkey of [...passkeys].sort((a, b) => b.addedAt.localeCompare(a.addedAt))) {
    const { error } = await supabase.auth.mfa.webauthn.authenticate({ factorId: passkey.id, webauthn: relyingParty() });
    if (!error) {
      if (pendingNewPassword !== undefined) {
        const password = pendingNewPassword;
        pendingNewPassword = undefined;
        const { error: updateError } = await supabase.auth.updateUser({ password });
        if (updateError) throw friendly(updateError, 'Signed in, but the new password couldn’t be saved. Set it again in Profile → Sign-in and security.');
      }
      return;
    }
    lastError = error;
    // Cancelling the prompt means "stop", not "try the next one".
    if (/NotAllowedError|cancel|abort/i.test(`${(error as Error).name} ${(error as Error).message}`)) break;
  }
  throw passkeyError(lastError as Error, 'Could not confirm with your passkey.');
}

/** The server has passkeys (WebAuthn MFA) switched off, so offering them would only fail. */
export class PasskeysSwitchedOff extends Error {
  constructor() { super('Passkeys aren’t switched on for Open Media yet. Try again later.'); }
}

function passkeyError(error: Error, fallback: string): Error {
  const detail = `${error?.name ?? ''} ${error?.message ?? ''} ${(error as { code?: string })?.code ?? ''}`;
  if (passkeysSwitchedOffError(detail)) return new PasskeysSwitchedOff();
  if (/NotAllowedError|cancel|abort|timed out/i.test(detail)) return new Error('The passkey prompt was closed or timed out. Try again.');
  if (/InvalidStateError|already registered/i.test(detail)) return new Error('This device already has a passkey for your account.');
  if (/SecurityError|rp ?id|origin/i.test(detail)) return new Error('Passkeys aren’t available at this web address.');
  return new Error(error?.message || fallback);
}
