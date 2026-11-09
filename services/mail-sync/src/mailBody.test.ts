import assert from 'node:assert/strict';
import test from 'node:test';
import { bodyTextOf } from './mailBody.js';

const html = '<html><body><p>Hello Sam,</p><p>Your order has been shipped!</p><p>Click this <a href="https://shop.example.com/track">link</a> to track it.</p><img src="https://shop.example.com/logo.png" alt="Logo"></body></html>';

test('a text part full of HTML markup falls back to the HTML part', () => {
  const text = bodyTextOf({ text: 'Hello Sam,</p><p style="margin:0">&nbsp;</p><p style="margin:0">Your order has been shipped!</p>', html });
  assert.doesNotMatch(text, /<|&nbsp;/);
  assert.match(text, /Your order has been shipped!/);
  assert.match(text, /link \[https:\/\/shop\.example\.com\/track\]/);
  assert.doesNotMatch(text, /Logo/);
});

test('a clean text part is kept', () => {
  assert.equal(bodyTextOf({ text: 'Hi, see you at 5 < 6pm.\n', html }), 'Hi, see you at 5 < 6pm.\n');
});

test('an empty text part uses the HTML part', () => {
  assert.match(bodyTextOf({ text: '', html }), /^Hello Sam,\n\nYour order has been shipped!/);
});

test('no HTML part keeps whatever text there is', () => {
  assert.equal(bodyTextOf({ text: undefined, html: false }), '');
});
