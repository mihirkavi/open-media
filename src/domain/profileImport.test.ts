import assert from 'node:assert/strict';
import test from 'node:test';

import { fromLinkedInPdf, LinkedInPdfError } from './linkedInPdf';
import { extractPortfolio, parseHtml, relatedPageLinks } from './portfolioExtract';
import { applyProposals, chooseProposals, ProfileDraft, socialFieldFor } from './profileImport';
import { emptyProfessional, fromJsonResume, parseProfessional, ProfessionalError, professionalLines, toJsonResume } from './professionalProfile';

// Everyone here is made up.
const pdfText = [
  'Contact', 'asha@example.com', '+91 90000 00000 (Mobile)', 'www.linkedin.com/in/asha-', 'example (LinkedIn)', 'github.com/asha-example (Personal)',
  'Top Skills', 'Figma', 'User Research', 'Languages', 'Marathi (Native or Bilingual)',
  'Asha Rao', 'Design lead | Accessibility', 'Pune, Maharashtra, India',
  'Summary', 'I design calm products.',
  'Experience',
  'Example Labs', '5 years 2 months',
  'Design Lead', 'January 2022 - Present (2 years 10 months)', 'Pune, Maharashtra, India', 'Leads the design system.',
  'Product Designer', 'September 2019 - December 2021 (2 years 4 months)',
  'Page 1 of 2',
  'Education', 'Example University', '(2014 - 2018)',
].join('\n');

test('LinkedIn PDF text: grouped roles share their company, wrapped links are joined, and phone and email are skipped', () => {
  const { proposals } = fromLinkedInPdf(pdfText);
  const byId = new Map(proposals.map((item) => [item.id, item.value]));
  assert.equal(byId.get('displayName'), 'Asha Rao');
  assert.equal(byId.get('headline'), 'Design lead | Accessibility');
  assert.deepEqual((byId.get('work') as { name: string; position: string; endDate?: string }[]).map((item) => [item.name, item.position, item.endDate]), [['Example Labs', 'Design Lead', undefined], ['Example Labs', 'Product Designer', '2021-12']]);
  assert.deepEqual(byId.get('education'), [{ institution: 'Example University', startDate: '2014', endDate: '2018' }]);
  assert.equal(byId.get('field:linkedin'), 'asha-example');
  assert.equal(byId.get('field:github'), 'asha-example');
  assert.deepEqual(byId.get('languages'), ['Marathi']);
  assert.ok(!JSON.stringify(proposals).match(/90000|asha@example/), 'contact details are never imported');
  assert.throws(() => fromLinkedInPdf('Jane Doe\nCurriculum vitae\nExperience\nWriter'), LinkedInPdfError);
});

test('portfolio: an h-card alone, and Open Graph alone, still give a name, bio and links', () => {
  const hcard = extractPortfolio({ url: 'https://ravi.example', pages: [{ url: 'https://ravi.example/', html: '<div class="h-card"><span class="p-name">Ravi Kumar</span><p class="p-note">Photographer &amp; teacher.</p><span class="p-locality">Nagpur</span><a class="u-url" href="https://www.instagram.com/ravi.example/">Instagram</a></div>' }] });
  assert.deepEqual(hcard.map((item) => [item.id, item.value, item.source.split(' on ')[0]]), [
    ['field:website', 'https://ravi.example/', 'The address you gave'], ['displayName', 'Ravi Kumar', 'h-card'], ['bio', 'Photographer & teacher.', 'h-card'], ['location', 'Nagpur', 'h-card'], ['field:instagram', 'ravi.example', 'h-card'],
  ]);
  const og = extractPortfolio({ url: 'https://mei.example', pages: [{ url: 'https://mei.example/', html: '<head><meta property="og:title" content="Mei’s blog"><meta property="og:description" content="Notes on gardening."><meta name="author" content="Mei Lin"><link rel="me" href="https://mastodon.example/@mei"></head>' }] });
  assert.deepEqual(og.map((item) => item.id), ['field:website', 'displayName', 'bio', 'links']);
  assert.equal(og[1].value, 'Mei Lin', 'og:title is a page title, not a name, unless the page is a profile');
});

