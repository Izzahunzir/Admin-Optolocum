"use strict";
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { assertEmulatorEnvironment, createEmulatorServices, AUTH_HOST } = require('./safety');
const { createLocalApp } = require('../local_app');
const { parseDemoConfig, PROJECT } = require('../demo_config');
const { manageAccount } = require('../management');
assertEmulatorEnvironment();
test('restricted first-live-test backend with synthetic Firebase services', { timeout: 120000 }, async t => {
  const { app, auth, db } = createEmulatorServices();
  t.after(async () => { await db.terminate(); await require('firebase-admin/app').deleteApp(app); });
  const prefix = `restricted-${Date.now()}-`, password = 'Synthetic-Only-123!';
  async function seed(name, kind = 'locum', claims = {}) {
    const uid = prefix + name;
    await auth.createUser({ uid, email: `${uid}@example.invalid`, password });
    await auth.setCustomUserClaims(uid, claims);
    await db.collection(kind === 'locum' ? 'locum_profiles' : 'practice_owner_profiles').doc(uid).set({ verificationStatus: 'pending' });
    return uid;
  }
  const admin = await seed('admin', 'locum', { admin: true }), locum = await seed('locum', 'locum', { role: 'locum' }), owner = await seed('owner', 'practice_owner');
  const config = { projectId: PROJECT, enableMutations: true, approvedTestUids: [locum, owner], locumTestUid: locum };
  const policy = parseDemoConfig(config);
  async function signIn(uid) {
    const res = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=synthetic`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${uid}@example.invalid`, password, returnSecureToken: true }) });
    return { status: res.status, data: await res.json() };
  }
  const adminToken = (await signIn(admin)).data.idToken, userToken = (await signIn(locum)).data.idToken;
  const server = createLocalApp({ auth, db, demoPolicy: policy }).listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  function request(data, token = adminToken, origin = 'http://localhost:5173') {
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: '/api/accounts/manage', method: 'POST',
        headers: { Host: '127.0.0.1:8787', Origin: origin, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } }, res => {
        let text = ''; res.on('data', c => { text += c; }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
      }); req.on('error', reject); req.end(JSON.stringify(data));
    });
  }
  const status = (uid, kind = 'locum') => ({ uid, kind, action: 'status' });
  const disable = (uid = locum, kind = 'locum') => ({ uid, kind, action: 'setDisabled', disabled: true, expectedDisabled: false });
  const deletion = { uid: locum, kind: 'locum', action: 'delete', confirmUid: locum };
  const actor = () => ({ uid: admin, admin: true, auth_time: Math.floor(Date.now() / 1000) });
  const core = (data, overrides = {}) => manageAccount({ auth, db, demoPolicy: policy, actor: actor(), data, ...overrides });
  await t.test('HTTP still requires real admin tokens, current claims and allowed origin', async () => {
    assert.equal((await request(disable(), null)).status, 401);
    assert.equal((await request(disable(), userToken)).status, 403);
    assert.equal((await request(disable(), adminToken, 'https://example.invalid')).status, 403);
    await auth.setCustomUserClaims(admin, {});
    assert.equal((await request(disable())).status, 403);
    await auth.setCustomUserClaims(admin, { admin: true });
  });
  await t.test('status exposes capability only for the selected Locum, not another approved role', async () => {
    assert.equal((await request(status(locum))).body.data.mutationsEnabled, true);
    assert.equal((await request(status(owner, 'practice_owner'))).body.data.mutationsEnabled, false);
    assert.equal((await request(disable(owner, 'practice_owner'))).status, 403);
    assert.equal((await request(disable(locum, 'practice_owner'))).status, 403);
    assert.equal((await auth.getUser(owner)).disabled, false);
  });
  await t.test('HTTP Disable and Enable work while claims and verification remain unchanged', async () => {
    assert.equal((await request(disable())).status, 200);
    assert.equal((await auth.getUser(locum)).disabled, true);
    assert.equal((await signIn(locum)).status, 400);
    assert.equal((await request(disable())).body.error.code, 'aborted');
    assert.equal((await request({ ...disable(), disabled: false, expectedDisabled: true })).status, 200);
    assert.equal((await auth.getUser(locum)).disabled, false);
    assert.equal((await signIn(locum)).status, 200);
    assert.deepEqual((await auth.getUser(locum)).customClaims, { role: 'locum' });
    assert.equal((await db.collection('locum_profiles').doc(locum).get()).data().verificationStatus, 'pending');
  });
  await t.test('Delete is explicitly denied even with disabled target, valid admin and exact UID confirmation', async () => {
    await request(disable());
    const result = await request(deletion);
    assert.equal(result.status, 403); assert.equal(result.body.error.code, 'permission-denied');
    assert.match(result.body.error.message, /Delete is blocked/);
    await assert.rejects(core(deletion), { code: 'permission-denied' });
    assert.equal((await auth.getUser(locum)).disabled, true);
    assert.equal((await db.collection('locum_profiles').doc(locum).get()).exists, true);
    await request({ ...disable(), disabled: false, expectedDisabled: true });
  });
  await t.test('core rejects nonselected UIDs, owner kind and stale administrator authentication', async () => {
    await assert.rejects(core(disable(owner, 'practice_owner')), { code: 'permission-denied' });
    await assert.rejects(core(disable(locum, 'practice_owner')), { code: 'permission-denied' });
    await assert.rejects(core(disable(), { actor: { ...actor(), auth_time: actor().auth_time - 301 } }), { code: 'unauthenticated' });
    const off = parseDemoConfig({ ...config, enableMutations: false });
    await assert.rejects(core(disable(), { demoPolicy: off }), { code: 'permission-denied' });
    assert.equal((await auth.getUser(locum)).disabled, false);
  });
  await t.test('self and administrator protections still apply to a mistakenly selected UID', async () => {
    const adminPolicy = parseDemoConfig({ ...config, approvedTestUids: [admin], locumTestUid: admin });
    await assert.rejects(core(disable(admin), { demoPolicy: adminPolicy }), /own account/);
    await auth.setCustomUserClaims(locum, { admin: true });
    await assert.rejects(core(disable()), /protected/);
    await auth.setCustomUserClaims(locum, { role: 'locum' });
  });
  await t.test('malformed requests and missing selected users fail without mutation', async () => {
    assert.equal((await request({ ...disable(), extra: true })).status, 400);
    const uid = prefix + 'missing', missingPolicy = parseDemoConfig({ ...config, approvedTestUids: [uid], locumTestUid: uid });
    await assert.rejects(core(disable(uid), { demoPolicy: missingPolicy }), { code: 'auth/user-not-found' });
  });
  await t.test('revocation failure remains explicit and does not trigger automatic Enable or retry', async () => {
    let updates = 0;
    const faulty = { getUser: auth.getUser.bind(auth), updateUser: async (...args) => { updates++; return auth.updateUser(...args); },
      revokeRefreshTokens: async () => { throw new Error('synthetic private fault'); } };
    await assert.rejects(core(disable(), { auth: faulty }), /may be incomplete/);
    assert.equal(updates, 1); assert.equal((await auth.getUser(locum)).disabled, true);
  });
});
