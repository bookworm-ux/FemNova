import test from 'node:test';
import assert from 'node:assert/strict';

import { hrefForPage, isIsoDate, isStrongPassword, isValidEmail, pageFromLocation } from '../src/lib.js';

test('page routing resolves from pathname and legacy hash URLs', () => {
  assert.equal(pageFromLocation({ pathname: '/', hash: '' }), 'home');
  assert.equal(pageFromLocation({ pathname: '/labs', hash: '' }), 'labs');
  assert.equal(pageFromLocation({ pathname: '/community/', hash: '' }), 'community');
  assert.equal(pageFromLocation({ pathname: '/ignored', hash: '#settings' }), 'settings');
  assert.equal(pageFromLocation({ pathname: '/not-real', hash: '' }), 'home');
});

test('page hrefs map to clean routes', () => {
  assert.equal(hrefForPage('home'), '/');
  assert.equal(hrefForPage('labs'), '/labs');
  assert.equal(hrefForPage('community'), '/community');
  assert.equal(hrefForPage('settings'), '/settings');
});

test('shared validators guard common input errors', () => {
  assert.equal(isIsoDate('2026-09-12'), true);
  assert.equal(isIsoDate('2026-13-12'), false);
  assert.equal(isValidEmail('user@example.com'), true);
  assert.equal(isValidEmail('not-an-email'), false);
  assert.equal(isStrongPassword('SecurePass123'), true);
  assert.equal(isStrongPassword('short'), false);
});
