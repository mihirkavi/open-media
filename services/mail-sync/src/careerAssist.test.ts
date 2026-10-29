import assert from 'node:assert/strict';
import test from 'node:test';

import { applicationMessage, checkModelDraft, keepOnlyFacts, rulesDraft, tailorProfile } from './careerAssist.js';

const profile = {
  headline: 'Product designer', summary: 'I design calm software for 6 years.',
  work: [
    { name: 'Globex', position: 'Designer', startDate: '2019', endDate: '2022-02', highlights: ['Designed the billing flow'] },
    { name: 'Acme', position: 'Senior designer', startDate: '2022-03', highlights: ['Led the design system used by 40 engineers', 'Ran user research'] },
  ],
  education: [{ institution: 'NID', area: 'Interaction design' }],
  skills: ['Figma', 'User research', 'Prototyping', 'Illustration'],
  languages: [], links: [],
};
const job = { title: 'Senior product designer', text: 'You will own our design system and run user research with customers. 8+ years required.', employer: 'Initech' };

test('rules put the skills and jobs that match the job first, and add nothing', () => {
  const draft = rulesDraft(profile as never, job);
  assert.deepEqual(draft.skills.slice(0, 1), ['User research']);
  assert.equal(draft.work[0].name, 'Acme');
  assert.deepEqual([...draft.skills].sort(), [...profile.skills].sort());
  assert.match(draft.coverNote, /Senior product designer role/);
  assert.match(draft.coverNote, /Initech team/);
  assert.deepEqual(draft.removed, []);
});

test('sentences with numbers, employers or schools the profile doesn’t have are removed', () => {
  const checked = keepOnlyFacts('I led a team of 12 at Google. I have 6 years of design experience. I worked at Acme on the design system. I studied at Stanford.', profile as never, job);
  assert.equal(checked.text, 'I have 6 years of design experience. I worked at Acme on the design system.');
  assert.equal(checked.removed.length, 2);
  assert.match(checked.removed[0], /12/);
  // The job's own employer may be named; the job's numbers may not be claimed.
  assert.equal(keepOnlyFacts('I’d love to join Initech.', profile as never, job).text, 'I’d love to join Initech.');
  assert.equal(keepOnlyFacts('I have 8+ years of experience.', profile as never, job).text, '');
});

test('a model reply can only reorder and rephrase: unknown skills and jobs are dropped and listed', () => {
  const reply = JSON.stringify({
    headline: 'Senior product designer and design-system lead',
    summary: 'Designer with 10 years at Meta.',
    skills: ['user research', 'Kubernetes', 'Figma'],
    work: [{ index: 1, highlights: ['Led a design system used by 40 engineers', 'Grew revenue 300%'] }, { index: 7, highlights: ['Invented job'] }],
    coverNote: 'I run user research and lead design systems at Acme. I would love to help Initech.',
  });
  const draft = checkModelDraft(`Here you go: ${reply}`, profile as never, job);
  assert.equal(draft.source, 'model');
  assert.deepEqual(draft.skills, ['User research', 'Figma', 'Prototyping', 'Illustration']);
  assert.equal(draft.work.length, 2);
  assert.equal(draft.work[0].name, 'Acme');
  assert.deepEqual(draft.work[0].highlights, ['Led a design system used by 40 engineers']);
  assert.equal(draft.summary, profile.summary);
  assert.ok(draft.removed.some((line) => line.includes('Kubernetes')));
  assert.ok(draft.removed.some((line) => line.includes('300')));
  assert.ok(draft.removed.some((line) => line.includes('10')));
  assert.match(draft.coverNote, /Acme/);
});

test('an unreadable reply falls back to the rules, and no AI means rules', async () => {
  assert.equal(checkModelDraft('not json', profile as never, job).source, 'rules');
  assert.equal((await tailorProfile(profile, job, {})).source, 'rules');
  const failing = { run: async () => { throw new Error('down'); } };
  assert.match((await tailorProfile(profile, job, { AI: failing })).note, /wasn’t available/);
  await assert.rejects(tailorProfile({}, job, {}), /Add your experience first/);
});

test('the application message is the cover note plus facts from the profile', () => {
  const message = applicationMessage(rulesDraft(profile as never, job), 'https://openmedia.site/@asha');
  assert.match(message, /Senior designer at Acme: Led the design system/);
  assert.match(message, /Profile: https:\/\/openmedia\.site\/@asha$/);
});
