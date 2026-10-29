import assert from 'node:assert/strict';
import test from 'node:test';

import { builtInLensFor, builtInLenses, lensFromRequest, lensKeeps, parseLens, postKinds, runLens, workLens } from './feedLenses';
import { ruleReasons, stateFor, verificationClaims } from './listingSafety';
import { employmentTypeFrom, listingLine, parsePayRange, validateListing } from './listings';
import { SocialPost } from './posts';
import { applyProfessionalIntent, csvRows, emptyProfessional, fromJsonResume, fromLinkedInExport, parseProfessional, ProfessionalError, professionalIntent, professionalLines, toJsonResume } from './professionalProfile';

const now = Date.parse('2026-10-28T12:00:00Z');

function post(id: string, body: string, extra: Partial<SocialPost> = {}): SocialPost {
  return {
    id, author: { id, displayName: id, handle: `@${id}`, initials: 'X' }, body, kind: 'text',
    createdAt: new Date(now - 3_600_000).toISOString(), topics: [], provenance: { connectorId: 'open-media' },
    relevance: { followsAuthor: false, selectedInterestMatches: [] }, ...extra,
  };
}

// ---------- Work lens ----------

test('Work is built in after Relevant and Raw, and keeps Relevant as the default', () => {
  assert.deepEqual(builtInLenses.map((lens) => lens.id), ['relevant', 'raw', 'work']);
  assert.deepEqual(workLens.permissions, ['follows', 'interests']);
  assert.equal(workLens.objectives.engagement, 0);
  // Nobody can save a lens that takes Work's id.
  assert.throws(() => parseLens({ id: 'work', name: 'Work' }), /built-in/);
  assert.equal(parseLens({ name: 'Work' }).id, 'work-lens');
});

test('Work keeps job posts and professional topics, and leaves the rest out', () => {
  const job = validateListing({ kind: 'job', title: 'Product designer', price: '90000-120000', currency: 'USD', remote: true });
  assert.ok('listing' in job);
  const posts = [
    post('hiring', 'We are hiring two engineers in Pune'),
    post('job-card', 'Join us', { listing: job.listing }),
    post('launch', 'We launched our new API today #startup'),
    post('lunch', 'Great lunch with friends'),
  ];
  const kept = runLens(posts, workLens, { now }).map((item) => item.id);
  assert.ok(kept.includes('hiring') && kept.includes('job-card') && kept.includes('launch'));
  assert.ok(!kept.includes('lunch'));
  assert.equal(lensKeeps(posts[3], workLens, { now }).reason?.startsWith('Not about'), true);
  assert.deepEqual(postKinds(posts[1]), ['job']);
});

test('Search words such as “jobs” or “networking” open Work, other searches do not', () => {
  for (const words of ['work', 'Jobs', 'networking', 'LinkedIn', 'professional feed', 'show me the work feed']) assert.equal(builtInLensFor(words)?.id, 'work', words);
  for (const words of ['jobs in pune', 'design', 'work from home tips', 'open to work']) assert.equal(builtInLensFor(words), undefined, words);
  // Writing a lens about job posts still works.
  assert.deepEqual(lensFromRequest('only job posts about design').lens.filters.kinds, ['job']);
});

// ---------- Jobs ----------

test('jobs read pay ranges, the kind of job from the title, and only https apply links', () => {
  assert.deepEqual(parsePayRange('80,000-120,000', 'USD'), { min: 8_000_000, max: 12_000_000 });
  assert.deepEqual(parsePayRange('45', 'USD'), { min: 4500 });
  assert.equal(parsePayRange('50-40', 'USD'), 'invalid');
  assert.equal(employmentTypeFrom('Design intern, summer'), 'internship');
  assert.equal(employmentTypeFrom('Senior engineer (contract)'), 'contract');
  assert.equal(employmentTypeFrom('Barista, part-time'), 'part_time');
  assert.equal(employmentTypeFrom('Staff engineer'), 'full_time');
  const checked = validateListing({ kind: 'job', title: 'Data analyst', price: '1200000-1800000', currency: 'INR', location: 'Pune', applyUrl: 'https://jobs.example.com/analyst' });
  assert.ok('listing' in checked);
  assert.equal(checked.listing.job?.applyUrl, 'https://jobs.example.com/analyst');
  // The number format follows the device's locale; the shape does not.
  assert.match(listingLine(checked.listing), /^Full-time · Pune · ₹1[\d,]+–₹1[\d,]+$/);
  assert.deepEqual(validateListing({ kind: 'job', title: 'Role', applyUrl: 'http://example.com' }), { error: 'The apply link must be an https:// address on the employer’s site.' });
  assert.deepEqual(validateListing({ kind: 'job', title: 'Role', applyUrl: 'javascript:alert(1)' }), { error: 'The apply link must be an https:// address on the employer’s site.' });
});

