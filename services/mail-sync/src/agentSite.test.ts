import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { fullOpenApi, handleAgentRequest } from './agentApi.js';
import { agentFriendlyNotFound, llmsTxt } from './agentSite.js';

const env = { SUPABASE_URL: 'http://db.test', SUPABASE_PUBLISHABLE_KEY: 'publishable' };
const origin = 'https://api.test';
const get = (path: string, headers: Record<string, string> = {}) => handleAgentRequest(new Request(`${origin}${path}`, { headers }), env);
const visibleText = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

test('the homepage negotiates HTML, Markdown, an agent view and the JSON index', async () => {
  const html = await get('/', { accept: 'text/html,application/xhtml+xml' });
  assert.match(html.headers.get('content-type') ?? '', /text\/html/);
  assert.match(html.headers.get('vary') ?? '', /Accept/);
  assert.match(html.headers.get('link') ?? '', /rel="sitemap"/);
  const page = await html.text();
  for (const pattern of [/<html lang="en">/, /<h1>Open Media<\/h1>/, /rel="canonical"/, /property="og:image"/, /property="og:type"/, /application\/ld\+json/, /"@type":"SoftwareApplication"/, /"@type":"Offer"/, /rel="alternate" type="text\/markdown"/, /document\.modelContext \|\| navigator\.modelContext/, /registerTool/]) {
    assert.match(page, pattern);
  }
  assert.ok(visibleText(page).length > 1500, 'plenty of content without JavaScript');

  const markdown = await get('/', { accept: 'text/markdown' });
  assert.match(markdown.headers.get('content-type') ?? '', /text\/markdown/);
  assert.match(await markdown.text(), /^---\ntitle: .*\n[\s\S]*---\n\n# Open Media/);
  assert.match(await (await get('/', { 'user-agent': 'Mozilla/5.0 (compatible; ClaudeBot/1.0)', accept: 'text/html' })).text(), /^---/, 'AI crawlers get Markdown');
  assert.equal((await (await get('/?mode=agent')).json() as { name: string }).name, 'Open Media');
  assert.ok((await (await get('/')).json() as { endpoints?: unknown }), 'plain requests still get the JSON index');
});

test('trust pages and docs have real content in HTML and Markdown twins', async () => {
  for (const path of ['/about', '/contact', '/privacy', '/pricing', '/docs', '/developers', '/agents']) {
    const html = await (await get(path, { accept: 'text/html' })).text();
    assert.ok(visibleText(html).length >= 500, `${path} has at least 500 characters`);
    const twin = await get(`${path}.md`);
    assert.match(twin.headers.get('content-type') ?? '', /text\/markdown/, `${path}.md is Markdown`);
    assert.match(await twin.text(), /\n# /);
  }
  for (const path of ['/auth.md', '/agents.md', '/pricing.md', '/index.md']) {
    const response = await get(path);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-type') ?? '', /text\/markdown/, path);
  }
  const auth = await (await get('/auth.md')).text();
  for (const section of ['## Discover', '## Pick a method', '## Register', '## Claim', '## Exchange', '## Use the access_token', '## Errors', '## Revocation']) assert.ok(auth.includes(section), section);
});

test('every link in llms.txt resolves to its own content on this site', async () => {
  const links = [...llmsTxt(origin).matchAll(/\]\((https:\/\/api\.test[^)]*)\)/g)].map((match) => match[1].slice(origin.length));
  assert.ok(links.length >= 10);
  const home = await (await get('/', { accept: 'text/html' })).text();
  for (const path of links) {
    const response = await get(path);
    assert.equal(response.status, 200, path);
    assert.notEqual(await response.text(), home, `${path} is not the homepage`);
  }
});

