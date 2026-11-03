"use strict";
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PROJECT, OUTPUT_ROOT, FIELDS, optionsFromArgs, collectReport, run } = require('./inventory');
const stamp = '2026-11-03T00:00:00.000Z';
const output = label => path.join(OUTPUT_ROOT, `report-${label}.json`);
const args = file => ['--project', PROJECT, '--confirm-project', PROJECT, '--out', file];
const user = (uid, extra = {}) => ({ uid, disabled: false, metadata: { creationTime: stamp }, tokensValidAfterTime: stamp, ...extra });
const doc = (id, data) => ({ id, data: () => data });
function services(users = [], collections = {}) {
  const calls = [];
  return { calls, listUsers: async (size, token) => { calls.push(['listUsers', size, token]); return { users }; },
    readPage: async (collection, fields, size, cursor) => { calls.push(['query', collection, fields, size, cursor]); return collections[collection] || []; },
    close: async () => { calls.push(['close']); }, now: () => stamp };
}
test('project confirmation and fixed private destination are mandatory before services are created', async () => {
  const valid = args(output('unit-validation'));
  assert.equal(optionsFromArgs(valid, {}).projectId, PROJECT);
  for (const bad of [[], ['--project', PROJECT], args(output('unit-validation')).map(v => v === '--confirm-project' ? '--apply' : v),
    args(output('unit-validation')).map((v, i) => i === 3 ? 'wrong' : v), args(path.join(__dirname, 'public.json')),
    [...valid, '--apply', 'true']]) {
    let called = false;
    await assert.rejects(run(bad, { env: {}, createServices: () => { called = true; throw new Error('must not reach'); } }));
    assert.equal(called, false);
  }
});
test('emulator overrides and conflicting project configuration fail before credentials', () => {
  for (const env of [{ FIRESTORE_EMULATOR_HOST: 'localhost:8080' }, { FIREBASE_AUTH_EMULATOR_HOST: 'localhost:9099' },
    { CLOUDSDK_API_ENDPOINT_OVERRIDES_FIRESTORE: 'https://other.invalid' }, { GOOGLE_CLOUD_PROJECT: 'wrong' },
    { FIREBASE_CONFIG: 'credential-file.json' }, { FIREBASE_CONFIG: '{"projectId":"wrong"}' }, { NODE_DEBUG: 'http' }])
    assert.throws(() => optionsFromArgs(args(output('unit-env')), env));
});
test('allowlisted report drops PII, password material and unknown claims/status values', async () => {
  const fake = services([user('synthetic', { email: 'private@example.invalid', phoneNumber: '+60123456789', passwordHash: 'SECRET-HASH',
    passwordSalt: 'SECRET-SALT', customClaims: { admin: 'private@example.invalid', secret: 'SECRET-CLAIM', accountDisabledAt: 'private@example.invalid' } })], {
    locum_profiles: [doc('synthetic', { fullName: 'PRIVATE-NAME', email: 'private@example.invalid', verificationStatus: 'PRIVATE-STATUS', disabledAt: 'PRIVATE-MARKER' })],
    account_access: [doc('synthetic', { state: 'PRIVATE-STATE', updatedBy: 'PRIVATE-ACTOR', updatedAt: stamp, validAfter: 0, schemaVersion: 1 })],
  });
  const report = await collectReport(fake);
  assert.doesNotMatch(JSON.stringify(report), /private@example|60123456789|SECRET|PRIVATE-/);
  assert.equal(report.rows[0].auth.adminClaim, 'malformed');
  assert.equal(report.rows[0].locum.verificationStatus, 'malformed');
  assert.ok(report.rows[0].flags.includes('malformed-projected-access'));
  assert.ok(fake.calls.filter(c => c[0] === 'query').every(c => c[2] === FIELDS[c[1]]));
});
test('inventory exposes conflicts, administrators, disabled states, orphans and markers without eligibility decisions', async () => {
  const fake = services([user('admin', { customClaims: { admin: true } }), user('disabled', { disabled: true, customClaims: { accountDisabledAt: 12 } }), user('dual')], {
    locum_profiles: [doc('dual', { verificationStatus: 'verified' }), doc('orphan', { verificationStatus: 'pending', deletedAt: 10 })],
    practice_owner_profiles: [doc('dual', { verificationStatus: 'verified' })],
    account_access: [doc('disabled', { state: 'active', schemaVersion: 1, validAfter: 0, updatedAt: stamp, updatedBy: 'admin' }), doc('tombstone', { state: 'deleted' })],
    account_lifecycle: [doc('tombstone', { state: 'deleted', everDeleted: true, deletedAt: 12 })],
  });
  const report = await collectReport(fake);
  assert.equal(report.summary.administrators, 1); assert.equal(report.summary.disabledUsers, 1);
  assert.equal(report.summary.conflictingProfiles, 1); assert.equal(report.summary.orphanProfiles, 1);
  assert.equal(report.summary.authAccessConflicts, 1); assert.equal(report.summary.lifecycleRecords, 1);
  assert.ok(report.rows.every(r => r.decision === 'manual-review-only'));
  assert.ok(report.rows.find(r => r.uid === 'admin').flags.includes('administrator-protected'));
  assert.equal(report.atomicSnapshot, false);
});
test('both Auth and Firestore are paginated using read-only cursors', async () => {
  let authCalls = 0;
  const fake = services();
  fake.listUsers = async (size, token) => { authCalls++; assert.equal(size, 500); return token ? { users: [user('last')] } : { users: [user('first')], pageToken: 'next' }; };
  let pages = 0;
  fake.readPage = async (collection, fields, size, cursor) => {
    if (collection !== 'locum_profiles') return [];
    pages++;
    if (cursor) { assert.equal(cursor, 'uid-499'); return [doc('zz-last', {})]; }
    return Array.from({ length: size }, (_, i) => doc(`uid-${String(i).padStart(3, '0')}`, {}));
  };
  const report = await collectReport(fake);
  assert.equal(authCalls, 2); assert.equal(pages, 2); assert.equal(report.summary.locumProfiles, 501);
});
test('duplicate identities or cursors fail instead of generating a misleading complete report', async () => {
  await assert.rejects(collectReport(services([user('same'), user('same')])));
  const fake = services(); fake.listUsers = async () => ({ users: [], pageToken: 'repeated' });
  await assert.rejects(collectReport(fake), /cursor/);
});
test('successful local run creates an exclusive private report and prints aggregate counts only', async t => {
  const file = output(`unit-${require('node:crypto').randomUUID()}`), logs = [], fake = services([user('synthetic-private-uid')]);
  t.after(() => { if (fs.existsSync(file)) fs.unlinkSync(file); });
  await run(args(file), { env: {}, createServices: async () => fake, log: value => logs.push(value) });
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).summary.authUsers, 1);
  assert.doesNotMatch(logs.join(''), /synthetic-private-uid|rows|email|phone/);
  assert.deepEqual(fake.calls.at(-1), ['close']);
  let called = false;
  await assert.rejects(run(args(file), { env: {}, createServices: () => { called = true; } }));
  assert.equal(called, false);
});
test('read failure writes no report, prints no identity details and closes clients', async () => {
  const file = output(`unit-${require('node:crypto').randomUUID()}`), fake = services(), logs = [];
  fake.readPage = async () => { throw new Error('private@example.invalid token-secret'); };
  await assert.rejects(run(args(file), { env: {}, createServices: async () => fake, log: value => logs.push(value) }));
  assert.equal(fs.existsSync(file), false); assert.deepEqual(logs, []); assert.deepEqual(fake.calls.at(-1), ['close']);
});
