import AppleFoundationSearch from '../../modules/apple-foundation-search/src/AppleFoundationSearchModule';
import { Conversation } from '../domain/models';

export type AISearchState =
  | { status: 'idle' | 'loading' }
  | { status: 'unavailable'; reason: string }
  | { status: 'ready'; conversations: Conversation[]; summary: string }
  | { status: 'error'; reason: string };

export async function searchWithAppleFoundationModels(
  query: string,
  conversations: Conversation[],
): Promise<AISearchState> {
  if (!query.trim()) return { status: 'idle' };

  const availability = await AppleFoundationSearch.availabilityAsync();
  if (!availability.available) {
    return { status: 'unavailable', reason: readableAvailability(availability.reason) };
  }

  try {
    const candidates = conversations.map((conversation) => ({
      id: conversation.id,
      title: conversation.groupTitle ?? conversation.participants.map((person) => person.name).join(', '),
      text: conversation.messages
        .map((message) => [message.emailContext?.subject, message.body].filter(Boolean).join(': '))
        .join('\n'),
    }));
    const result = await AppleFoundationSearch.searchAsync(query, JSON.stringify(candidates));
    const byId = new Map(conversations.map((conversation) => [conversation.id, conversation]));
    return {
      status: 'ready',
      conversations: result.ids.map((id) => byId.get(id)).filter((item): item is Conversation => Boolean(item)),
      summary: result.summary,
    };
  } catch (error) {
    return { status: 'error', reason: error instanceof Error ? error.message : 'AI search failed.' };
  }
}

function readableAvailability(reason?: string): string {
  if (!reason) return 'Apple Intelligence is not available on this device.';
  if (reason.includes('deviceNotEligible')) return 'This device does not support Apple Intelligence.';
  if (reason.includes('appleIntelligenceNotEnabled')) return 'Turn on Apple Intelligence to use private AI search.';
  if (reason.includes('modelNotReady')) return 'Apple Intelligence is still downloading its on-device model.';
  if (reason.includes('native Apple app')) return reason;
  if (reason.includes('development or release build')) return reason;
  return 'AI search needs iOS 26 or later, a supported device, and Apple Intelligence enabled.';
}
