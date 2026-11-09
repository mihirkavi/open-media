import assert from 'node:assert/strict';
import test from 'node:test';

import { parseContactsFile, planImport } from './contactImport';
import { contactsToVCard, exportFileName } from './contactExport';
import { ContactCard } from './people';

const now = '2026-11-07T00:00:00.000Z';
const card = (overrides: Partial<ContactCard>): ContactCard => ({ id: 'c', source: 'manual', name: '', nicknames: [], phones: [], emails: [], handles: [], notes: '', links: [], rejected: [], updatedAt: now, ...overrides });

test('exports Apple-compatible vCards that import back unchanged', () => {
  const cards = [
    card({ id: 'a', name: 'Erica Ablan-Go', nicknames: ['Eri'], phones: ['+15550100021'], emails: ['erica@example.com', 'erica.x@gmail.com'], handles: [{ network: 'linkedin', handle: 'erica-example' }, { network: 'whatsapp', handle: '+15550100021' }], notes: 'Met at the climbing gym, Tuesdays; bring chalk' }),
    card({ id: 'b', name: 'Example Helpline', phones: ['100'], company: true }),
    card({ id: 'me', name: 'Me', self: true, emails: ['me@example.com'] }),
    card({ id: 'z', name: 'Zoë Ünal', phones: ['+905550100022'] }),
  ];
  const text = contactsToVCard(cards);
  const flat = text.replace(/\r\n /g, '');
  assert.equal((text.match(/BEGIN:VCARD/g) ?? []).length, 3);
  assert.match(flat, /N:Ablan-Go;Erica;;;/);
  assert.match(flat, /EMAIL;type=INTERNET;type=WORK:erica@example\.com/);
  assert.match(flat, /EMAIL;type=INTERNET;type=HOME:erica\.x@gmail\.com/);
  assert.match(flat, /X-SOCIALPROFILE;type=linkedin;x-user=erica-example:https:\/\/www\.linkedin\.com\/in\/erica-example/);
  assert.match(flat, /ORG:Example Helpline\r\nX-ABShowAs:COMPANY/);
  assert.ok(text.split('\r\n').every((line) => new TextEncoder().encode(line).length <= 75));
  assert.ok(!text.includes('me@example.com'));
  // Round trip: the export imports as the same people, and importing it again changes nothing.
  const imported = parseContactsFile('export.vcf', text);
  assert.deepEqual(imported.map((item) => item.name), ['Erica Ablan-Go', 'Example Helpline', 'Zoë Ünal']);
  assert.equal(imported[1].company, true);
  const plan = planImport(cards, imported, () => 'new', now);
  assert.equal(plan.added, 0);
  assert.equal(plan.updated, 0);
  assert.equal(exportFileName(new Date(now)), 'Open Media Contacts 2026-11-07.vcf');
});
