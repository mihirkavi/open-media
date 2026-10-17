/**
 * Local-only sign-in helper. With the local stack, Supabase delivers sign-in
 * emails to the local test inbox (Mailpit) instead of a real mailbox. This
 * reads the newest code for an address so the app can finish signing in on its
 * own. It exists only in the local Node.js server (never in the Worker), only
 * when LOCAL_INBOX_URL is set, and only reads mail already visible to anyone
 * on this computer at that inbox.
 */
export async function latestSignInCode(inboxURL: string, email: string, since: Date, fetchImpl: typeof fetch = fetch): Promise<string | undefined> {
  const query = encodeURIComponent(`to:"${email}" subject:"sign-in code"`);
  const search = await fetchImpl(`${inboxURL}/api/v1/search?query=${query}&limit=5`);
  if (!search.ok) return undefined;
  const { messages = [] } = await search.json() as { messages?: Array<{ ID: string; Created: string }> };
  const recent = messages
    .filter((message) => Date.parse(message.Created) >= since.getTime() - 5000)
    .sort((a, b) => Date.parse(b.Created) - Date.parse(a.Created))[0];
  if (!recent) return undefined;
  const message = await fetchImpl(`${inboxURL}/api/v1/message/${encodeURIComponent(recent.ID)}`);
  if (!message.ok) return undefined;
  const { Text = '' } = await message.json() as { Text?: string };
  return Text.match(/\b(\d{6,10})\b/)?.[1];
}
