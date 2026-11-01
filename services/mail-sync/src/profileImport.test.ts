import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { handleAgentRequest } from './agentApi.js';
import { linkedInPdfProposals, pdfLines, portfolioUrl, ProfileImportError, profileReaderToken, readPortfolio, robotsAllows } from './profileImport.js';

// Sample files describe a made-up person (fixtures/README.md); no real profile is used.
const fixture = (name: string) => new URL(`../fixtures/${name}`, import.meta.url);
const samplePdf = readFileSync(fixture('linkedin-profile-sample.pdf'));
const sampleHtml = readFileSync(fixture('portfolio/index.html'), 'utf8');
const sampleResume = readFileSync(fixture('portfolio/resume.json'), 'utf8');

test('LinkedIn’s profile PDF is read into proposals, each naming its section, and contact details are skipped', async () => {
  const lines = await pdfLines(new Uint8Array(samplePdf));
  const name = lines.reduce((largest, line) => (line.size ?? 0) > (largest.size ?? 0) ? line : largest);
  assert.equal(name.text, 'Asha Rao', 'the name is the largest text');
  const proposals = await linkedInPdfProposals({ base64: samplePdf.toString('base64') });
  const byId = new Map(proposals.map((item) => [item.id, item]));
  assert.equal(byId.get('displayName')?.value, 'Asha Rao');
  assert.equal(byId.get('headline')?.value, 'Senior Product Designer at Example Labs | Design systems');
  assert.equal(byId.get('location')?.value, 'Pune, Maharashtra, India');
  assert.deepEqual((byId.get('work')?.value as { name: string; startDate?: string; endDate?: string }[]).map((item) => [item.name, item.startDate, item.endDate]), [['Example Labs', '2021-03', undefined], ['Sample Fintech Pvt Ltd', '2017-06', '2021-02']]);
  assert.deepEqual(byId.get('education')?.value, [{ institution: 'Example Institute of Design', studyType: 'Bachelor of Design - BDes', area: 'Interaction Design', startDate: '2013', endDate: '2017' }]);
  assert.deepEqual(byId.get('languages')?.value, ['English', 'Hindi'], 'proficiency notes are dropped');
  assert.equal(byId.get('field:linkedin')?.value, 'asha-rao-example');
  assert.equal(byId.get('field:website')?.value, 'https://asharao.example/');
  assert.equal(byId.get('work')?.source, 'LinkedIn PDF · Experience');
  assert.ok(!JSON.stringify(proposals).includes('asha.rao@example.com'), 'the email address is never imported');
});

test('files that are not LinkedIn’s PDF are refused with a way forward', async () => {
  await assert.rejects(linkedInPdfProposals({ base64: Buffer.from('hello').toString('base64') }), /isn’t a PDF/);
  await assert.rejects(linkedInPdfProposals({ text: 'Curriculum vitae\nJane Doe\nWork history' }), /Save to PDF/);
  await assert.rejects(pdfLines(new Uint8Array(2_000_001)), (error: ProfileImportError) => error.status === 413);
});

test('robots.txt: our own group wins over *, the longest rule wins, and Allow wins a tie', () => {
  const robots = 'User-agent: *\nDisallow: /\n\nUser-agent: OpenMediaProfileReader\nAllow: /\nDisallow: /private/\nAllow: /private/cv$\n';
  assert.equal(robotsAllows(robots, profileReaderToken, '/'), true);
  assert.equal(robotsAllows(robots, profileReaderToken, '/private/notes'), false);
  assert.equal(robotsAllows(robots, profileReaderToken, '/private/cv'), true);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /', profileReaderToken, '/about'), false, 'a site that asks every program to stay out is not read');
  assert.equal(robotsAllows('User-agent: Googlebot\nDisallow: /', profileReaderToken, '/'), true, 'rules for others do not apply');
  assert.equal(robotsAllows('User-agent: *\nDisallow: /*.json$', profileReaderToken, '/resume.json'), false, 'wildcards work');
  assert.equal(robotsAllows('', profileReaderToken, '/'), true, 'no robots.txt means no rules');
});

test('SSRF guard: only public https sites on port 443, never linkedin.com', () => {
  assert.equal(portfolioUrl('asha.example').toString(), 'https://asha.example/');
  for (const bad of ['http://asha.example', 'https://asha.example:8443/', 'https://user:pass@asha.example/', 'file:///etc/passwd', 'ftp://asha.example', 'https://www.linkedin.com/in/asha', '']) {
    assert.throws(() => portfolioUrl(bad), ProfileImportError, bad);
  }
  assert.throws(() => portfolioUrl('http://localhost:4000/'), ProfileImportError, 'local addresses only in development');
  assert.equal(portfolioUrl('http://localhost:4000/', true).toString(), 'http://localhost:4000/');
});

