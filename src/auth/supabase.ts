import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';
import * as SecureStore from 'expo-secure-store';
import 'react-native-url-polyfill/auto';
import { AppState, Platform } from 'react-native';
import { createClient, processLock, SupabaseClient, SupportedStorage } from '@supabase/supabase-js';

import { parseAuthCallbackURL } from '../domain/authCallback';

let client: SupabaseClient | undefined;
let nativeStorage: ChunkedSecureStorage | undefined;

export function getSupabaseClient(): SupabaseClient | undefined {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) return undefined;
  if (!client) {
    client = createClient(url, publishableKey, {
      auth: {
        storage: Platform.OS === 'web' ? AsyncStorage : (nativeStorage ??= new ChunkedSecureStorage()),
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
  const emailRedirectTo = Platform.OS === 'web' ? Linking.createURL('auth') : Linking.createURL('auth', { scheme: 'openmedia' });
  const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo } });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function completeSignInURL(url: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  if (!supabase) return false;
  const callback = parseAuthCallbackURL(url);
  if (!callback) return false;
  if (callback.error) throw new Error(callback.error);
  if (!callback.code) return false;
  const { error } = await supabase.auth.exchangeCodeForSession(callback.code);
  if (error) throw error;
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const cleanPath = window.location.pathname.replace(/\/auth\/?$/, '/') || '/';
    window.history.replaceState({}, document.title, cleanPath);
  }
  return true;
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
