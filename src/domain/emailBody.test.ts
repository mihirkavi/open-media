import assert from 'node:assert/strict';
import test from 'node:test';

import { emailPreview, formatEmailBody } from './emailBody';

test('turns "Label ( url )" into tappable words', () => {
  const { segments, plain } = formatEmailBody('Shop by type\nSparkling\tSparkling\n ( https://clicks.vivino.com/f/a/B2rx~~/AAA~&lid=jn8 )\nRose Rosé ( https://clicks.vivino.com/f/a/wKS~&lid=zeq )');
  assert.equal(plain, 'Shop by type\nSparkling\nRosé');
  const links = segments.filter((segment) => segment.url);
  assert.equal(links.length, 2);
  assert.equal(links[1].text, 'Rosé');
  assert.match(links[1].url!, /^https:\/\/clicks\.vivino\.com\//);
  assert.ok(!plain.includes('http'));
});

test('labels bare and unlabeled links by domain', () => {
  const { segments } = formatEmailBody('Read more: https://www.example.com/a/b?c=1.');
  assert.deepEqual(segments, [{ text: 'Read more: ' }, { text: 'example.com ↗', url: 'https://www.example.com/a/b?c=1' }, { text: '.' }]);
});

test('drops quoted reply history', () => {
  const body = 'Sounds good!\n\nOn Thu, Oct 1, 2026 at 10:00 AM Ana <ana@example.com> wrote:\n> Lunch Thursday?\n> Noon?';
  const result = formatEmailBody(body);
  assert.equal(result.plain, 'Sounds good!');
  assert.equal(result.hadQuotedHistory, true);
  assert.equal(formatEmailBody('Yes\n\n> earlier line\n> more').plain, 'Yes');
});

test('removes invisible characters and layout spacing', () => {
  const { plain } = formatEmailBody('Hello​ there͏   friend\n\n\n\n\nBye');
  assert.equal(plain, 'Hello there friend\n\nBye');
});

test('previews use the first readable line', () => {
  assert.equal(emailPreview('​\n\nHey! Want lunch? ( https://x.example/y )\nMore'), 'Hey! Want lunch?');
  assert.equal(emailPreview('', 'Subject'), 'Subject');
});

test('stylesheets left in the plain-text version are removed', () => {
  const raw = [
    'Learn in-demand skills from Google experts by enrolling today',
    'body, table, td, th, h1, h2, h3, div, span, strong, b, i, p, ul,',
    'ol, li, a { font-family: Helvetica, sans-serif !important;} sup {',
    'font-size: 100% !important; } .nudge-component-icon-column {',
    'padding-left: 12px !important; padding-right: 32px !important; }',
    '@media only screen and (max-width: 600px) { .mobile-only { display: none !important; } }',
    'Coursera Google Career Certificates',
  ].join('\n');
  assert.equal(formatEmailBody(raw).plain, 'Learn in-demand skills from Google experts by enrolling today\n\nCoursera Google Career Certificates');
});

test('sentences with braces are not mistaken for CSS', () => {
  assert.equal(formatEmailBody('Use {name} in the template.\nSee you {soon}!').plain, 'Use {name} in the template.\nSee you {soon}!');
});

test('rows of asterisks and equals signs become paragraph breaks', () => {
  assert.equal(formatEmailBody('Top\n*********************\nBuild skills\n=====\nEnd').plain, 'Top\n\nBuild skills\n\nEnd');
});

test('HTML pasted into the plain-text part reads as a message, links kept', () => {
  const raw = 'Please read this email for more information\n\nHello Sam,</p><p style="margin:0;margin-bottom:0">&nbsp;</p><p style="margin:0;margin-bottom:0">Your order has been shipped!</p><p style="margin:0;margin-bottom:0">\nClick this <a href="https://shop.example.com/track?id=1" target="_blank" style="text-decoration: underline; color: #000000;" rel="noopener">link</a>&nbsp;to track your order. Tracking can take up to 24 hours.</p><p style="margin:0;margin-bottom:0">&nbsp;</p><p style="margin:0">Thanks &amp; see you soon</p>';
  const { plain, segments } = formatEmailBody(raw);
  assert.doesNotMatch(plain, /<|style=|&nbsp;|&amp;/);
  assert.ok(plain.split('\n').includes('Your order has been shipped!'));
  assert.match(plain, /Click this link to track your order\./);
  assert.match(plain, /Thanks & see you soon/);
  assert.deepEqual(segments.find((segment) => segment.url), { text: 'link', url: 'https://shop.example.com/track?id=1' });
});

test('plain text that mentions angle brackets is not treated as HTML', () => {
  const raw = 'If a < b and c > d, use <p> tags.\nThanks';
  assert.equal(formatEmailBody(raw).plain, raw);
});
