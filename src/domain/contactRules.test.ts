import assert from 'node:assert/strict';
import test from 'node:test';

import { parseContactsFile, planImport } from './contactImport';
import { cleanEmail, cleanPersonName, cleanPhones, displayPhone, factsInNote, fixCase, linkedInSlug, repairEncoding } from './contactRules';
import { ContactCard } from './people';

// All names, numbers and addresses here are made up (555 numbers, example domains).

test('repairs UTF-8 text that was read as Mac Roman, and leaves real text alone', () => {
  assert.equal(repairEncoding('Jos‚àö¬©'), 'José');
  assert.equal(repairEncoding('Ordo√±ez'), 'Ordoñez');
  assert.equal(repairEncoding('Zoë Müller'), 'Zoë Müller');
  assert.equal(repairEncoding('Zareen’s'), 'Zareen’s');
});

test('names: no emails, credentials, pronouns, emoji, markers or repeats; spacing and case fixed', () => {
  assert.deepEqual(cleanPersonName('Erica Ablan-Go Ablan-Go'), { name: 'Erica Ablan-Go', emails: [] });
  assert.equal(cleanPersonName('Dana Kumar, Mba, Pmp').name, 'Dana Kumar');
  assert.equal(cleanPersonName('Riley Kalra CFA').name, 'Riley Kalra');
  assert.equal(cleanPersonName('Sam Example Ph.D.').name, 'Sam Example');
  assert.equal(cleanPersonName('Ivy Gupta (She/Her/Hers)').name, 'Ivy Gupta');
  assert.equal(cleanPersonName('Alekhya(Allu) Karumuri').name, 'Alekhya (Allu) Karumuri');
  assert.equal(cleanPersonName('Mo Vitkar 🇮🇳').name, 'Mo Vitkar');
  assert.equal(cleanPersonName('LOKNEESH P SINGH').name, 'Lokneesh P Singh');
  assert.equal(cleanPersonName('shilpa mcgill').name, 'Shilpa McGill');
  assert.equal(cleanPersonName('Jordan DePaolantonio').name, 'Jordan DePaolantonio');
  assert.equal(cleanPersonName('Ray Example Jr.').name, 'Ray Example Jr.');
  assert.deepEqual(cleanPersonName('Kai Lee (C) <kai_lee@example.com>'), { name: 'Kai Lee', emails: ['kai_lee@example.com'] });
  assert.equal(cleanPersonName('Police Police').name, 'Police');
  assert.equal(fixCase('PJ'), 'PJ');
});

test('phones: placeholders and glued metadata go; short codes, USSD and missing country codes stay as they are', () => {
  assert.deepEqual(cleanPhones('Mobile'), []);
  assert.deepEqual(cleanPhones('0'), []);
  assert.deepEqual(cleanPhones('+00000000'), []);
  assert.deepEqual(cleanPhones('+1‭(555) 010-0001'), ['+1(555) 010-0001']);
  assert.deepEqual(cleanPhones('+15550100001ROLE:Consultant'), ['+15550100001']);
  assert.deepEqual(cleanPhones('55121(smsft)'), ['55121']);
  assert.deepEqual(cleanPhones('*444#'), ['*444#']);
  assert.deepEqual(cleanPhones('100'), ['100']);
  assert.deepEqual(cleanPhones('+1 555 010 0001 ::: +1 555 010 0002'), ['+1 555 010 0001', '+1 555 010 0002']);
  assert.deepEqual(cleanPhones('(555) 010-0001'), ['(555) 010-0001']);
});

test('emails, LinkedIn links and the details hidden in exported notes', () => {
  assert.equal(cleanEmail('Email Address'), '');
  assert.equal(cleanEmail('mailto:sam@example.comStatus_S2C'), 'sam@example.com');
  assert.equal(cleanEmail('sam@example.ed'), 'sam@example.ed');
  assert.equal(linkedInSlug('https::https::http://www.linkedin.com/in/sam-example-123'), 'sam-example-123');
  assert.equal(linkedInSlug('http://www.linkedin.com/in/https%3A//www.linkedin.com/in/bart%C5%82omiej-x'), 'bartłomiej-x');
  assert.equal(linkedInSlug('http://www.linkedin.com/in/'), '');
  const facts = factsInNote('Phone (Mobile): +15550100009Significant Date (Other): 1/24/0008\nLinkedIn: https://www.linkedin.com/in/sam-x\nContact type: Company');
  assert.deepEqual(facts.phones, ['+15550100009']);
  assert.deepEqual(facts.linkedIn, ['sam-x']);
  assert.equal(facts.company, true);
});

