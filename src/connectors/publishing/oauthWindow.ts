import { getRandomValues } from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { oauthChannelName as channelName, oauthStatePrefix } from './oauthCallback';
import { ApprovalPrompt, PublishingError } from './types';

/**
 * Runs an OAuth authorization in a secure browser window and returns the redirect URL.
 *
 * - iOS and Android: an auth session (ASWebAuthenticationSession / Custom Tabs) that returns to
 *   `openmedia://oauth`.
 * - Web: a pop-up that returns to this site's `/auth` page, which passes the result back over a
 *   BroadcastChannel (see `completeOAuthWindow`). If the browser blocks the pop-up, the approval
 *   card's button opens the same page from a real tap.
 */

export function oauthRedirectURI(): string {
  if (Platform.OS !== 'web') return 'openmedia://oauth';
  return `${window.location.origin}/auth`;
}

export function newOAuthState(): string {
  const bytes = getRandomValues(new Uint8Array(16));
  return `${oauthStatePrefix}${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export async function runOAuthWindow(url: string, state: string, prompt: Omit<ApprovalPrompt, 'url'>, context: { showApproval(prompt: ApprovalPrompt | undefined): void; signal: AbortSignal }): Promise<URL> {
  if (Platform.OS !== 'web') {
    const result = await WebBrowser.openAuthSessionAsync(url, oauthRedirectURI());
    if (result.type !== 'success') throw new PublishingError('Sign-in was closed before it finished.');
    const redirect = new URL(result.url);
    if (redirect.searchParams.get('state') !== state) throw new PublishingError('That sign-in didn’t match. Try again.');
    return redirect;
  }
  return new Promise<URL>((resolve, reject) => {
    const channel = new BroadcastChannel(channelName);
    let popup: Window | null = null;
    const done = () => { channel.close(); context.showApproval(undefined); try { popup?.close(); } catch { /* cross-origin */ } };
    channel.onmessage = (event: MessageEvent<{ url?: string }>) => {
      try {
        const redirect = new URL(String(event.data?.url));
        if (redirect.searchParams.get('state') !== state) return;
        done();
        resolve(redirect);
      } catch { /* not ours */ }
    };
    context.signal.addEventListener('abort', () => { done(); reject(new PublishingError('Connecting was cancelled.')); }, { once: true });
    popup = window.open(url, 'open-media-oauth', 'popup,width=520,height=720');
    context.showApproval({ ...prompt, url });
  });
}
