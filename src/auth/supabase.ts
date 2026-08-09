import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';
import * as SecureStore from 'expo-secure-store';
import 'react-native-url-polyfill/auto';
import { AppState, Platform } from 'react-native';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | undefined;

export function getSupabaseClient(): SupabaseClient | undefined {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) return undefined;
  if (!client) {
    client = createClient(url, publishableKey, {
      auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false, flowType: 'pkce' },
    });
    if (Platform.OS !== 'web') {
      AppState.addEventListener('change', (state) => state === 'active' ? client?.auth.startAutoRefresh() : client?.auth.stopAutoRefresh());
    }
  }
  return client;
}

export async function syncAPISession(): Promise<string | undefined> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    await SecureStore.deleteItemAsync('convo.sessionToken');
    return undefined;
  }
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  if (token) await SecureStore.setItemAsync('convo.sessionToken', token);
  else await SecureStore.deleteItemAsync('convo.sessionToken');
  return token;
}

export async function sendSignInLink(email: string): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase Auth is not configured for this build.');
  const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: Linking.createURL('auth') } });
  if (error) throw error;
}

export async function completeSignInURL(url: string): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;
  const code = new URL(url).searchParams.get('code');
  if (!code) return;
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) throw error;
  await syncAPISession();
}