test('an Apple export imports clean: company cards, WhatsApp profiles, LinkedIn, no note text, no template rows', () => {
  const vcf = [
    'BEGIN:VCARD', 'VERSION:3.0', 'N:Ablan-Go;Erica Ablan-Go;;;', 'FN:Erica Ablan-Go Ablan-Go', 'ORG:Example Co',
    'X-SOCIALPROFILE;type=linkedin:http://www.linkedin.com/in/https%3A//www.linkedin.com/in/erica-ag',
    'X-SOCIALPROFILE;x-userid=15550100003@s.whatsapp.net:x-apple:+15550100003',
    'NOTE:Phone (Mobile): +15550100004Significant Date (Other): 3/23/0003', 'END:VCARD',
    'BEGIN:VCARD', 'VERSION:3.0', 'N:;;;;', 'FN:HDFC', 'ORG:HDFC', 'X-ABShowAs:COMPANY', 'TEL:+15550100005', 'END:VCARD',
    'BEGIN:VCARD', 'VERSION:3.0', 'N:Last Name;First Name;Middle Name;;', 'TEL:Home Phone', 'EMAIL:Email Address', 'END:VCARD',
  ].join('\r\n');
  const contacts = parseContactsFile('export.vcf', vcf);
  assert.equal(contacts.length, 2);
  const [erica, company] = contacts;
  assert.equal(erica.name, 'Erica Ablan-Go');
  assert.deepEqual(erica.phones, ['+15550100004']);
  assert.deepEqual(erica.handles, [{ network: 'linkedin', handle: 'erica-ag' }, { network: 'whatsapp', handle: '+15550100003' }]);
  assert.equal(erica.notes, '');
  assert.equal(company.name, 'HDFC');
  assert.equal(company.company, true);
});

test('importing: same LinkedIn profile or same full name in one file is one person; shared mailboxes and different profiles are not', () => {
  const now = '2026-11-07T00:00:00.000Z';
  let n = 0;
  const id = () => `n${(n += 1)}`;
  const base = { nicknames: [], emails: [], phones: [], handles: [], notes: '' };
  const plan = planImport([], [
    { ...base, name: 'Sam Example', phones: ['+15550100006'] },
    { ...base, name: 'Sam Example', handles: [{ network: 'linkedin', handle: 'sam-ex' }] },
    { ...base, name: 'Sam E', handles: [{ network: 'linkedin', handle: 'sam-ex' }] },
    { ...base, name: 'Ana One', emails: ['info@example.com'] },
    { ...base, name: 'Bo Two', emails: ['info@example.com'] },
    { ...base, name: 'Lee Same', handles: [{ network: 'linkedin', handle: 'lee-a' }] },
    { ...base, name: 'Lee Same', handles: [{ network: 'linkedin', handle: 'lee-b' }] },
  ], id, now);
  assert.equal(plan.added, 5);
  const sam = plan.changed.find((card) => card.name === 'Sam Example')!;
  assert.deepEqual(sam.phones, ['+15550100006']);
  assert.deepEqual(sam.handles, [{ network: 'linkedin', handle: 'sam-ex' }]);
  // A saved contact is never matched by name alone.
  const saved: ContactCard = { id: 's1', source: 'manual', name: 'Sam Example', nicknames: [], phones: [], emails: [], handles: [], notes: '', links: [], rejected: [], updatedAt: now };
  assert.equal(planImport([saved], [{ ...base, name: 'Sam Example' }], id, now).added, 1);
});

test('a shared switchboard or sample number does not join different people; it does join a nickname or a short name', () => {
  const now = '2026-11-07T00:00:00.000Z';
  let n = 0;
  const base = { nicknames: [], emails: [], handles: [], notes: '' };
  const plan = planImport([], [
    { ...base, name: 'Brian Ng', phones: ['+15550100010'] },
    { ...base, name: 'Chen Liu', phones: ['+15550100010'] },
    { ...base, name: 'Alex Rivera', phones: ['+15550100011'] },
    { ...base, name: 'Alexandra Rivera', phones: ['+15550100011'] },
    { ...base, name: '', phones: ['+15550100011'] },
  ], () => `n${(n += 1)}`, now);
  assert.equal(plan.added, 3);
  assert.equal(cleanPersonName('Arnon De Paula ‚À¥').name, 'Arnon De Paula');
  assert.equal(cleanPersonName('Eric Espinosa Ô£ø√ú‚Ä¢‚Ä¢').name, 'Eric Espinosa');
});

test('numbers are shown the way people read them, without changing what is saved', () => {
  assert.equal(displayPhone('+15550109001'), '+1 (555) 010-9001');
  assert.equal(displayPhone('+919876543210'), '+91 98765 43210');
  assert.equal(displayPhone('+447700900123'), '+44 7700 900123');
  assert.equal(displayPhone('100'), '100');
  assert.equal(displayPhone('+1 555 010 0021 ext. 4'), '+1 555 010 0021 ext. 4');
});
