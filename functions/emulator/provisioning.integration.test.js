"use strict";
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { assertEmulatorEnvironment, createEmulatorServices, AUTH_HOST } = require('./safety');
const { provisionAccount } = require('./provisioning');
const { createEmulatorApp, PORT } = require('./server');
assertEmulatorEnvironment();
test('trusted emulator-only provisioning', { timeout: 120000 }, async t => {
  const { app, auth, db } = createEmulatorServices();
  t.after(async () => { await db.terminate(); await require('firebase-admin/app').deleteApp(app); });
  const prefix = `provision-${Date.now()}-`;
  const password = 'Synthetic-Only-123!';
  async function seed(name, kind = 'locum', status = 'verified', claims = {}) {
    const uid = prefix + name;
    await auth.createUser({ uid, email: `${uid}@example.invalid`, password });
    await auth.setCustomUserClaims(uid, claims);
    if (status !== null) await db.collection(kind === 'locum' ? 'locum_profiles' : 'practice_owner_profiles').doc(uid).set({ verificationStatus: status });
    return uid;
  }
  const admin = await seed('admin', 'locum', 'verified', { admin: true });
  const actor = { uid: admin, admin: true, auth_time: Math.floor(Date.now() / 1000) };
  const call = (uid, kind = 'locum', overrides = {}) => provisionAccount({ auth, db, actor, data: { uid, kind }, ...overrides });
  await t.test('creates exact contract for both verified profile kinds; does not change verification', async () => {
    for (const kind of ['locum', 'practice_owner']) {
      const uid = await seed(kind, kind);
      const result = await call(uid, kind);
      const record = (await db.collection('account_access').doc(uid).get()).data();
      assert.deepEqual(Object.keys(record).sort(), ['schemaVersion', 'state', 'updatedAt', 'updatedBy', 'validAfter']);
      assert.equal(record.state, 'active'); assert.equal(record.schemaVersion, 1);
      assert.equal(record.updatedBy, admin); assert.ok(record.validAfter >= actor.auth_time);
      assert.equal(result.requiresNewLogin, true);
      assert.equal((await db.collection(kind === 'locum' ? 'locum_profiles' : 'practice_owner_profiles').doc(uid).get()).data().verificationStatus, 'verified');
    }
  });
  await t.test('concurrent duplicate requests create exactly once', async () => {
    const uid = await seed('duplicate');
    const results = await Promise.allSettled([call(uid), call(uid)]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(results.find(r => r.status === 'rejected').reason.code, 'already-exists');
  });
  await t.test('all existing states including tombstones and malformed records are immutable', async () => {
    for (const state of ['active', 'disabled', 'deleting', 'deleted', 'unknown']) {
      const uid = await seed(state);
      await db.collection('account_access').doc(uid).set({ state });
      await assert.rejects(call(uid), { code: 'already-exists' });
      assert.deepEqual((await db.collection('account_access').doc(uid).get()).data(), { state });
    }
  });
  await t.test('missing, unverified, pending and conflicting profiles are blocked', async () => {
    for (const status of [null, 'pending', 'unverified']) {
      const uid = await seed(`status-${status}`, 'locum', status);
      await assert.rejects(call(uid), { code: 'failed-precondition' });
      assert.equal((await db.collection('account_access').doc(uid).get()).exists, false);
    }
    const uid = await seed('dual');
    await db.collection('practice_owner_profiles').doc(uid).set({ verificationStatus: 'verified' });
    await assert.rejects(call(uid), { code: 'failed-precondition' });
  });
  await t.test('disabled Auth, historical disable markers, self and administrators are protected', async () => {
    const disabled = await seed('disabled-auth'); await auth.updateUser(disabled, { disabled: true });
    const marked = await seed('marked', 'locum', 'verified', { accountDisabledAt: 1 });
    const otherAdmin = await seed('other-admin', 'locum', 'verified', { admin: true });
    for (const uid of [disabled, marked, admin, otherAdmin]) await assert.rejects(call(uid), { code: 'failed-precondition' });
  });
  await t.test('strict input and administrator authorization reject invalid requests', async () => {
    const uid = await seed('validation');
    for (const data of [{ uid, kind: 'locum', state: 'active' }, { uid: '../bad', kind: 'locum' }, { uid, kind: 'admin' }, null, []])
      await assert.rejects(call(uid, 'locum', { data }), { code: 'invalid-argument' });
    for (const invalidActor of [null, { ...actor, admin: false }, { ...actor, auth_time: actor.auth_time - 301 }])
      await assert.rejects(call(uid, 'locum', { actor: invalidActor }));
    await auth.setCustomUserClaims(admin, {});
    await assert.rejects(call(uid), { code: 'permission-denied' });
    await auth.setCustomUserClaims(admin, { admin: true });
    await auth.updateUser(admin, { disabled: true });
    await assert.rejects(call(uid), { code: 'permission-denied' });
    await auth.updateUser(admin, { disabled: false });
  });
  await t.test('HTTP verifies real emulator tokens and refuses self activation', async () => {
    const uid = await seed('http');
    async function token(id) {
      const response = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=synthetic`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${id}@example.invalid`, password, returnSecureToken: true }) });
      assert.equal(response.status, 200); return (await response.json()).idToken;
    }
    // Original integration suite uses PORT; use an in-process app and wait until
    // that suite finishes by running these files with test-concurrency=1.
    const server = createEmulatorApp({ auth, db }).listen(PORT, '127.0.0.1');
    await once(server, 'listening');
    try {
      const request = async bearer => fetch(`http://127.0.0.1:${PORT}/api/accounts/provision`, { method: 'POST',
        headers: { Origin: 'http://localhost:5173', 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) }, body: JSON.stringify({ uid, kind: 'locum' }) });
      assert.equal((await request(null)).status, 401);
      assert.equal((await request(await token(uid))).status, 403);
      assert.equal((await request(await token(admin))).status, 200);
      assert.equal((await request(await token(admin))).status, 409);
    } finally { await new Promise(resolve => server.close(resolve)); }
  });
});
