import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  extractLinks, guardReasons, isOfficialAppPage, linkReasons, listingPolicyMarkdown, normaliseForQuote, reportChoices, ruleReasons, stateFor, statementOfReasons, verificationClaims,
} from './listingSafety';
import { listingLine, parseEventTime, validateListing } from './listings';

const base = { kind: 'product' as const, title: 'Walnut desk', body: 'Solid walnut, made by hand.', priceMinor: 45000, currency: 'USD', authorAgeDays: 120, authorVerified: false };

test('ordinary listings pass every rule', () => {
  assert.deepEqual(ruleReasons(base), []);
  assert.equal(stateFor([]), 'clear');
});

test('prohibited categories are held and regulated ones get a closer look', () => {
  assert.equal(stateFor(ruleReasons({ ...base, title: 'Rolex replica', body: 'AAA quality' })), 'held');
  assert.equal(stateFor(ruleReasons({ ...base, title: 'Glock pistol' })), 'held');
  assert.equal(stateFor(ruleReasons({ ...base, title: 'Guaranteed returns on crypto signals' })), 'held');
  assert.equal(stateFor(ruleReasons({ ...base, title: 'Craft whiskey tasting' })), 'review');
  assert.equal(stateFor(ruleReasons({ ...base, kind: 'event', title: 'Summer camp for kids ages 6-10' })), 'review');
});

test('everyday words are not mistaken for restricted ones', () => {
  for (const title of ['Gingerbread cookies', 'Applebee’s gift card', 'Team spirit hoodie', 'Rumba dance class', 'Methodical bookkeeping']) {
    assert.deepEqual(ruleReasons({ ...base, title }).filter((reason) => reason.severity === 'hold'), [], title);
  }
});

test('links: downloads, bare IPs, shorteners, http and brand impersonation', () => {
  assert.deepEqual(extractLinks('see https://a.example/x, www.b.example and http://c.example.'), ['https://a.example/x', 'https://www.b.example', 'http://c.example']);
  assert.equal(linkReasons('https://github.com/me/app/releases')[0], undefined);
  assert.equal(linkReasons('https://example.com/setup.exe')[0].code, 'download_link');
  assert.equal(linkReasons('https://203.0.113.9/login')[0].code, 'ip_link');
  assert.equal(linkReasons('https://bit.ly/x')[0].code, 'short_link');
  assert.equal(linkReasons('http://example.com')[0].code, 'insecure_link');
  assert.equal(linkReasons('https://secure-paypal.com/verify')[0].code, 'brand_impersonation');
  assert.deepEqual(linkReasons('https://www.paypal.com/myaccount'), []);
  assert.deepEqual(linkReasons('https://applebees.com'), [], 'a brand name inside a longer word is fine');
  assert.ok(isOfficialAppPage('https://apps.apple.com/app/id1'));
});

test('new sellers’ paid listings and unsigned agents get a closer look', () => {
  assert.deepEqual(ruleReasons({ ...base, authorAgeDays: 2 }).map((reason) => reason.code), ['new_seller']);
  assert.deepEqual(ruleReasons({ ...base, authorAgeDays: 2, priceMinor: 0 }), [], 'free listings from new accounts are fine');
  assert.deepEqual(ruleReasons({ ...base, viaAgent: true }).map((reason) => reason.code), ['unsigned_agent']);
  assert.deepEqual(ruleReasons({ ...base, viaAgent: true, agentSigned: true }), []);
});

test('Llama Guard can only ask for a closer look', () => {
  assert.deepEqual(guardReasons('safe'), []);
  const reasons = guardReasons('unsafe\nS2,S8');
  assert.equal(reasons[0].severity, 'review');
  assert.match(reasons[0].message, /fraud.*intellectual property/);
});

test('statements of reasons say what happened, what to change and how to appeal', () => {
  const text = statementOfReasons('Free app', 'held', ruleReasons({ ...base, title: 'Free app', body: 'https://example.com/app.apk' }));
  assert.match(text, /Only you can see your listing “Free app”/);
  assert.match(text, /App Store, Google Play, GitHub/);
  assert.match(text, /reply here/);
});

test('verification claims are checkable questions, at most three', () => {
  assert.equal(verificationClaims({ kind: 'event', title: 'Sunrise yoga', body: '', priceMinor: 0 })[0].code, 'event_official');
  assert.equal(verificationClaims({ kind: 'product', title: 'Notes app', body: 'https://apps.apple.com/app/id1', priceMinor: 0 })[0].code, 'app_developer');
  assert.ok(verificationClaims({ kind: 'product', title: 'Official Nike shoes', body: 'https://shop.example', priceMinor: 9000 }).some((claim) => claim.code === 'brand_owner'));
  assert.equal(verificationClaims({ kind: 'service', title: 'Logo design', body: '', priceMinor: 20000 })[0].code, 'seller_identity');
});

test('quotes match page text regardless of markup and spacing', () => {
  assert.ok(normaliseForQuote('<p>Sunrise <b>yoga</b>,&nbsp;May 4</p>').includes(normaliseForQuote('Sunrise yoga, May 4')));
});

test('listings get marketplace report reasons; other posts keep the usual three', () => {
  assert.deepEqual(reportChoices(true).map(([reason]) => reason), ['scam', 'prohibited', 'other']);
  assert.deepEqual(reportChoices(false).map(([reason]) => reason), ['spam', 'harassment', 'other']);
  assert.match(listingPolicyMarkdown(), /## Not allowed \(held\)/);
});

test('event times are read from plain words in the device’s time zone', () => {
  const now = new Date(2026, 9, 26, 15, 0);
  const at = (text: string) => parseEventTime(text, now);
  assert.deepEqual(at('Nov 12 7pm'), { startsAt: new Date(2026, 10, 12, 19, 0).toISOString(), dateOnly: false });
  assert.deepEqual(at('tomorrow 6:30pm'), { startsAt: new Date(2026, 9, 27, 18, 30).toISOString(), dateOnly: false });
  assert.deepEqual(at('2026-11-12 19:00'), { startsAt: new Date(2026, 10, 12, 19, 0).toISOString(), dateOnly: false });
  assert.deepEqual(at('Nov 12'), { startsAt: '2026-11-12', dateOnly: true });
  assert.deepEqual(at('Oct 1 9am'), { startsAt: new Date(2027, 9, 1, 9, 0).toISOString(), dateOnly: false }, 'a date that has passed this year means next year');
  assert.equal(at('2026-10-26 14:00'), 'past');
  assert.equal(at('Nov 12 7'), null, 'an hour without am or pm is ambiguous');
  assert.equal(at('whenever'), null);
});

test('a listing with a start time becomes an event', () => {
  const now = new Date(2026, 9, 26, 15, 0);
  const result = validateListing({ kind: 'service', title: 'Pottery class', price: '40', when: 'Sat 10am' }, now);
  assert.ok('listing' in result);
  assert.equal(result.listing.kind, 'event');
  assert.equal(result.listing.timezone, Intl.DateTimeFormat().resolvedOptions().timeZone, 'the organizer’s own time zone is kept');
  assert.match(listingLine(result.listing), /Sat, Oct 31 · 10:00\sAM · \$40/);
  assert.deepEqual(validateListing({ kind: 'event', title: 'Party', when: 'someday' }, now), { error: 'Say when the event starts, like “Nov 12 7pm” or “tomorrow 6:30pm”.' });
});
