import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import './urlPolyfill';
import { AppState, Platform } from 'react-native';
import { createClient, processLock, SupabaseClient, SupportedStorage } from '@supabase/supabase-js';

import { createAuthRedirectURL, parseAuthCallbackURL, signInEmailsIncludeCode } from '../domain/authCallback';

let client: SupabaseClient | undefined;
let nativeStorage: ChunkedSecureStorage | undefined;

export function getSupabaseClient(): SupabaseClient | undefined {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) return undefined;
  if (!client) {
    client = createClient(url, publishableKey, {
      auth: {
        storage: deviceSecretStorage(),
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
        flowType: 'pkce',
        lock: processLock,
      },
    });
    if (Platform.OS !== 'web') {
      AppState.addEventListener('change', (state) => state === 'active' ? client?.auth.startAutoRefresh() : client?.auth.stopAutoRefresh());
    }
  }
  return client;
}

/**
 * Where this device keeps secrets such as delegated network keys: the Keychain/Keystore on phones
 * (this device only, never backed up) and browser storage on web, the same place as the session.
 */
export function deviceSecretStorage(): SupportedStorage {
  return Platform.OS === 'web' ? AsyncStorage : (nativeStorage ??= new ChunkedSecureStorage());
}

export async function getAPIAccessToken(): Promise<string | undefined> {
  const supabase = getSupabaseClient();
  if (!supabase) return undefined;
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session?.access_token;
}

export async function sendSignInLink(email: string): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase Auth is not configured for this build.');
  const webOrigin = Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : undefined;
  const emailRedirectTo = createAuthRedirectURL(Platform.OS === 'web' ? 'web' : 'native', webOrigin);
  const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo } });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/**
 * Local Mac setup only: sign-in emails go to the local test inbox, so the local
 * mail service hands back the code and the app finishes sign-in by itself.
 * Off unless `npm run local` enabled it and the API is on this computer.
 */
export function localAutoSignInAvailable(): boolean {
  const api = process.env.EXPO_PUBLIC_OPEN_MEDIA_API_URL ?? '';
  return process.env.EXPO_PUBLIC_LOCAL_AUTO_SIGN_IN === '1' && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(api.replace(/\/$/, ''));
}

/** Whether this build's sign-in emails include a one-time code; see signInEmailsIncludeCode. */
export function signInEmailHasCode(): boolean {
  return signInEmailsIncludeCode(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.EXPO_PUBLIC_SIGN_IN_EMAIL_CODES);
}

/**
 * Local Mac setup only: waits until this window can finish signing in, either from the code in the
 * local test inbox or from a sign-in link opened in another browser (see handOffSignInLink).
 * Codes in `skip` were already tried (for example an older email) and are ignored.
 */
export async function waitForLocalSignIn(email: string, since: Date, options: { timeoutMs: number; skip?: Set<string>; cancelled?: () => boolean }): Promise<{ code: string } | { linkCode: string } | undefined> {
  const api = localAPI();
  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() < deadline && !options.cancelled?.()) {
    try {
      const handoff = await fetch(`${api}/local/sign-in-handoff`);
      if (handoff.status === 200) {
        const { code } = (await handoff.json()) as { code?: string };
        if (code) return { linkCode: code };
      }
      const response = await fetch(`${api}/local/sign-in-code?email=${encodeURIComponent(email.trim())}&since=${encodeURIComponent(since.toISOString())}`);
      if (response.status === 200) {
        const { code } = (await response.json()) as { code?: string };
        if (code && !options.skip?.has(code)) return { code };
      }
    } catch {
      // The local service may still be starting; keep waiting.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return undefined;
}

/** Finishes sign-in with a link's one-time code that another browser handed to this window. */
export async function completeHandedOffSignIn(linkCode: string): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase Auth is not configured for this build.');
  const { error } = await supabase.auth.exchangeCodeForSession(linkCode);
  if (error) throw new Error(friendlyLinkError(`${error.name} ${error.message}`));
}

/** Thrown when this browser passed a sign-in link on to the Open Media window that asked for it. */
export class SignInHandedOff extends Error {
  constructor() { super('You’re signed in in the Open Media window. You can close this tab.'); }
}

function localAPI() { return (process.env.EXPO_PUBLIC_OPEN_MEDIA_API_URL ?? '').replace(/\/$/, ''); }