const job = (title: string, body = '', extra: Record<string, unknown> = {}) => ({ kind: 'job' as const, title, body, priceMinor: 9_000_000, currency: 'USD', authorAgeDays: 2, authorVerified: false, ...extra });

test('job posts that charge applicants or ask for ID or bank details are held', () => {
  assert.equal(stateFor(ruleReasons(job('Data entry clerk', 'Pay a small registration fee to start'))), 'held');
  assert.equal(stateFor(ruleReasons(job('Remote assistant', 'Send your passport and bank details to apply'))), 'held');
  assert.equal(stateFor(ruleReasons(job('Product designer', 'Join our team in Pune. Apply on our site.'))), 'clear');
});

test('easy-money and chat-app-only job posts get a closer look, and salaries are not prices', () => {
  assert.equal(stateFor(ruleReasons(job('Work from home', 'Earn $500 per day from home, no experience'))), 'review');
  assert.equal(stateFor(ruleReasons(job('Sales rep', 'Message me on Telegram to apply'))), 'review');
  // A high salary from a new account is normal for a job; it isn't the high-price or new-seller rule.
  assert.deepEqual(ruleReasons(job('Staff engineer', 'Great team', { priceMinor: 30_000_000 })), []);
  assert.ok(ruleReasons(job('Engineer', '', { applyUrl: 'https://bit.ly/abc' })).some((reason) => reason.code === 'shortener' || /short/i.test(reason.message)));
  assert.equal(verificationClaims({ kind: 'job', title: 'Engineer', body: '', priceMinor: null })[0].code, 'job_official');
});

// ---------- Professional profiles ----------

const sample = {
  headline: 'Product designer', summary: 'I design calm software.', openTo: 'work',
  work: [{ name: 'Acme', position: 'Senior designer', startDate: '2022-03', highlights: ['Led the design system'] }, { name: 'Globex', position: 'Designer', startDate: '2019', endDate: '2022-02', highlights: [] }],
  education: [{ institution: 'NID', area: 'Interaction design', studyType: 'M.Des' }],
  skills: ['Figma', 'figma', 'User research'], languages: ['English'], links: [{ label: 'Portfolio', url: 'https://example.com/work' }],
};

test('professional profiles are validated, deduplicated and refuse unknown or private fields', () => {
  const profile = parseProfessional(sample);
  assert.deepEqual(profile.skills, ['Figma', 'User research']);
  assert.throws(() => parseProfessional({ ...sample, birthDate: '1990-01-01' }), ProfessionalError);
  assert.throws(() => parseProfessional({ work: [{ name: 'Acme', position: 'X', startDate: 'last year' }] }), /2021-04/);
  assert.throws(() => parseProfessional({ links: [{ label: 'x', url: 'http://example.com' }] }), /https/);
  assert.throws(() => parseProfessional({ openTo: 'sale' }), /openTo/);
  assert.deepEqual(parseProfessional(null), emptyProfessional);
  const lines = professionalLines(profile);
  assert.equal(lines.headline, 'Product designer');
  assert.deepEqual(lines.lines.slice(0, 2), ['Open to work', 'Senior designer at Acme']);
});

test('a profile round-trips through JSON Resume, without contact details', () => {
  const profile = parseProfessional(sample);
  const resume = toJsonResume(profile, { name: 'Asha Rao', handle: 'asha', url: 'https://openmedia.site/@asha' });
  assert.equal((resume.basics as { label: string }).label, 'Product designer');
  const back = fromJsonResume({ ...resume, basics: { ...(resume.basics as object), email: 'asha@example.com', phone: '+91 99999 99999' } });
  assert.deepEqual(back.work, profile.work);
  assert.deepEqual(back.education, profile.education);
  assert.deepEqual(back.links, profile.links);
  assert.ok(!JSON.stringify(back).includes('asha@example.com'));
  assert.throws(() => fromJsonResume('not json'), ProfessionalError);
});