test('discovery files are valid and point at real resources', async () => {
  const robots = await (await get('/robots.txt')).text();
  assert.match(robots, /Sitemap: https:\/\/api\.test\/sitemap\.xml/);
  assert.match(robots, /User-agent: OAI-SearchBot\nAllow: \//);
  assert.match(await (await get('/sitemap.xml')).text(), /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);

  const ard = await (await get('/.well-known/ard.json')).json() as { specVersion: string; entries: { identifier: string; displayName: string; type: string; url?: string; data?: unknown }[] };
  assert.equal(ard.specVersion, '1.0');
  for (const entry of ard.entries) {
    assert.match(entry.identifier, /^urn:air:api\.test:/);
    assert.ok(entry.displayName && entry.type && (entry.url ? !entry.data : entry.data), entry.identifier);
  }

  const skills = await (await get('/.well-known/agent-skills/index.json')).json() as { skills: { url: string; digest: string }[] };
  for (const skill of skills.skills) {
    const body = await (await get(skill.url)).text();
    assert.equal(skill.digest, `sha256:${createHash('sha256').update(body).digest('hex')}`, skill.url);
  }

  const catalog = await get('/.well-known/api-catalog');
  assert.equal(catalog.headers.get('content-type'), 'application/linkset+json;profile="https://www.rfc-editor.org/info/rfc9727"');
  for (const id of ['open', 'me', 'docs']) {
    const card = await (await get(`/${id}/mcp/server-card`)).json() as { $schema: string; name: string; description: string; remotes: { url: string }[] };
    assert.equal(card.$schema, 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json');
    assert.ok(card.description.length <= 100);
    assert.equal(card.remotes[0].url, `${origin}/${id}/mcp`);
  }
  assert.ok((await (await get('/.well-known/agent-card.json')).json() as { skills: unknown[] }).skills.length >= 3);
});

test('the docs MCP server exposes a focused search and read pair', async () => {
  const call = async (method: string, params: object = {}) => {
    const response = await handleAgentRequest(new Request(`${origin}/docs/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }), env);
    const text = await response.text();
    return JSON.parse(text.startsWith('{') ? text : text.split('\n').find((line) => line.startsWith('data: '))!.slice(6)).result;
  };
  assert.deepEqual((await call('tools/list')).tools.map((tool: { name: string }) => tool.name).sort(), ['get_docs_page', 'search_docs']);
  const found = JSON.parse((await call('tools/call', { name: 'search_docs', arguments: { query: 'idempotency' } })).content[0].text);
  assert.ok(found.results.some((page: { path: string }) => page.path === '/docs'));
});

test('agents get Markdown 404s, auth challenges and a self-describing OpenAPI document', async () => {
  const missing = await agentFriendlyNotFound(new Request(`${origin}/nothing-here`, { headers: { accept: 'text/markdown' } }), new Response('{}', { status: 404 }));
  assert.equal(missing.status, 404);
  assert.match(missing.headers.get('content-type') ?? '', /text\/markdown/);
  assert.match(await missing.text(), /^# Not found/);

  const unauthorized = await get('/v1/me');
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.headers.get('www-authenticate'), `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`);
  assert.match(unauthorized.headers.get('ratelimit-policy') ?? '', /q=120;w=60/);

  const document = fullOpenApi(origin) as { paths: Record<string, Record<string, { operationId?: string; description?: string; parameters?: { name: string }[] }>> };
  const ids = Object.values(document.paths).flatMap((operations) => Object.values(operations).map((operation) => operation.operationId)).filter(Boolean);
  assert.equal(new Set(ids).size, ids.length, 'operationIds are unique');
  assert.ok(Object.values(document.paths).every((operations) => Object.values(operations).every((operation) => operation.operationId && operation.description)));
  assert.ok(document.paths['/v1/me/payments'].post.parameters?.some((parameter) => parameter.name === 'Idempotency-Key'));
});

test('auth.md leads with its heading, and the homepage marks up its FAQ and features', async () => {
  const auth = await (await get('/auth.md')).text();
  assert.match(auth, /^# Agent authentication on Open Media\n/);
  assert.doesNotMatch(auth, /github\.com\/workos/, 'no advertised link that fails an OPTIONS probe');
  const html = await (await get('/', { accept: 'text/html' })).text();
  assert.match(html, /"@type":"FAQPage"/);
  assert.match(html, /"@type":"ItemList"/);
  assert.match(html, /<h2>Frequently asked questions<\/h2>/);
  assert.ok(visibleText(await (await get('/sandbox', { accept: 'text/html' })).text()).length >= 500);
});

test('the public MCP server offers an MCP Apps view for feed and search results', async () => {
  const call = async (method: string, params: object = {}) => {
    const response = await handleAgentRequest(new Request(`${origin}/open/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }), env);
    const text = await response.text();
    return JSON.parse(text.startsWith('{') ? text : text.split('\n').find((line) => line.startsWith('data: '))!.slice(6)).result;
  };
  const tools = (await call('tools/list')).tools as { name: string; _meta?: { ui?: { resourceUri?: string } } }[];
  assert.equal(tools.find((tool) => tool.name === 'get_feed')?._meta?.ui?.resourceUri, 'ui://open-media/posts');
  assert.equal(tools.find((tool) => tool.name === 'search')?._meta?.ui?.resourceUri, 'ui://open-media/posts');
  const resources = (await call('resources/list')).resources as { uri: string; mimeType: string }[];
  assert.deepEqual(resources.map((item) => [item.uri, item.mimeType]), [['ui://open-media/posts', 'text/html;profile=mcp-app']]);
  const view = (await call('resources/read', { uri: 'ui://open-media/posts' })).contents[0];
  assert.match(view.text, /^<!DOCTYPE html>/);
  assert.match(view.text, /<meta name="color-scheme" content="light dark">/);
  assert.doesNotMatch(view.text, /<script src=|<link rel="stylesheet"|fetch\(/, 'the view loads nothing and calls nothing');
});
