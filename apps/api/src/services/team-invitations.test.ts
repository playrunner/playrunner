import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createInvitationToken,
  getInvitationStatus,
  hashInvitationToken,
  isValidEmail,
  normalizeEmail,
  verifiedEmailMatches,
} from './team-invitations';

test('normalizes invitation email addresses case-insensitively', () => {
  assert.equal(normalizeEmail('  Person@Example.COM '), 'person@example.com');
  assert.equal(isValidEmail('person@example.com'), true);
  assert.equal(isValidEmail('not-an-email'), false);
});

test('requires a verified matching email to claim an invitation', () => {
  assert.equal(
    verifiedEmailMatches('PERSON@example.com', true, 'person@EXAMPLE.com'),
    true,
  );
  assert.equal(
    verifiedEmailMatches('person@example.com', false, 'person@example.com'),
    false,
  );
  assert.equal(
    verifiedEmailMatches('other@example.com', true, 'person@example.com'),
    false,
  );
});

test('hashes random invitation tokens before persistence', () => {
  const token = createInvitationToken();
  assert.ok(token.length >= 40);
  assert.notEqual(hashInvitationToken(token), token);
  assert.equal(hashInvitationToken(token), hashInvitationToken(token));
});

test('reports pending invitations as expired after their deadline', () => {
  const now = new Date('2026-08-02T00:00:00.000Z');
  assert.equal(
    getInvitationStatus('pending', new Date('2026-08-01T00:00:00.000Z'), now),
    'expired',
  );
  assert.equal(
    getInvitationStatus('accepted', new Date('2026-08-01T00:00:00.000Z'), now),
    'accepted',
  );
});
