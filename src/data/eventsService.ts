import { apiConfigured, getAPIURL } from '../connectors/mailApiConnector';
import { PublicEvent, socialPostFromEvent } from '../domain/listings';
import { SocialPost } from '../domain/posts';

export { interleaveEvents } from '../domain/listings';

/**
 * Upcoming public events for the Feed (ADR 0013, phase 3), read from the Open Media service. No
 * account is needed and nothing personal is sent; when the service is unreachable the Feed simply
 * shows no events.
 */
export async function loadUpcomingEvents(options: { area?: string; days?: number; query?: string; limit?: number } = {}): Promise<{ area: string; posts: SocialPost[] }> {
  if (!apiConfigured()) return { area: '', posts: [] };
  const params = new URLSearchParams();
  if (options.area) params.set('area', options.area);
  params.set('days', String(options.days ?? 7));
  params.set('limit', String(options.limit ?? 12));
  if (options.query) params.set('q', options.query);
  const response = await fetch(`${getAPIURL()}/v1/events/upcoming?${params}`);
  if (!response.ok) throw new Error('Events are unavailable right now.');
  const body = await response.json() as { area: string; data: PublicEvent[] };
  return { area: body.area, posts: (body.data ?? []).map(socialPostFromEvent) };
}