test('portfolio page text: projects under a heading, http links dropped, and the HTML reader survives unclosed tags', () => {
  const html = '<h2>Projects</h2><ul><li><a href="/garden">Garden planner</a><li><a href="http://old.example/">Old site</a></ul><h2>Skills</h2><p>Python, SQL · Data viz</p>';
  const proposals = extractPortfolio({ url: 'https://dev.example', pages: [{ url: 'https://dev.example/', html }] });
  assert.deepEqual(proposals.find((item) => item.id === 'projects')?.value, [{ name: 'Garden planner', url: 'https://dev.example/garden' }, { name: 'Old site' }]);
  assert.deepEqual(proposals.find((item) => item.id === 'skills')?.value, ['Python', 'SQL', 'Data viz']);
  assert.equal(parseHtml('<p>one<p>two<script>if (a < b) document.write("<h1>x</h1>")</script>').children.length, 2);
  assert.deepEqual(relatedPageLinks('<a href="/about">About</a><a href="https://other.example/about">x</a><a href="/blog/1">Post</a><a href="/cv/">CV</a>', 'https://dev.example/'), ['https://dev.example/about', 'https://dev.example/cv/']);
  assert.equal(socialFieldFor('https://www.github.com/x'), 'github');
  assert.equal(socialFieldFor('https://example.org/'), undefined);
});

test('chosen proposals merge into the profile: text replaced, lists added to, fields kept with their visibility', () => {
  const draft: ProfileDraft = {
    displayName: 'Asha', bio: '',
    professional: parseProfessional({ headline: 'Designer', work: [{ name: 'Example Labs', position: 'Design Lead', highlights: [] }], skills: ['Figma'] }),
    fields: [{ field: 'website', value: 'https://old.example/', visibility: 'connections' }],
  };
  const { proposals } = fromLinkedInPdf(pdfText);
  const next = applyProposals(draft, chooseProposals(proposals, ['displayName', 'headline', 'work', 'skills', 'field:github']));
  assert.equal(next.displayName, 'Asha Rao');
  assert.equal(next.professional.headline, 'Design lead | Accessibility');
  assert.deepEqual(next.professional.work.map((item) => item.position), ['Design Lead', 'Product Designer'], 'the role already there is not added twice');
  assert.deepEqual(next.professional.skills, ['Figma', 'User Research']);
  assert.deepEqual(next.fields, [{ field: 'website', value: 'https://old.example/', visibility: 'connections' }, { field: 'github', value: 'asha-example', visibility: 'everyone' }]);
  assert.throws(() => chooseProposals(proposals, ['email']), /No proposal/);
  const school = applyProposals(next, [{ id: 'education', label: 'Education', value: [{ institution: 'Example University', studyType: 'BSc', startDate: '2014' }], preview: '', source: 'JSON Resume' }]);
  assert.equal(school.professional.education.length, 1, 'the same school and start year is not added twice under another degree name');
});

test('projects are part of the professional profile and of JSON Resume', () => {
  const profile = parseProfessional({ ...emptyProfessional, projects: [{ name: 'Garden planner', url: 'https://dev.example/garden', description: 'Plans beds.' }] });
  assert.match(professionalLines(profile).lines.join('\n'), /Projects: Garden planner/);
  const resume = toJsonResume(profile, { name: 'Dev', handle: 'dev' });
  assert.deepEqual(resume.projects, [{ name: 'Garden planner', url: 'https://dev.example/garden', description: 'Plans beds.' }]);
  assert.deepEqual(fromJsonResume(resume).projects, profile.projects);
  assert.throws(() => parseProfessional({ projects: [{ name: 'X', url: 'http://dev.example' }] }), ProfessionalError);
  assert.throws(() => parseProfessional({ projects: [{ name: 'X', secret: 1 }] }), ProfessionalError);
});
