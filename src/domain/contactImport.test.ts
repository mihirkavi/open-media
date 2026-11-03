import assert from 'node:assert/strict';
import test from 'node:test';

import { detectFormat, parseContactsFile, parseCsv, planImport } from './contactImport';
import { ContactCard } from './people';

const now = '2026-11-02T12:00:00.000Z';
let ids = 0;
const newId = () => `new-${++ids}`;

// Shaped like an export from Apple Contacts (vCard 3.0), with a folded photo line and grouped properties.
const appleVCard = [
  'BEGIN:VCARD',
  'VERSION:3.0',
  'N:Shah;Priya;;;',
  'FN:Priya Shah',
  'NICKNAME:Pri',
  'item1.EMAIL;type=INTERNET;type=pref:Priya@Example.com',
  'TEL;type=CELL;type=VOICE;type=pref:+1 (555) 000-1234',
  'IMPP;X-SERVICE-TYPE=Telegram;type=pref:x-apple:priya_s',
  'X-SOCIALPROFILE;type=twitter:https://x.com/priyashah',
  'PHOTO;ENCODING=b;TYPE=JPEG:/9j/4AAQSkZJRgABAQAAAQABAAD=',
  ' AAAA==',
  'NOTE:Met at the climbing gym\\, Tuesdays',
  'END:VCARD',
  'BEGIN:VCARD',
  'VERSION:3.0',
  'N:Mehta;Dev;;;',
  'TEL;type=HOME:555 000 9999',
  'END:VCARD',
].join('\r\n');

test('reads an Apple Contacts vCard: names, emails, numbers, handles and notes', () => {
  const [priya, dev] = parseContactsFile('Contacts.vcf', appleVCard);
  assert.equal(priya.name, 'Priya Shah');
  assert.deepEqual(priya.nicknames, ['Pri']);
  assert.deepEqual(priya.emails, ['priya@example.com']);
  assert.deepEqual(priya.phones, ['+1 (555) 000-1234']);
  assert.deepEqual(priya.handles, [{ network: 'telegram', handle: 'priya_s' }, { network: 'twitter', handle: 'priyashah' }]);
  assert.equal(priya.notes, 'Met at the climbing gym, Tuesdays');
  assert.equal(dev.name, 'Dev Mehta', 'a card without FN takes its name from N');
});

test('reads vCard 2.1 quoted-printable names from older Android exports', () => {
  const card = 'BEGIN:VCARD\nVERSION:2.1\nFN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Jos=C3=A9 Mart=\n=C3=ADnez\nTEL;CELL:+34 600 000 000\nEND:VCARD\n';
  assert.equal(parseContactsFile('backup.vcf', card)[0].name, 'José Martínez');
});

test('reads a Google Contacts CSV, including several values in one cell', () => {
  const csv = 'First Name,Middle Name,Last Name,Nickname,E-mail 1 - Label,E-mail 1 - Value,Phone 1 - Label,Phone 1 - Value,Notes\n'
    + 'Priya,,Shah,Pri,* Home,priya@example.com ::: priya@work.example.com,Mobile,+15550001234,"Likes ""good"" coffee"\n'
    + ',,,,,,Mobile,+15550005555,\n';
  const [priya, unnamed] = parseContactsFile('contacts.csv', csv);
  assert.equal(priya.name, 'Priya Shah');
  assert.deepEqual(priya.emails, ['priya@example.com', 'priya@work.example.com']);
  assert.deepEqual(priya.phones, ['+15550001234']);
  assert.equal(priya.notes, 'Likes "good" coffee');
  assert.deepEqual([unnamed.name, unnamed.phones], ['', ['+15550005555']], 'labels are not mistaken for values');
});

test('reads an Outlook CSV and a plain sheet with its own column names', () => {
  const outlook = 'First Name,Last Name,E-mail Address,E-mail 2 Address,Mobile Phone,Business Phone,Company\nDev,Mehta,dev@example.com,,555 000 9999,,\n,,info@shop.example.com,,,,Corner Shop\n';
  const [dev, shop] = parseContactsFile('outlook.csv', outlook);
  assert.deepEqual([dev.name, dev.emails, dev.phones], ['Dev Mehta', ['dev@example.com'], ['555 000 9999']]);
  assert.equal(shop.name, 'Corner Shop', 'no person name: the company');
  const plain = parseContactsFile('people.csv', 'Name,Email,Phone,Telegram\nAda Lovelace,ada@example.com,+44 20 7946 0000,@ada\n');
  assert.deepEqual(plain[0].handles, [{ network: 'telegram', handle: 'ada' }]);
});

test('turns away files that are not contacts', () => {
  assert.equal(detectFormat('photo.png', '\u0089PNG'), undefined);
  assert.throws(() => parseContactsFile('notes.txt', 'just some words'), /doesn’t look like contacts/);
  assert.throws(() => parseContactsFile('sheet.csv', 'Colour,Size\nred,big\n'), /no name, email or phone/);
  assert.deepEqual(parseCsv('a,"b\nc",d\r\n1,2,3'), [['a', 'b\nc', 'd'], ['1', '2', '3']]);
});

test('an import adds to the contact you already have instead of duplicating it', () => {
  const saved: ContactCard = { id: 'c1', source: 'device', deviceId: 'd1', name: 'Priya', nicknames: [], phones: ['5550001234'], emails: [], notes: '', links: [], rejected: [], updatedAt: now };
  const imported = parseContactsFile('Contacts.vcf', appleVCard);
  const plan = planImport([saved], [...imported, imported[1]], newId, now);
  assert.deepEqual([plan.added, plan.updated, plan.unchanged], [1, 1, 0]);
  const priya = plan.changed.find((card) => card.id === 'c1')!;
  assert.equal(priya.name, 'Priya', 'the name you saved stays');
  assert.deepEqual(priya.emails, ['priya@example.com']);
  assert.deepEqual(priya.phones, ['5550001234'], 'the same number in another format is not added twice');
  assert.equal(priya.handles?.length, 2);
  assert.equal(plan.changed.filter((card) => card.name === 'Dev Mehta').length, 1, 'a contact listed twice in the file is saved once');
  assert.equal(plan.changed.find((card) => card.name === 'Dev Mehta')?.source, 'manual', 'so a later device import never removes it');
  const again = planImport([...plan.changed], imported, newId, now);
  assert.deepEqual([again.added, again.updated, again.unchanged], [0, 0, 2], 'importing the same file twice changes nothing');
});
