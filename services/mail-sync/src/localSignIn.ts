/**
 * Local-only sign-in helper. With the local stack, Supabase delivers sign-in
 * emails to the local test inbox (Mailpit) instead of a real mailbox. This
 * reads the newest code for an address so the app can finish signing in on its
 * own. It exists only in the local Node.js server (never in the Worker), only
 * when LOCAL_INBOX_URL is set, and only reads mail already visible to anyone
 * on this computer at that inbox.
 */
export async function latestSignInCode(inboxURL: string, email: string, since: Date, fetchImpl: typeof fetch = fetch): Promise<string | undefined> {
  const query = encodeURIComponent(`to:"${email}" subject:"Open Media"`);
  const search = await fetchImpl(`${inboxURL}/api/v1/search?query=${query}&limit=5`);
  if (!search.ok) return undefined;
  const { messages = [] } = await search.json() as { messages?: Array<{ ID: string; Created: string }> };
  // The inbox runs in Docker, whose clock can drift minutes behind the Mac's (often after sleep),
  // so a fresh email can look older than the request. Allow generous slack; if this returns an
  // older code, it fails to verify and the app keeps waiting for the next one.
  const recent = messages
    .filter((message) => Date.parse(message.Created) >= since.getTime() - clockSlackMs)
    .sort((a, b) => Date.parse(b.Created) - Date.parse(a.Created))[0];
  if (!recent) return undefined;
  const message = await fetchImpl(`${inboxURL}/api/v1/message/${encodeURIComponent(recent.ID)}`);
  if (!message.ok) return undefined;
  const { Text = '' } = await message.json() as { Text?: string };
  return Text.match(/\b(\d{6,10})\b/)?.[1];
}

const clockSlackMs = 10 * 60 * 1000;

/**
 * Sign-in link handoff, local only. The Dock app opens Open Media in a Chrome app window, but the
 * link in the sign-in email opens in the Mac's default browser, which can't finish a sign-in it
 * didn't start (PKCE). That browser hands the link's one-time code here, and the app window that
 * asked to sign in (it holds the PKCE verifier) picks it up. The code is useless without that
 * verifier, is kept in memory only, is taken once, and expires after a few minutes.
 */
export function createSignInHandoff(ttlMs = 5 * 60 * 1000, now: () => number = Date.now) {
  let pending: { code: string; at: number } | undefined;
  return {
    put(code: string): boolean {
      if (!/^[\w-]{8,200}$/.test(code)) return false;
      pending = { code, at: now() };
      return true;
    },
    take(): string | undefined {
      const current = pending;
      pending = undefined;
      return current && now() - current.at <= ttlMs ? current.code : undefined;
    },
  };
}