test('a LinkedIn data export is read from its CSV files, ignoring birth dates and addresses', () => {
  const files = {
    'Basic_LinkedInDataExport/Profile.csv': 'First Name,Last Name,Maiden Name,Address,Birth Date,Headline,Summary,Industry,Zip Code,Geo Location,Twitter Handles,Websites,Instant Messengers\nAsha,Rao,,"12 MG Road, Pune",1 Jan 1990,"Product designer, ex-Globex","I design calm software.",Design,411001,"Pune, Maharashtra, India",,[PORTFOLIO:https://example.com/work],\n',
    'Positions.csv': 'Company Name,Title,Description,Location,Started On,Finished On\nAcme,Senior designer,"Led the design system, hired 3",Pune,Mar 2022,\nGlobex,Designer,,,Jan 2019,Feb 2022\n',
    'Education.csv': 'School Name,Start Date,End Date,Notes,Degree Name,Activities\nNID,2016,2018,,M.Des,\n',
    'Skills.csv': 'Name\nFigma\nUser research\n',
  };
  const { profile, used } = fromLinkedInExport(files);
  assert.deepEqual(used, ['profile.csv', 'positions.csv', 'education.csv', 'skills.csv']);
  assert.equal(profile.headline, 'Product designer, ex-Globex');
  assert.equal(profile.location, 'Pune, Maharashtra, India');
  assert.deepEqual(profile.work.map((item) => [item.name, item.startDate, item.endDate]), [['Acme', '2022-03', undefined], ['Globex', '2019-01', '2022-02']]);
  assert.equal(profile.work[0].summary, 'Led the design system, hired 3');
  assert.deepEqual(profile.skills, ['Figma', 'User research']);
  assert.deepEqual(profile.links, [{ label: 'example.com', url: 'https://example.com/work' }]);
  const text = JSON.stringify(profile);
  assert.ok(!text.includes('1990') && !text.includes('MG Road') && !text.includes('411001'));
});

test('CSV parsing handles notes above the header, quotes and Windows line endings', () => {
  const rows = csvRows('Notes:\r\n"Some notes, quoted"\r\n\r\nName,Note\r\n"Say ""hi""","a\nb"\r\n', 'Name');
  assert.deepEqual(rows, [{ Name: 'Say "hi"', Note: 'a\nb' }]);
  assert.deepEqual(csvRows('nothing here', 'Name'), []);
});

test('plain sentences in Search become one profile change', () => {
  assert.deepEqual(professionalIntent('my headline is Product designer at Acme')?.change, { headline: 'Product designer at Acme' });
  assert.deepEqual(professionalIntent('I’m open to work'.replace('’', "'"))?.change, { openTo: 'work' });
  assert.deepEqual(professionalIntent("we're hiring")?.change, { openTo: 'hiring' });
  assert.deepEqual(professionalIntent('not open to work')?.change, { clearOpenTo: true });
  assert.deepEqual(professionalIntent('add skills Figma, user research and prototyping')?.change, { skills: ['Figma', 'user research', 'prototyping'] });
  assert.equal(professionalIntent('jobs in pune'), undefined);
  assert.equal(professionalIntent('skills'), undefined);
  const next = applyProfessionalIntent(parseProfessional(sample), professionalIntent('add skills Prototyping, figma')!);
  assert.deepEqual(next.skills, ['Figma', 'User research', 'Prototyping']);
  assert.equal(applyProfessionalIntent(next, professionalIntent('not open to work')!).openTo, undefined);
});

test('a listing titled “Hiring …” becomes a job without any extra choice', () => {
  const checked = validateListing({ kind: 'service', title: 'Hiring: React Native engineer (contract)', price: '60-80', currency: 'USD', remote: true });
  assert.ok('listing' in checked);
  assert.equal(checked.listing.kind, 'job');
  assert.equal(checked.listing.job?.employmentType, 'contract');
  for (const title of ["We're hiring a designer", 'Now hiring baristas', 'job: data analyst']) assert.equal(validateListing({ kind: 'product', title }).hasOwnProperty('listing') && (validateListing({ kind: 'product', title }) as { listing: { kind: string } }).listing.kind, 'job', title);
  assert.equal((validateListing({ kind: 'service', title: 'Bike repair' }) as { listing: { kind: string } }).listing.kind, 'service');
});
