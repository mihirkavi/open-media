/**
 * The end of a web connect window (see `oauthWindow.ts`). No imports, so the app's entry can
 * check for it without loading anything else.
 */
export const oauthStatePrefix = 'omc_';
export const oauthChannelName = 'open-media-oauth';

/**
 * Called first thing on web. When this page is the end of a connect window, it hands the result
 * to the tab that started it and closes, instead of loading the whole app. Returns true then.
 */
export function completeOAuthWindow(): boolean {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  if (window.location.pathname !== '/auth' || !params.get('state')?.startsWith(oauthStatePrefix)) return false;
  const channel = new BroadcastChannel(oauthChannelName);
  channel.postMessage({ url: window.location.href });
  channel.close();
  document.body.innerHTML = '<p style="font:16px -apple-system,system-ui,sans-serif;text-align:center;margin-top:30vh;color:#666">Connected. You can close this window.</p>';
  window.history.replaceState(null, '', '/auth');
  setTimeout(() => window.close(), 300);
  return true;
}