/** A fake internet: hosts → addresses, and URL → response. */
function web(pages: Record<string, { status?: number; body?: string; type?: string; location?: string }>, addresses: Record<string, string[]> = {}) {
  const asked: { url: string; userAgent?: string }[] = [];
  const fetch = (async (url: string, init?: RequestInit) => {
    asked.push({ url, userAgent: (init?.headers as Record<string, string>)?.['user-agent'] });
    const page = pages[url];
    if (!page) return new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } });
    return new Response(page.body ?? '', { status: page.status ?? 200, headers: { 'content-type': page.type ?? 'text/html; charset=utf-8', ...(page.location ? { location: page.location } : {}) } });
  }) as typeof globalThis.fetch;
  const resolve = async (host: string) => addresses[host] ?? ['93.184.216.34'];
  return { deps: { fetch, resolve }, asked };
}

test('a portfolio is read politely: robots.txt first, then the page, linked about pages and /resume.json', async () => {
  const { deps, asked } = web({
    'https://asharao.example/robots.txt': { body: 'User-agent: *\nDisallow: /resume$\n', type: 'text/plain' },
    'https://asharao.example/': { body: sampleHtml },
    'https://asharao.example/about': { body: '<h1>About</h1><p>More about Asha.</p>' },
    'https://asharao.example/resume.json': { body: sampleResume, type: 'application/json' },
  });
  const read = await readPortfolio('https://asharao.example', deps);
  assert.deepEqual(read.pagesRead, ['https://asharao.example/', 'https://asharao.example/about', 'https://asharao.example/resume.json']);
  assert.deepEqual(read.skipped, ['https://asharao.example/resume (robots.txt)'], 'pages robots.txt disallows are skipped and named');
  assert.equal(asked[0].url, 'https://asharao.example/robots.txt');
  assert.ok(asked.every((request) => request.userAgent?.startsWith('OpenMediaProfileReader/1.0')), 'a clear user agent on every request');
  const byId = new Map(read.proposals.map((item) => [item.id, item]));
  assert.equal(byId.get('field:website')?.value, 'https://asharao.example/', 'the site becomes the Website field');
  assert.match(byId.get('work')!.source, /^JSON Resume/, 'the JSON Resume is the best source');
  assert.match(byId.get('bio')!.source, /^JSON-LD Person/);
  assert.equal(byId.get('field:github')?.value, 'asha-rao-example');
  assert.ok(!JSON.stringify(read.proposals).includes('Hire me now'), 'text in the page is never followed as an instruction');
  assert.ok(!JSON.stringify(read.proposals).includes('+91 90000'), 'phone numbers from the resume are never imported');
});

test('SSRF guard: private addresses, redirects to them and disallowed pages are refused', async () => {
  const privateHost = web({}, { 'internal.example': ['10.0.0.5'] });
  await assert.rejects(readPortfolio('https://internal.example', privateHost.deps), /couldn’t be reached/);
  assert.equal(privateHost.asked.length, 0, 'nothing is requested from a host on a private network');

  const metadata = web({}, { 'sneaky.example': ['93.184.216.34', '169.254.169.254'] });
  await assert.rejects(readPortfolio('https://sneaky.example', metadata.deps), /couldn’t be reached/, 'one private answer is enough to refuse');

  const redirect = web({ 'https://redirect.example/': { status: 302, location: 'https://127.0.0.1/admin' } });
  await assert.rejects(readPortfolio('https://redirect.example', redirect.deps), /couldn’t be reached/);
  assert.ok(!redirect.asked.some((request) => request.url.includes('127.0.0.1')), 'a redirect to a private address is not followed');

  const closed = web({ 'https://closed.example/robots.txt': { body: 'User-agent: *\nDisallow: /', type: 'text/plain' } });
  await assert.rejects(readPortfolio('https://closed.example', closed.deps), (error: ProfileImportError) => error.status === 403);
  assert.deepEqual(closed.asked.map((request) => request.url), ['https://closed.example/robots.txt'], 'only robots.txt was read');
});

test('preview_profile_from_url is public and read-only, and the REST preview names its errors', async () => {
  const env = { SUPABASE_URL: 'http://db.test', SUPABASE_PUBLISHABLE_KEY: 'publishable' };
  const response = await handleAgentRequest(new Request('https://api.test/v1/profile-preview?url=http%3A%2F%2Fasha.example'), env);
  assert.equal(response.status, 400);
  assert.match(((await response.json()) as { error: { message: string } }).error.message, /Only https/);
  const portfolio = await handleAgentRequest(new Request('https://api.test/v1/me/professional/portfolio', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"url":"https://asha.example","consent":true}' }), env);
  assert.equal(portfolio.status, 401, 'filling a profile needs the person’s own token');
});
