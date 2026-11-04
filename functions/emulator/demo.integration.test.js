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
test('two-role restricted demo backend with synthetic Firebase services', { timeout: 120000 }, async t => {
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
  const other = await seed('other-owner', 'practice_owner');
  const config = { projectId: PROJECT, enableMutations: true, approvedTestUids: [locum, owner, other], locumTestUid: locum, practiceOwnerTestUid: owner, enableJobSoftDelete: true, approvedJobIds: [prefix + 'job'] };
  const policy = parseDemoConfig(config);
  async function signIn(uid) {
    const res = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=synthetic`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${uid}@example.invalid`, password, returnSecureToken: true }) });
    return { status: res.status, data: await res.json() };
  }
  const adminToken = (await signIn(admin)).data.idToken, userToken = (await signIn(locum)).data.idToken;
  const server = createLocalApp({ auth, db, demoPolicy: policy }).listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  function request(data, token = adminToken, origin = 'http://localhost:5173', apiPath = '/api/accounts/manage') {
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: apiPath, method: 'POST',
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
  await t.test('status exposes capability only for the selected role and UID', async () => {
    assert.equal((await request(status(locum))).body.data.mutationsEnabled, true);
    assert.equal((await request(status(owner, 'practice_owner'))).body.data.mutationsEnabled, true);
    assert.equal((await request(disable(other, 'practice_owner'))).status, 403);
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
  await t.test('selected owner Disable/Enable preserves all profile data, claims and related jobs', async () => {
    const profile = db.collection('practice_owner_profiles').doc(owner);
    const before = (await profile.get()).data();
    const claims = (await auth.getUser(owner)).customClaims;
    const job = db.collection('job_postings').doc(prefix + 'owner-job');
    await job.set({ clinicOwnerId: owner, status: 'open' });
    assert.equal((await request(disable(owner, 'practice_owner'))).status, 200);
    assert.equal((await auth.getUser(owner)).disabled, true);
    assert.equal((await signIn(owner)).status, 400);
    assert.equal((await request(disable(owner, 'practice_owner'))).body.error.code, 'aborted');
    const deletion = { uid: owner, kind: 'practice_owner', action: 'delete', confirmUid: owner };
    assert.equal((await request(deletion)).status, 403);
    await assert.rejects(core(deletion), { code: 'permission-denied' });
    assert.equal((await request({ ...disable(owner, 'practice_owner'), disabled: false, expectedDisabled: true })).status, 200);
    assert.equal((await signIn(owner)).status, 200);
    assert.deepEqual((await profile.get()).data(), before);
    assert.deepEqual((await auth.getUser(owner)).customClaims, claims);
    assert.deepEqual((await job.get()).data(), { clinicOwnerId: owner, status: 'open' });
    await assert.rejects(core(disable(owner, 'locum')), { code: 'permission-denied' });
    await assert.rejects(core(disable(owner, 'practice_owner'), { actor: { ...actor(), auth_time: actor().auth_time - 301 } }), { code: 'unauthenticated' });
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
    await assert.rejects(core(disable(other, 'practice_owner')), { code: 'permission-denied' });
    await assert.rejects(core(disable(locum, 'practice_owner')), { code: 'permission-denied' });
    await assert.rejects(core(disable(), { actor: { ...actor(), auth_time: actor().auth_time - 301 } }), { code: 'unauthenticated' });
    const off = parseDemoConfig({ ...config, enableMutations: false });
    await assert.rejects(core(disable(), { demoPolicy: off }), { code: 'permission-denied' });
    assert.equal((await auth.getUser(locum)).disabled, false);
  });
  await t.test('self and administrator protections still apply to a mistakenly selected UID', async () => {
    const adminPolicy = parseDemoConfig({ ...config, approvedTestUids: [admin, owner], locumTestUid: admin });
    await assert.rejects(core(disable(admin), { demoPolicy: adminPolicy }), /own account/);
    await auth.setCustomUserClaims(locum, { admin: true });
    await assert.rejects(core(disable()), /protected/);
    await auth.setCustomUserClaims(locum, { role: 'locum' });
  });
  await t.test('malformed requests and missing selected users fail without mutation', async () => {
    assert.equal((await request({ ...disable(), extra: true })).status, 400);
    const uid = prefix + 'missing', missingPolicy = parseDemoConfig({ ...config, approvedTestUids: [uid, owner], locumTestUid: uid });
    await assert.rejects(core(disable(uid), { demoPolicy: missingPolicy }), { code: 'auth/user-not-found' });
  });
  await t.test('job HTTP soft deletion preserves fields, applications and summaries and blocks repeats', async () => {
    const jobId = prefix + 'job', jobRef = db.collection('job_postings').doc(jobId);
    const appRef = db.collection('applications').doc(jobId + '_' + locum);
    const summaryRef = db.collection('application_applicant_summaries').doc(appRef.id);
    const original = { clinicOwnerId: owner, status: 'available', placeName: 'Synthetic Practice', extra: { historical: true } };
    const application = { jobId, locumId: locum, clinicOwnerId: owner, status: 'pending' };
    await jobRef.set(original); await appRef.set(application); await summaryRef.set({ fullName: 'Synthetic' });
    const call = (data, token = adminToken, origin) => request(data, token, origin, '/api/jobs/soft-delete');
    const data = { jobId, action: 'softDelete', expectedStatus: 'available' };
    assert.equal((await call(data, null)).status, 401);
    assert.equal((await call(data, (await signIn(locum)).data.idToken)).status, 403);
    assert.equal((await call(data, adminToken, 'https://example.invalid')).status, 403);
    assert.equal((await call({ ...data, jobId: 'not-approved' })).status, 409);
    assert.equal((await call({ jobId, action: 'status' })).body.data.mutationsEnabled, true);
    assert.equal((await call(data)).status, 200);
    const after = (await jobRef.get()).data();
    assert.equal(after.status, 'deleted'); assert.ok(after.deletedAt.toMillis()); assert.ok(after.updatedAt.toMillis());
    for (const key of ['clinicOwnerId', 'placeName', 'extra']) assert.deepEqual(after[key], original[key]);
    assert.deepEqual((await appRef.get()).data(), application);
    assert.deepEqual((await summaryRef.get()).data(), { fullName: 'Synthetic' });
    assert.equal((await call(data)).status, 409);
    assert.equal((await jobRef.get()).data().deletedAt.toMillis(), after.deletedAt.toMillis());
    assert.equal((await db.collection('job_postings').where('status', '==', 'available').get()).docs.some(doc => doc.id === jobId), false);
  });
  await t.test('revocation failure remains explicit and does not trigger automatic Enable or retry', async () => {
    let updates = 0;
    const faulty = { getUser: auth.getUser.bind(auth), updateUser: async (...args) => { updates++; return auth.updateUser(...args); },
      revokeRefreshTokens: async () => { throw new Error('synthetic private fault'); } };
    await assert.rejects(core(disable(), { auth: faulty }), /may be incomplete/);
    assert.equal(updates, 1); assert.equal((await auth.getUser(locum)).disabled, true);
  });
});
