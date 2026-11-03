import { getAPIAccessToken } from '../auth/supabase';
import { AiRecord } from '../domain/aiChat';
import { request } from './mailApiConnector';

/**
 * Open Media AI (ADR 0028): the person's one AI conversation, kept by the Open Media service. The
 * app only reads it and sends messages with the signed-in person's session; keys pasted into it
 * are handled by the service and never come back.
 */

export async function loadAiMessages(): Promise<AiRecord[]> {
  return (await request<{ messages: AiRecord[] }>('/v1/me/ai/messages?limit=300', {}, 'Could not load your AI chat.')).messages;
}

/** Sends one message and returns what was added: yours (with any key hidden) and the answer. */
export async function sendAiMessage(text: string): Promise<AiRecord[]> {
  return (await request<{ messages: AiRecord[] }>('/v1/me/ai/messages', { method: 'POST', body: { text } }, 'The AI didn’t answer. Try again.')).messages;
}

/** The session, when there is one, so an AI search is saved to the AI chat too. */
export async function aiChatHeaders(): Promise<Record<string, string>> {
  const token = await getAPIAccessToken().catch(() => undefined);
  return token ? { authorization: `Bearer ${token}` } : {};
}

const listeners = new Set<() => void>();

/** Lets Messages refresh the AI chat when something else (an AI search) added to it. */
export function onAiChatChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function notifyAiChatChanged() {
  for (const listener of listeners) listener();
}