/**
 * Local Mac setup only: the link was opened in a browser that didn't ask to sign in, so it can't
 * use the link itself (PKCE). Hand the code to the local service for the window that asked.
 */
async function handOffSignInLink(code: string): Promise<boolean> {
  try {
    const response = await fetch(`${localAPI()}/local/sign-in-handoff`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
    return response.ok;
  } catch {
    return false;
  }
}

/** Signs in with the one-time code from the sign-in email. Works on any browser or device. */
export async function verifySignInCode(email: string, code: string): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase Auth is not configured for this build.');
  const token = code.replace(/\s+/g, '');
  if (!/^\d{6,10}$/.test(token)) throw new Error('Enter the code from your sign-in email.');
  const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token, type: 'email' });
  if (error) throw new Error('That code is invalid or has expired. Request a new one and try again.');
}

export async function completeSignInURL(url: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  if (!supabase) return false;
  const callback = parseAuthCallbackURL(url);
  if (!callback) return false;
  try {
    if (callback.error) throw new Error(friendlyLinkError(callback.error));
    if (!callback.code) return false;
    const { error } = await supabase.auth.exchangeCodeForSession(callback.code);
    if (error) {
      // Opened in a different browser than the one that asked (the code isn't spent yet, since the
      // check happens before any request). On this Mac's local setup, pass it to that window.
      const otherBrowser = (error as { code?: string }).code === 'pkce_code_verifier_not_found';
      if (otherBrowser && Platform.OS === 'web' && localAutoSignInAvailable() && await handOffSignInLink(callback.code)) throw new SignInHandedOff();
      throw new Error(friendlyLinkError(`${error.name} ${error.message}`));
    }
    return true;
  } finally {
    // Never leave a used or failed one-time code in the address bar.
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const cleanPath = window.location.pathname.replace(/\/auth\/?$/, '/') || '/';
      window.history.replaceState({}, document.title, cleanPath);
    }
  }
}

function friendlyLinkError(detail: string): string {
  if (/code.?verifier/i.test(detail)) {
    return 'This sign-in link was opened in a different browser or app than the one that requested it. Enter the code from the email instead.';
  }
  if (/expired|invalid/i.test(detail)) return 'This sign-in link is invalid or has expired. Enter the code from the email, or request a new link.';
  return detail;
}

class ChunkedSecureStorage implements SupportedStorage {
  private readonly chunkSize = 1800;
  private readonly options: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

  async getItem(key: string): Promise<string | null> {
    const count = Number(await SecureStore.getItemAsync(this.manifestKey(key), this.options));
    if (Number.isInteger(count) && count > 0) {
      const chunks = await Promise.all(Array.from({ length: count }, (_, index) => SecureStore.getItemAsync(this.chunkKey(key, index), this.options)));
      if (chunks.every((chunk): chunk is string => chunk !== null)) return chunks.join('');
      await this.removeItem(key);
    }

    const legacy = await AsyncStorage.getItem(key);
    if (legacy !== null) {
      await this.setItem(key, legacy);
      await AsyncStorage.removeItem(key);
    }
    return legacy;
  }

  async setItem(key: string, value: string): Promise<void> {
    await this.removeSecureValue(key);
    const chunks = value.match(new RegExp(`.{1,${this.chunkSize}}`, 'gs')) ?? [''];
    await Promise.all(chunks.map((chunk, index) => SecureStore.setItemAsync(this.chunkKey(key, index), chunk, this.options)));
    await SecureStore.setItemAsync(this.manifestKey(key), String(chunks.length), this.options);
    await AsyncStorage.removeItem(key);
  }

  async removeItem(key: string): Promise<void> {
    await this.removeSecureValue(key);
    await AsyncStorage.removeItem(key);
  }

  private async removeSecureValue(key: string): Promise<void> {
    const count = Number(await SecureStore.getItemAsync(this.manifestKey(key), this.options));
    if (Number.isInteger(count) && count > 0) {
      await Promise.all(Array.from({ length: count }, (_, index) => SecureStore.deleteItemAsync(this.chunkKey(key, index))));
    }
    await SecureStore.deleteItemAsync(this.manifestKey(key));
  }

  private manifestKey(key: string) { return `${key}.parts`; }
  private chunkKey(key: string, index: number) { return `${key}.part.${index}`; }
}
