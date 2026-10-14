/**
 * End-to-end check of Open Media Events through its public interfaces only:
 * OAuth 2.1 dynamic registration + owner approval + PKCE token exchange, then
 * MCP over Streamable HTTP (initialize, tools/list, tools/call), the REST mirror
 * and the signed plan calendar feed.
 *
 *   EVENTS_BASE_URL=http://127.0.0.1:8787 EVENTS_OWNER_CODE=… npx tsx scripts/events-e2e.ts [--write]
 *
 * Without --write it only reads (search, sources, preferences). With --write it
 * also saves an event, places and then releases a hold, and reads the feed.
 * Prints titles and counts only; the access code and tokens are never printed.
 */
import { base, call, mcp, token } from './events-client.js';

const write = process.argv.includes('--write');

const unauthenticated = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
console.log(JSON.stringify({ step: 'unauthenticated_mcp_rejected', status: unauthenticated.status, www_authenticate: Boolean(unauthenticated.headers.get('www-authenticate')) }));
if (unauthenticated.status !== 401) throw new Error('MCP must reject requests without a token.');

const accessToken = await token(`${base}/mcp`);
console.log(JSON.stringify({ step: 'oauth', ok: true }));
const init = await mcp(accessToken, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } });
console.log(JSON.stringify({ step: 'initialize', server: init.serverInfo?.name, protocol: init.protocolVersion }));
const tools = await mcp(accessToken, 'tools/list');
console.log(JSON.stringify({ step: 'tools/list', count: tools.tools.length }));

const sources = await call(accessToken, 'list_event_sources', {});
console.log(JSON.stringify({ step: 'list_event_sources', providers: sources.providers.map((provider: any) => `${provider.provider}:${provider.capabilities.discover}`) }));

const started = Date.now();
const search = await call(accessToken, 'search_events', {
  query: 'meet founders and make friends, small groups where you can actually talk',
  period: 'next_7_days',
  area: 'South Bay',
  interests: ['entrepreneurship', 'meaningful_friendships'],
  exclude: ['webinar'],
  limit: 6,
});
console.log(JSON.stringify({
  step: 'search_events',
  ms: Date.now() - started,
  counts: search.counts,
  providers: search.providers.map((provider: any) => `${provider.provider}:${provider.status}:${provider.events}`),
  top: search.events.map((event: any) => `${event.title} | ${event.when} | ${event.where} | ${event.sources.map((source: any) => source.provider).join('+')} | ${event.score}`),
}));
console.log(JSON.stringify({ step: 'voice_summary', text: search.voice_summary }));

const restToken = await token();
const rest = await fetch(`${base}/v1/events/tools/get_event_preferences`, { method: 'POST', headers: { authorization: `Bearer ${restToken}`, 'content-type': 'application/json' }, body: '{}' });
console.log(JSON.stringify({ step: 'rest_mirror', status: rest.status, ok: rest.ok && (await rest.json() as { ok: boolean }).ok }));
const crossAudience = await fetch(`${base}/v1/events/tools/get_event_preferences`, { method: 'POST', headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' }, body: '{}' });
console.log(JSON.stringify({ step: 'mcp_token_rejected_for_rest', status: crossAudience.status }));

if (write && search.events[0]) {
  const target = search.events.find((event: any) => !event.when.includes('time not listed')) ?? search.events[0];
  const detail = await call(accessToken, 'get_event', { event_id: target.id });
  console.log(JSON.stringify({ step: 'get_event', title: detail.title, plan: detail.your_plan.state, registration: detail.your_registration.label }));
  await call(accessToken, 'save_event', { event_id: target.id, notes: 'e2e' });
  const schedule = await call(accessToken, 'check_schedule', { event_id: target.id });
  console.log(JSON.stringify({ step: 'check_schedule', feasible: schedule.feasible, calendar_checked: schedule.calendar.checked, travel: schedule.travel }));
  const refused = await mcp(accessToken, 'tools/call', { name: 'plan_event', arguments: { event_id: target.id, state: 'held' } });
  console.log(JSON.stringify({ step: 'hold_without_approval_refused', refused: Boolean(refused.isError) }));
  const held = await call(accessToken, 'plan_event', { event_id: target.id, state: 'held', user_approved: true });
  console.log(JSON.stringify({ step: 'plan_event_held', state: held.plan_state, calendar: held.calendar.status }));
  const registration = await call(accessToken, 'register_event', { event_id: target.id, user_approved: true });
  console.log(JSON.stringify({ step: 'register_event', registered: registration.registered, method: registration.method, has_link: Boolean(registration.open_this_link) }));
  const feed = await call(accessToken, 'get_calendar_feed', {});
  const ics = await (await fetch(feed.subscribe_url)).text();
  console.log(JSON.stringify({ step: 'calendar_feed', tentative_entries: (ics.match(/STATUS:TENTATIVE/g) ?? []).length }));
  const tampered = await fetch(feed.subscribe_url.replace(/[0-9a-f](?=\.ics$)/, (char: string) => (char === '0' ? '1' : '0')));
  console.log(JSON.stringify({ step: 'tampered_feed_rejected', status: tampered.status }));
  const released = await call(accessToken, 'plan_event', { event_id: target.id, state: 'declined' });
  console.log(JSON.stringify({ step: 'plan_event_declined', state: released.plan_state }));
  const mine = await call(accessToken, 'get_my_events', {});
  console.log(JSON.stringify({ step: 'get_my_events', count: mine.count, states: mine.events.map((event: any) => event.plan_state) }));
}
console.log(JSON.stringify({ step: 'done', ok: true }));
