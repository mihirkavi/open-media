/**
 * WebMCP tools (https://webmachinelearning.github.io/webmcp/): what an agent in the person's
 * browser can call on an Open Media page through document.modelContext.registerTool(). They are
 * data, not code, so the Worker's pages and the web app register exactly the same tools. Each one
 * reads the public API; none of them acts as the person or changes anything.
 */

export interface WebMcpToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, object>; required?: string[] };
  /** API path; {name} is replaced by that input, URL-encoded. */
  path: string;
  /** Query parameter name → input name. */
  query?: Record<string, string>;
}

export const webMcpTools: WebMcpToolDefinition[] = [
  {
    name: 'search_open_media', title: 'Search Open Media',
    description: 'Plain-language search across public posts on Open Media, Farcaster, Lens, Hive and DeSo, plus matching app settings. Returns posts with their network, source link and "why" reasons.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'What to look for, e.g. "videos about cooking today" or "ethereum on lens"' } }, required: ['query'] },
    path: '/v1/search', query: { q: 'query' },
  },
  {
    name: 'get_open_media_feed', title: 'Read the Open Media feed',
    description: 'The mixed public feed from Open Media and the open networks through a feed lens: raw (newest first), relevant (transparently ranked), work (jobs and professional posts) or a shared lens id, with source links and "why" reasons. Pass nextCursor back as cursor to read further.',
    inputSchema: { type: 'object', properties: {
      sources: { type: 'string', description: 'Comma-separated networks: open-media, farcaster, lens, hive, deso' },
      lens: { type: 'string', description: 'raw, relevant, work, or a shared lens id from list_open_media_feed_lenses' },
      mode: { type: 'string', enum: ['raw', 'relevant'], description: 'Older name for the built-in lenses; prefer lens' },
      cursor: { type: 'string', description: 'nextCursor from the previous page' },
    } },
    path: '/v1/feed', query: { sources: 'sources', lens: 'lens', mode: 'mode', cursor: 'cursor' },
  },
  {
    name: 'list_open_media_feed_lenses', title: 'List Open Media feed lenses',
    description: 'How the Open Media Feed can be ordered: the built-in Raw, Relevant and Work and lenses people shared, each as an inspectable manifest with its rules in plain words, what it may read, and what no lens can ever read.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Words in a lens name or rule, e.g. "videos" or "cooking"' } } },
    path: '/v1/lenses', query: { q: 'query' },
  },
  {
    name: 'find_upcoming_events', title: 'Find upcoming events',
    description: 'Upcoming public events in the San Francisco Bay Area from Luma, Meetup and Eventbrite, de-duplicated, each with its date, place, price and official registration link.',
    inputSchema: { type: 'object', properties: {
      query: { type: 'string', description: 'Topic words, e.g. "ai founders" or "hiking"' },
      days: { type: 'integer', minimum: 1, maximum: 14, description: 'How many days ahead (default 7)' },
    } },
    path: '/v1/events/upcoming', query: { q: 'query', days: 'days' },
  },
  {
    name: 'find_open_media_jobs', title: 'Find jobs on Open Media',
    description: 'Open job posts on Open Media, newest first, with pay, place, remote, the kind of job and the employer’s own apply link. Open Media never applies for anyone.',
    inputSchema: { type: 'object', properties: {
      query: { type: 'string', description: 'Words in the role, text or place, e.g. "designer" or "Pune"' },
      remote: { type: 'boolean', description: 'Only remote jobs (true) or only on-site jobs (false)' },
    } },
    path: '/v1/jobs', query: { q: 'query', remote: 'remote' },
  },
  {
    name: 'get_open_media_profile', title: 'Get an Open Media profile',
    description: 'A public Open Media profile by handle, with its recent public posts.',
    inputSchema: { type: 'object', properties: { handle: { type: 'string', description: 'The Open Media handle, without @' } }, required: ['handle'] },
    path: '/v1/profiles/{handle}',
  },
];

/** The API URL a tool call reads, from its definition and the agent's input. */
export function webMcpRequestUrl(origin: string, tool: WebMcpToolDefinition, input: Record<string, unknown>): string {
  const path = tool.path.replace(/\{(\w+)\}/g, (_, name: string) => encodeURIComponent(String(input[name] ?? '')));
  const params = new URLSearchParams();
  for (const [param, name] of Object.entries(tool.query ?? {})) {
    const value = input[name];
    if (value !== undefined && value !== null && value !== '') params.set(param, String(value));
  }
  const query = params.toString();
  return `${origin.replace(/\/$/, '')}${path}${query ? `?${query}` : ''}`;
}
