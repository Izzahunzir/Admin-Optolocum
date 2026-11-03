"use strict";
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { planMigration, collectInventory } = require('./migration');
const stamp = '2026-01-01T00:00:00.000Z';
const user = (uid, extra = {}) => ({ uid, disabled: false, tokensValidAfterTime: stamp, ...extra });
const profile = uid => ({ uid, verificationStatus: 'verified' });
const input = () => ({ schemaVersion: 1, projectId: 'optolocum-f314e', capturedAt: stamp, users: [user('locum'), user('owner')],
  locumProfiles: [profile('locum')], ownerProfiles: [profile('owner')], accessRecords: [] });
test('offline report is deterministic, read-only and supports both kinds', () => {
  const data = input(), before = JSON.stringify(data), report = planMigration(data);
  assert.equal(report.mode, 'dry-run-only');
  assert.deepEqual(report.rows.map(r => r.recommendation), ['review-active-candidate', 'review-active-candidate']);
  assert.deepEqual(planMigration(data), report);
  assert.equal(JSON.stringify(data), before);
});
test('administrators, disabled, missing and ambiguous profiles never become active candidates', () => {
  const data = input();
  data.users = [user('admin', { customClaims: { admin: true } }), user('disabled', { disabled: true }), user('missing'), user('dual'), user('pending')];
  data.locumProfiles = ['admin', 'disabled', 'dual'].map(profile).concat({ uid: 'pending', verificationStatus: 'pending' }, profile('orphan'));
  data.ownerProfiles = [profile('dual')];
  const report = planMigration(data);
  assert.equal(report.totals.administrators, 1);
  assert.equal(report.totals.disabled, 1);
  assert.equal(report.totals.missingProfiles, 1);
  assert.ok(report.rows.every(r => r.recommendation !== 'review-active-candidate'));
  assert.ok(report.rows.find(r => r.uid === 'dual').issues.includes('conflicting-profiles'));
  assert.ok(report.rows.find(r => r.uid === 'orphan').issues.includes('orphan-documents'));
});
test('existing access records, tombstones and Auth conflicts are preserved', () => {
  for (const state of ['active', 'disabled', 'deleting', 'deleted', 'unknown']) {
    const data = input();
    data.users[0].disabled = true;
    data.accessRecords = [{ uid: 'locum', state, schemaVersion: 1, validAfter: 0, updatedAt: stamp, updatedBy: 'reviewer' }];
    const row = planMigration(data).rows[0];
    assert.equal(row.recommendation, 'preserve-existing-review-conflicts');
    assert.ok(row.issues.includes('stale-cutoff'));
    assert.ok(row.issues.includes(state === 'active' ? 'auth-access-conflict' : 'restrictive-access-preserve'));
    if (state === 'unknown') assert.ok(row.issues.includes('malformed-access'));
  }
});
test('historical disables and malformed Auth data require review', () => {
  for (const extra of [{ disabled: 'false' }, { tokensValidAfterTime: 'bad' }, { customClaims: { accountDisabledAt: 1 } }, { customClaims: { admin: 'true' } }]) {
    const data = input(); Object.assign(data.users[0], extra);
    assert.equal(planMigration(data).rows[0].recommendation, 'manual-review');
  }
});
test('invalid inventory and duplicate UIDs fail instead of silently merging', () => {
  for (const key of ['users', 'locumProfiles', 'ownerProfiles', 'accessRecords']) {
    const data = input(); data[key] = [{ uid: 'duplicate' }, { uid: 'duplicate' }];
    assert.throws(() => planMigration(data), /duplicate UID/);
  }
  assert.throws(() => planMigration({ ...input(), projectId: 'wrong' }), /envelope/);
});
test('collector paginates Auth, reads orphans, excludes identity PII and has no write API', async () => {
  const calls = [];
  const auth = { listUsers: async (size, token) => { calls.push([size, token]); return token ? { users: [user('owner')] } :
    { users: [{ ...user('locum'), customClaims: { admin: 'true' }, email: 'private@example.invalid', passwordHash: 'secret' }], pageToken: 'next' }; } };
  const db = { collection: name => ({ get: async () => ({ docs: name === 'locum_profiles' ? [{ id: 'orphan', data: () => ({ verificationStatus: 'pending', fullName: 'private' }) }] : [] }) }) };
  const result = await collectInventory({ auth, db, projectId: 'optolocum-f314e', now: stamp });
  assert.equal(calls.length, 2);
  assert.equal(result.users.length, 2);
  assert.equal(result.locumProfiles[0].uid, 'orphan');
  assert.ok(planMigration(result).rows.find(r => r.uid === 'locum').issues.includes('ambiguous-admin-claim'));
  assert.doesNotMatch(JSON.stringify(result), /private|secret/);
});
