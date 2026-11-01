"use strict";
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { PROJECT, AUTH_HOST, assertEmulatorEnvironment, createEmulatorServices } = require('./safety');
assertEmulatorEnvironment(); // Fail rather than skip if invoked without isolation.
const { createEmulatorApp, PORT } = require('./server');
const { manageAccount, DELETE_WAIT_MS } = require('../management');
const { deleteApp } = require('firebase-admin/app');
const PASSWORD = 'Synthetic-Only-123!';

test('isolated real Auth/Firestore account-management integration', { timeout: 120000 }, async t => {
  const { app, auth, db } = createEmulatorServices();
  t.after(async () => { await db.terminate(); await deleteApp(app); });
  const prefix = `test-${Date.now()}-`;
  async function seed(name, kind = 'locum', claims = {}) {
    const uid = prefix + name;
    await auth.createUser({ uid, email: `${uid}@example.invalid`, password: PASSWORD });
    await auth.setCustomUserClaims(uid, claims);
    await db.collection(kind === 'locum' ? 'locum_profiles' : 'practice_owner_profiles').doc(uid).set({ fullName: `Synthetic ${name}` });
    return uid;
  }
  async function signIn(uid) {
    assertEmulatorEnvironment();
    const response = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=synthetic`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `${uid}@example.invalid`, password: PASSWORD, returnSecureToken: true }),
    });
    assert.equal(response.status, 200, 'Synthetic emulator sign-in must succeed');
    return (await response.json()).idToken;
  }
  const admin = await seed('admin', 'locum', { admin: true });
  const otherAdmin = await seed('other-admin', 'locum', { admin: true });
  const locum = await seed('locum');
  const owner = await seed('owner', 'practice_owner');
  const disabled = await seed('disabled');
  await auth.updateUser(disabled, { disabled: true });
  const jobOwner = await seed('job-owner', 'practice_owner');
  const applicant = await seed('applicant');
  await db.collection('job_postings').doc(prefix + 'job').set({ clinicOwnerId: jobOwner });
  await db.collection('applications').doc(prefix + 'application').set({ clinicOwnerId: jobOwner, locumId: applicant });
  const adminToken = await signIn(admin);
  const userToken = await signIn(locum);
  const httpApp = createEmulatorApp({ auth, db });
  const server = httpApp.listen(PORT, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  async function request(data, token = adminToken, headers = {}) {
    const response = await fetch(`http://127.0.0.1:${PORT}/api/accounts/manage`, {
      method: 'POST', headers: { Origin: 'http://localhost:5173', 'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: JSON.stringify(data),
    });
    return { status: response.status, body: await response.json() };
  }
  const status = uid => ({ uid, kind: 'locum', action: 'status' });
  await t.test('HTTP rejects missing tokens, non-admin callers and external origins', async () => {
    assert.equal((await request(status(locum), null)).status, 401);
    assert.equal((await request(status(locum), userToken)).status, 403);
    assert.equal((await request(status(locum), adminToken, { Origin: 'https://example.invalid' })).status, 403);
  });
  await t.test('HTTP protects self and administrator targets', async () => {
    for (const uid of [admin, otherAdmin]) assert.equal((await request(status(uid))).body.error.code, 'failed-precondition');
  });
  await t.test('HTTP rechecks removed admin claims, disabled admins and revoked sessions', async () => {
    const uid = await seed('temporary-admin', 'locum', { admin: true });
    const token = await signIn(uid);
    await auth.setCustomUserClaims(uid, {});
    assert.equal((await request(status(locum), token)).status, 403);
    await auth.setCustomUserClaims(uid, { admin: true });
    await auth.updateUser(uid, { disabled: true });
    assert.equal((await request(status(locum), token)).status, 401);
    await auth.updateUser(uid, { disabled: false });
    // Auth timestamps have second precision. Ensure revocation is after sign-in.
    await new Promise(resolve => setTimeout(resolve, 1100));
    await auth.revokeRefreshTokens(uid);
    assert.equal((await request(status(locum), token)).status, 401);
  });
  await t.test('HTTP reads seeded disabled status', async () => {
    assert.deepEqual((await request(status(disabled))).body.data, { disabled: true });
  });
  await t.test('HTTP disables and enables both profile kinds; duplicate retries abort', async () => {
    for (const [uid, kind] of [[locum, 'locum'], [owner, 'practice_owner']]) {
      const data = { uid, kind, action: 'setDisabled', disabled: true, expectedDisabled: false };
      assert.equal((await request(data)).status, 200);
      assert.equal((await auth.getUser(uid)).disabled, true);
      assert.equal((await request(data)).body.error.code, 'aborted');
      assert.equal((await request({ ...data, disabled: false, expectedDisabled: true })).status, 200);
      assert.equal((await auth.getUser(uid)).disabled, false);
      assert.equal((await auth.getUser(uid)).customClaims.accountDisabledAt, undefined);
    }
  });
  await t.test('HTTP rejects malformed requests and mismatched typed UID', async () => {
    assert.equal((await request({ ...status(locum), extra: true })).status, 400);
    assert.equal((await request({ uid: locum, kind: 'locum', action: 'setDisabled', disabled: 'yes', expectedDisabled: false })).status, 400);
    assert.equal((await request({ uid: locum, kind: 'locum', action: 'delete', confirmUid: 'wrong' })).status, 400);
  });
  await t.test('HTTP enforces the real 61-minute deletion guard', async () => {
    await request({ uid: locum, kind: 'locum', action: 'setDisabled', disabled: true, expectedDisabled: false });
    const result = await request({ uid: locum, kind: 'locum', action: 'delete', confirmUid: locum });
    assert.match(result.body.error.message, /61 minutes/);
    assert.equal((await auth.getUser(locum)).disabled, true);
  });
  // Deterministic clock only in direct-core tests: real SDK reads/writes, no 61-minute sleep.
  async function eligible(uid, kind = 'locum') {
    await auth.updateUser(uid, { disabled: true });
    await auth.setCustomUserClaims(uid, { accountDisabledAt: Math.floor(Date.now() / 1000) });
    await auth.revokeRefreshTokens(uid);
    const now = Date.now() + DELETE_WAIT_MS + 2000;
    return { auth, db, actor: { uid: admin, admin: true, auth_time: now / 1000 },
      data: { uid, kind, action: 'delete', confirmUid: uid }, now };
  }
  await t.test('real job and application dependencies block deletion', async () => {
    for (const [uid, kind] of [[jobOwner, 'practice_owner'], [applicant, 'locum']]) {
      await assert.rejects(manageAccount(await eligible(uid, kind)), /related job postings or applications/);
      assert.equal((await auth.getUser(uid)).disabled, true);
    }
  });
  await t.test('stale recent-login time blocks mutations before real emulator writes', async () => {
    const now = Date.now();
    await assert.rejects(manageAccount({ auth, db, actor: { uid: admin, admin: true, auth_time: now / 1000 - 301 },
      data: { uid: owner, kind: 'practice_owner', action: 'setDisabled', disabled: true, expectedDisabled: false }, now }), error => error.code === 'unauthenticated');
    assert.equal((await auth.getUser(owner)).disabled, false);
  });
  await t.test('eligible deletion removes Auth and both profile documents', async () => {
    for (const kind of ['locum', 'practice_owner']) {
      const uid = await seed(`delete-${kind}`, kind);
      await db.collection(kind === 'locum' ? 'practice_owner_profiles' : 'locum_profiles').doc(uid).set({ fullName: 'Synthetic second profile' });
      assert.deepEqual(await manageAccount(await eligible(uid, kind)), { deleted: true });
      await assert.rejects(auth.getUser(uid), error => error.code === 'auth/user-not-found');
      for (const collection of ['locum_profiles', 'practice_owner_profiles']) assert.equal((await db.collection(collection).doc(uid).get()).exists, false);
    }
  });
  await t.test('injected cleanup failure leaves real orphaned profiles for explicit recovery', async () => {
    const uid = await seed('cleanup-failure');
    const args = await eligible(uid);
    const failingDb = { collection: db.collection.bind(db), batch: () => ({ delete() {}, async commit() { throw new Error('Synthetic fault'); } }) };
    await assert.rejects(manageAccount({ ...args, db: failingDb }), /profile cleanup failed/);
    await assert.rejects(auth.getUser(uid), error => error.code === 'auth/user-not-found');
    assert.equal((await db.collection('locum_profiles').doc(uid).get()).exists, true);
    await assert.rejects(manageAccount(args), error => error.code === 'auth/user-not-found');
    // Deliberate emulator-only recovery: finish profile cleanup, never recreate Auth.
    await db.collection('locum_profiles').doc(uid).delete();
    assert.equal((await db.collection('locum_profiles').doc(uid).get()).exists, false);
  });
  await t.test('injected revocation failure exposes partial real Auth change and explicit recovery', async () => {
    const uid = await seed('revoke-failure');
    const faultyAuth = { getUser: auth.getUser.bind(auth), setCustomUserClaims: auth.setCustomUserClaims.bind(auth),
      updateUser: auth.updateUser.bind(auth), revokeRefreshTokens: async () => { throw new Error('Synthetic fault'); } };
    const data = { uid, kind: 'locum', action: 'setDisabled', disabled: true, expectedDisabled: false };
    const now = Date.now();
    const args = { auth: faultyAuth, db, actor: { uid: admin, admin: true, auth_time: now / 1000 }, data, now };
    await assert.rejects(manageAccount(args), /may be incomplete/);
    assert.equal((await auth.getUser(uid)).disabled, true);
    await assert.rejects(manageAccount(args), /status changed/);
    await auth.revokeRefreshTokens(uid); // Explicit recovery, synthetic UID only.
    assert.ok(Number.isFinite(Date.parse((await auth.getUser(uid)).tokensValidAfterTime)));
  });
});
