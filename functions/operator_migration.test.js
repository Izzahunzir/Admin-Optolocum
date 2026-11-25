'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { plan, collect, collectPaged, applyIsolated, journaledIsolated, controlledMigration } = require('./operator_migration');
const date = '2026-01-01T00:00:00Z';
const user = uid => ({ uid, disabled: false, admin: false, historicalDisable: false, tokensValidAfterTime: date });
const review = (uid, kind = 'locum') => ({ uid, kind, reviewer: 'reviewer-1', evidenceReference: 'case-1' });
const snapshot = () => ({ projectId: 'optolocum-f314e', capturedAt: date, users: [user('a')], locum_profiles: [{ uid: 'a', verificationStatus: 'verified' }], practice_owner_profiles: [], account_management: [], account_access: [] });
test('requires independent explicit review; never promotes profile verification', () => {
  const s = snapshot();
  assert.equal(plan(s).rows[0].action, 'manual-review');
  const result = plan(s, [review('a')]);
  assert.equal(result.rows[0].action, 'create-missing-only');
  assert.deepEqual(result.rows[0].issues, ['missing-assignment', 'missing-access']);
  assert.equal(s.locum_profiles[0].verificationStatus, 'verified');
  assert.deepEqual(plan(s, [review('a')]), result);
});
test('conflicts, restricted accounts, existing transitions and malformed access require review', () => {
  for (const mutate of [s => s.practice_owner_profiles.push({ uid: 'a' }), s => { s.users[0].disabled = true; },
    s => s.account_access.push({ uid: 'a', value: { state: 'disabled', validAfter: 1, operation: 'enable' } }),
    s => s.account_access.push({ uid: 'a', value: { state: 'active', validAfter: 1, schemaVersion: 1 } }),
    s => s.account_management.push({ uid: 'a', trustedAccountType: 'practice_owner' })]) {
    const s = snapshot(); mutate(s); assert.equal(plan(s, [review('a')]).rows[0].action, 'manual-review');
  }
  assert.throws(() => plan(snapshot(), [review('a'), review('a')]));
});
test('existing administrator requires claim and explicit review; existing access is preserved', () => {
  const s = snapshot(); s.users[0].admin = true; s.locum_profiles = [];
  assert.equal(plan(s, [review('a', 'administrator')]).rows[0].action, 'create-missing-only');
  s.account_access.push({ uid: 'a', value: { state: 'active', validAfter: Date.parse(date) / 1000, operation: null } });
  assert.equal(plan(s, [review('a', 'administrator')]).rows[0].action, 'preserve-existing');
  s.users[0].admin = false;
  assert.equal(plan(s, [review('a', 'administrator')]).rows[0].action, 'manual-review');
});
test('collector omits profile PII and apply cannot run without isolated emulator', async () => {
  const auth = { listUsers: async () => ({ users: [{ ...user('a'), customClaims: {}, email: 'secret@example.test' }] }) };
  const db = { collection: name => ({ get: async () => ({ docs: name === 'locum_profiles' ? [{ id: 'a', data: () => ({ fullName: 'private', verificationStatus: 'pending' }) }] : [] }) }) };
  const s = await collect({ auth, db, projectId: 'optolocum-f314e' });
  assert.doesNotMatch(JSON.stringify(s), /secret|private/);
  await assert.rejects(applyIsolated({ auth, db, snapshot: s, reviews: [], uid: 'a' }));
});
test('isolated create-only transaction writes assignment and access, then preserves them', async () => {
  const keys = ['GCLOUD_PROJECT', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST'];
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  Object.assign(process.env, { GCLOUD_PROJECT: 'demo-optolocum-account-management', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:19099', FIRESTORE_EMULATOR_HOST: '127.0.0.1:18080' });
  try {
    const docs = new Map([['locum_profiles/a', { verificationStatus: 'verified' }]]);
    const db = { collection: name => ({ doc: uid => `${name}/${uid}` }), runTransaction: async fn => fn({
      get: async ref => ({ exists: docs.has(ref), data: () => docs.get(ref) }),
      create: (ref, data) => { assert.equal(docs.has(ref), false); docs.set(ref, data); },
    }) };
    const auth = { getUser: async () => ({ disabled: false, customClaims: {}, tokensValidAfterTime: date }) };
    const s = snapshot(), reviews = [review('a')];
    await applyIsolated({ auth, db, snapshot: s, reviews, uid: 'a', now: Date.parse(date) });
    assert.equal(docs.get('account_management/a').trustedAccountType, 'locum');
    assert.deepEqual(docs.get('account_access/a'), { state: 'active', validAfter: Date.parse(date) / 1000, operation: null });
    await applyIsolated({ auth, db, snapshot: s, reviews, uid: 'a', now: Date.parse(date) });
    assert.equal(docs.size, 3);
  } finally { for (const key of keys) saved[key] === undefined ? delete process.env[key] : process.env[key] = saved[key]; }
});
test('inventory paginates every collection, bounds output and redacts unexpected data', async () => {
  const pages = [];
  const listUsers = async (size, cursor) => ({ users: cursor ? [{ uid: 'b', disabled: true, customClaims: {}, tokensValidAfterTime: date }] : [{ uid: 'a', disabled: false, customClaims: {}, tokensValidAfterTime: date, email: 'private' }], ...(cursor ? {} : { pageToken: 'next' }) });
  const readPage = async (name, size, cursor) => { pages.push([name, cursor]);
    if (name !== 'locum_profiles') return [];
    if (cursor === 'b') return [];
    return cursor ? [{ id: 'b', data: () => ({ verificationStatus: 'pending', nric: 'secret' }) }] : [{ id: 'a', data: () => ({ verificationStatus: 'verified', fullName: 'private' }) }];
  };
  const data = await collectPaged({ listUsers, readPage, projectId: 'optolocum-f314e', pageSize: 1 });
  assert.equal(data.users.length, 2); assert.equal(data.locum_profiles.length, 2);
  assert.ok(pages.some(([name, cursor]) => name === 'locum_profiles' && cursor === 'a'));
  assert.doesNotMatch(JSON.stringify(data), /secret|private/);
  await assert.rejects(collectPaged({ listUsers, readPage, projectId: 'optolocum-f314e', pageSize: 1, maxRows: 1 }));
  await assert.rejects(collectPaged({ listUsers, readPage, projectId: 'other' }));
});
test('journaled execution rejects unauthorized and stale plans before creating a journal', async () => {
  const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
  const keys = ['GCLOUD_PROJECT', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST'];
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  Object.assign(process.env, { GCLOUD_PROJECT: 'demo-optolocum-account-management', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:19099', FIRESTORE_EMULATOR_HOST: '127.0.0.1:18080' });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'opt-journal-'));
  try {
    const s = snapshot(), reviews = [review('a')], r = plan(s, reviews), uid = 'a';
    const expectedPlanHash = crypto.createHash('sha256').update(JSON.stringify([r.inventorySha256, r.reviewSha256, uid])).digest('hex');
    const journalPath = path.join(dir, 'journal');
    const auth = { verifyIdToken: async () => ({ uid: 'operator', admin: false, auth_time: Date.parse(date) / 1000 }) };
    await assert.rejects(journaledIsolated({ auth, db: {}, snapshot: s, reviews, uid, token: 'x', journalPath, expectedPlanHash, now: Date.parse(date) }));
    await assert.rejects(journaledIsolated({ auth, db: {}, snapshot: s, reviews, uid, token: 'x', journalPath, expectedPlanHash, now: Date.parse(date) + 900001 }));
    await assert.rejects(fs.stat(journalPath));
  } finally {
    for (const key of keys) saved[key] === undefined ? delete process.env[key] : process.env[key] = saved[key];
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test('interrupted isolated work leaves durable intent and prevents blind retry', async () => {
  const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
  const keys = ['GCLOUD_PROJECT', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST'];
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  Object.assign(process.env, { GCLOUD_PROJECT: 'demo-optolocum-account-management', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:19099', FIRESTORE_EMULATOR_HOST: '127.0.0.1:18080' });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'opt-journal-'));
  try {
    const s = snapshot(), reviews = [review('a')], r = plan(s, reviews), uid = 'a', now = Date.parse(date);
    const expectedPlanHash = crypto.createHash('sha256').update(JSON.stringify([r.inventorySha256, r.reviewSha256, uid])).digest('hex');
    const journalPath = path.join(dir, 'journal');
    const auth = { verifyIdToken: async (_, check) => { assert.equal(check, true); return { uid: 'operator', admin: true, auth_time: now / 1000 }; },
      getUser: async id => { if (id === 'operator') return { disabled: false, customClaims: { admin: true } }; throw new Error('interrupted'); } };
    const db = { collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => ({ state: 'active', validAfter: now / 1000 - 1 }) }) }) }) };
    const args = { auth, db, snapshot: s, reviews, uid, token: 'x', journalPath, expectedPlanHash, now };
    await assert.rejects(journaledIsolated(args));
    const entries = (await fs.readFile(journalPath, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(entries.length, 1); assert.equal(entries[0].phase, 'intent');
    await assert.rejects(journaledIsolated(args), { code: 'EEXIST' });
  } finally {
    for (const key of keys) saved[key] === undefined ? delete process.env[key] : process.env[key] = saved[key];
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test('isolated executor aborts when profile or assignment changes concurrently', async () => {
  const keys = ['GCLOUD_PROJECT', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST'];
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  Object.assign(process.env, { GCLOUD_PROJECT: 'demo-optolocum-account-management', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:19099', FIRESTORE_EMULATOR_HOST: '127.0.0.1:18080' });
  try {
    for (const extra of [['practice_owner_profiles/a', {}], ['account_management/a', { trustedAccountType: 'practice_owner' }]]) {
      const docs = new Map([['locum_profiles/a', {}], extra]); let writes = 0;
      const db = { collection: name => ({ doc: uid => `${name}/${uid}` }), runTransaction: async fn => fn({
        get: async ref => ({ exists: docs.has(ref), data: () => docs.get(ref) }), create: () => { writes++; },
      }) };
      const auth = { getUser: async () => ({ disabled: false, customClaims: {}, tokensValidAfterTime: date }) };
      await assert.rejects(applyIsolated({ auth, db, snapshot: snapshot(), reviews: [review('a')], uid: 'a', now: Date.parse(date) }));
      assert.equal(writes, 0);
    }
  } finally { for (const key of keys) saved[key] === undefined ? delete process.env[key] : process.env[key] = saved[key]; }
});
test('controlled execution reconciles an uncertain commit without altering profile data', async () => {
  const crypto = require('node:crypto'), s = snapshot(), reviews = [review('a')], r = plan(s, reviews), uid = 'a', now = Date.parse(date);
  const approvedHash = crypto.createHash('sha256').update(JSON.stringify([r.inventorySha256, r.reviewSha256, uid])).digest('hex');
  const originalProfile = { verificationStatus: 'verified', name: 'preserve' };
  const docs = new Map([['locum_profiles/a', originalProfile], ['account_access/operator', { state: 'active', validAfter: now / 1000 - 10 }]]);
  let loseReply = true, stored = null;
  const db = { collection: name => ({ doc: id => { const key = `${name}/${id}`; return { key, get: async () => ({ exists: docs.has(key), data: () => docs.get(key) }) }; } }),
    runTransaction: async fn => {
      const changes = [], tx = { get: async ref => ({ exists: docs.has(ref.key), data: () => docs.get(ref.key) }),
        create: (ref, value) => changes.push(() => { assert.equal(docs.has(ref.key), false); docs.set(ref.key, value); }),
        update: (ref, value) => changes.push(() => docs.set(ref.key, { ...docs.get(ref.key), ...value })) };
      const result = await fn(tx); changes.forEach(f => f());
      if (loseReply) { loseReply = false; throw Error('lost commit response'); } return result;
    } };
  const auth = { verifyIdToken: async (_, revoked) => { assert.equal(revoked, true); return { uid: 'operator', admin: true, auth_time: now / 1000 }; },
    getUser: async id => id === 'operator' ? { disabled: false, customClaims: { admin: true } } : { disabled: false, customClaims: {}, tokensValidAfterTime: date } };
  const journal = { read: async () => stored, create: async value => { stored = value; }, complete: async () => {} };
  const args = { auth, db, snapshot: s, reviews, uid, token: 'synthetic', approvedHash, journal, now };
  await assert.rejects(controlledMigration(args), /lost commit/);
  assert.equal(docs.get('account_access/a').state, 'disabled');
  assert.equal((await controlledMigration(args)).result, 'complete');
  assert.equal(docs.get('account_access/a').state, 'active');
  assert.deepEqual(docs.get('locum_profiles/a'), originalProfile);
  assert.equal(docs.get('account_management/a').trustedAccountType, 'locum');
  await assert.rejects(controlledMigration({ ...args, approvedHash: '0'.repeat(64) }));
  await assert.rejects(controlledMigration({ ...args, auth: { ...auth, verifyIdToken: async () => ({ uid: 'operator', admin: false }) } }));
});
test('controlled administrator bootstrap and disabled target checks', async () => {
  const crypto = require('node:crypto'), s = snapshot(), now = Date.parse(date), uid = 'a';
  s.users[0].admin = true; s.locum_profiles = [];
  const reviews = [review(uid, 'administrator')], r = plan(s, reviews);
  const approvedHash = crypto.createHash('sha256').update(JSON.stringify([r.inventorySha256, r.reviewSha256, uid])).digest('hex');
  const docs = new Map(); let stored;
  const db = { collection: n => ({ doc: id => { const key = `${n}/${id}`; return { key, get: async () => ({ exists: docs.has(key), data: () => docs.get(key) }) }; } }),
    runTransaction: async f => f({ get: async ref => ({ exists: docs.has(ref.key), data: () => docs.get(ref.key) }),
      create: (ref, value) => { assert.equal(docs.has(ref.key), false); docs.set(ref.key, value); },
      update: (ref, value) => docs.set(ref.key, { ...docs.get(ref.key), ...value }) }) };
  let disabled = true;
  const auth = { verifyIdToken: async () => ({ uid, admin: true, auth_time: now / 1000 }),
    getUser: async () => ({ disabled, customClaims: { admin: true }, tokensValidAfterTime: date }) };
  const journal = { read: async () => stored, create: async value => { stored = value; }, complete: async () => {} };
  const args = { auth, db, snapshot: s, reviews, uid, token: 'x', approvedHash, journal, now };
  await assert.rejects(controlledMigration(args)); assert.equal(docs.size, 0);
  disabled = false;
  await controlledMigration(args);
  assert.deepEqual(docs.get('account_access/a'), { state: 'active', validAfter: now / 1000, operation: null });
  assert.equal(docs.has('account_management/a'), false);
  await controlledMigration(args);
});
